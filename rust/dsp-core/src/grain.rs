//! Granular scanning, on the audio thread.
//!
//! The TypeScript build schedules grains from a timer that fires
//! *approximately*, placing them 200 ms ahead so a late wake still finds its
//! work already done. That lookahead exists entirely because the scheduler
//! lives on the main thread and cannot be trusted to run on time.
//!
//! Here it simply is not needed. This runs inside `process`, sample by sample,
//! so a grain starts on the sample it was meant to start on because there is no
//! other moment available. The whole lookahead, the wake interval, the
//! `nextGrainAtSec` bookkeeping and the jitter it was defending against all
//! collapse into one countdown. That is the clearest single win of the move to
//! Rust: not that it is faster, but that the problem stops existing.
//!
//! What carries over unchanged is the part that was right in the first place —
//! the window shape, jitter around a scan point, freeze, and a stretch factor
//! that decouples how fast the scan moves through the buffer from how fast
//! grains come out of it.

use crate::clamp;
use crate::samples::SampleBank;

/// A grain shorter than this is a click; longer than this is a loop.
pub const MIN_GRAIN_SEC: f32 = 0.005;
pub const MAX_GRAIN_SEC: f32 = 2.0;

/// How many grains may sound at once.
///
/// Overlap is the texture, so this has to be generous — at 50 ms grains and
/// 5 ms spacing ten are alive at any moment. Past this the oldest is stolen,
/// which is inaudible in a cloud and much better than a hard ceiling on how
/// short the spacing can go.
pub const MAX_GRAINS: usize = 24;

pub fn clamp_grain_size(seconds: f32) -> f32 {
    if seconds.is_finite() {
        clamp(seconds, MIN_GRAIN_SEC, MAX_GRAIN_SEC)
    } else {
        MIN_GRAIN_SEC
    }
}

/// The grain window: rise over the first fifth, hold, then fall away.
///
/// The flat middle is what keeps overlapping grains from beating against each
/// other — a pure triangle or Gaussian sums to a rippling amplitude at regular
/// spacings, which is heard as a tone at the grain rate rather than as
/// texture. `t` runs 0..1 across the grain; outside that it is silent, so a
/// grain that overruns fades rather than clicking.
pub fn grain_window(t: f32) -> f32 {
    if !(0.0..=1.0).contains(&t) {
        return 0.0;
    }
    const RISE: f32 = 0.2;
    const FALL: f32 = 0.5;
    if t < RISE {
        return t / RISE;
    }
    if t <= FALL {
        return 1.0;
    }
    // Exponential-ish release, matching the `exponential` ramp the Web Audio
    // build uses. Squared rather than a true exponential because it reaches
    // exactly zero at the end; an exponential never does, and a grain that
    // stops at 1e-4 instead of 0 is a click at every grain boundary.
    let fall = (1.0 - t) / (1.0 - FALL);
    fall * fall
}

/// How far the scan advances between grains, as a fraction of the buffer.
///
/// Dividing by stretch is what separates the two rates: at a stretch of two the
/// scan covers half as much buffer per grain, so the same material is emitted
/// over twice as long without changing grain size or pitch.
pub fn scan_advance_unit(spacing_sec: f32, buffer_seconds: f32, stretch: f32) -> f32 {
    if buffer_seconds <= 0.0 {
        return 0.0;
    }
    let factor = if stretch.abs() < 0.01 { 0.01 } else { stretch };
    (spacing_sec / buffer_seconds) / factor
}

/// Where one grain reads from, in frames.
///
/// Clamped so a grain never runs off the end, which would be a short grain with
/// a hard edge — a click at exactly the moment the scan reaches the end, which
/// is the most noticeable place to put one.
pub fn grain_offset_frames(
    position: f32,
    jitter: f32,
    buffer_frames: f32,
    grain_frames: f32,
    random: f32,
) -> f32 {
    let usable = (buffer_frames - grain_frames).max(0.0);
    if usable == 0.0 {
        return 0.0;
    }
    let centre = clamp(position, 0.0, 1.0) * usable;
    let spread = clamp(jitter.abs(), 0.0, 1.0) * usable;
    clamp(centre + (random * 2.0 - 1.0) * spread, 0.0, usable)
}

/// What a cloud is doing right now.
#[derive(Clone, Copy, Debug)]
pub struct GrainSettings {
    pub size_sec: f32,
    /// Time between grain starts. Shorter than `size_sec` means overlap.
    pub spacing_sec: f32,
    /// Scan centre through the buffer, 0..1.
    pub position: f32,
    /// Random spread around the centre, as a fraction of the buffer.
    pub jitter: f32,
    /// Below 1 the scan moves slower than real time; above, faster.
    pub stretch: f32,
    /// Hold the scan still. The grains keep coming; they stop moving.
    pub freeze: bool,
    /// Playback rate of each grain — pitch, independent of the scan.
    pub rate: f32,
}

impl Default for GrainSettings {
    fn default() -> Self {
        Self {
            size_sec: 0.08,
            spacing_sec: 0.04,
            position: 0.0,
            jitter: 0.0,
            stretch: 1.0,
            freeze: false,
            rate: 1.0,
        }
    }
}

#[derive(Clone, Copy, Default)]
struct Grain {
    active: bool,
    /// Read head, in frames into the sample.
    position: f32,
    /// Frames advanced per output sample.
    advance: f32,
    age: u32,
    length: u32,
}

/// A cloud of overlapping grains reading one sample.
pub struct GrainCloud {
    grains: [Grain; MAX_GRAINS],
    /// Scan pointer, 0..1 through the buffer.
    scan: f32,
    /// Output samples until the next grain starts. Fractional so a spacing
    /// that is not a whole number of samples does not drift.
    until_next: f32,
    rng: u32,
    sample_rate: f32,
}

impl GrainCloud {
    pub fn new(sample_rate: f32, seed: u32) -> Self {
        Self {
            grains: [Grain::default(); MAX_GRAINS],
            scan: 0.0,
            until_next: 0.0,
            // Any odd seed works; zero would make the generator produce only
            // zero, which is a cloud with no jitter at all however it is set.
            rng: seed | 1,
            sample_rate: if sample_rate > 0.0 { sample_rate } else { 48_000.0 },
        }
    }

    pub fn set_sample_rate(&mut self, sample_rate: f32) {
        self.sample_rate = if sample_rate > 0.0 { sample_rate } else { 48_000.0 };
        self.clear();
    }

    /// Silence every grain and return the scan to the start.
    pub fn clear(&mut self) {
        self.grains = [Grain::default(); MAX_GRAINS];
        self.scan = 0.0;
        self.until_next = 0.0;
    }

    pub fn active_grains(&self) -> usize {
        self.grains.iter().filter(|grain| grain.active).count()
    }

    pub fn scan_position(&self) -> f32 {
        self.scan
    }

    /// Restart the scan, for a note-on or a transport sync.
    pub fn retrigger(&mut self, position: f32) {
        self.scan = clamp(position, 0.0, 1.0);
        self.until_next = 0.0;
    }

    /// xorshift32 — deterministic, and the same texture every time a project is
    /// opened, which is what makes a granular patch reproducible at all.
    fn random_unit(&mut self) -> f32 {
        self.rng ^= self.rng << 13;
        self.rng ^= self.rng >> 17;
        self.rng ^= self.rng << 5;
        (self.rng >> 8) as f32 / (1u32 << 24) as f32
    }

    fn start_grain(&mut self, bank: &SampleBank, id: u32, settings: &GrainSettings) {
        let Some(sample) = bank.get(id) else { return };
        let frames = sample.frames() as f32;
        if frames <= 1.0 {
            return;
        }
        let size = clamp_grain_size(settings.size_sec);
        let length = (size * self.sample_rate) as u32;
        if length == 0 {
            return;
        }
        let advance = bank.advance_per_sample(id, self.sample_rate, settings.rate);
        let grain_frames = length as f32 * advance.abs();
        let random = self.random_unit();
        let offset =
            grain_offset_frames(self.scan, settings.jitter, frames, grain_frames, random);

        // Steal the oldest rather than refusing: in a cloud a dropped grain is
        // a hole, and a stolen one is inaudible.
        let mut slot = 0;
        let mut oldest = 0;
        let mut found = false;
        for (index, grain) in self.grains.iter().enumerate() {
            if !grain.active {
                slot = index;
                found = true;
                break;
            }
            if grain.age > self.grains[oldest].age {
                oldest = index;
            }
        }
        if !found {
            slot = oldest;
        }
        self.grains[slot] = Grain { active: true, position: offset, advance, age: 0, length };
    }

    /// One output sample. `id` names the sample in `bank`.
    pub fn process(&mut self, bank: &SampleBank, id: u32, settings: &GrainSettings) -> f32 {
        let Some(sample) = bank.get(id) else { return 0.0 };
        let buffer_seconds = sample.duration_seconds();
        if buffer_seconds <= 0.0 {
            return 0.0;
        }

        // Emit. The countdown is fractional, so a spacing that is not a whole
        // number of samples stays honest instead of accumulating drift.
        if self.until_next <= 0.0 {
            let spacing = clamp(settings.spacing_sec, 0.001, 4.0);
            self.start_grain(bank, id, settings);
            self.until_next += (spacing * self.sample_rate).max(1.0);
            if !settings.freeze {
                // The scan advances per *grain*, not per second, so the
                // texture is identical however the buffer is chopped up.
                let step = scan_advance_unit(spacing, buffer_seconds, settings.stretch);
                // Wraps rather than clamps: a scan that reaches the end starts
                // again, which is what makes a long stretch loop rather than
                // stall on the last grain.
                self.scan = (self.scan + step).rem_euclid(1.0);
            }
        }
        self.until_next -= 1.0;

        let mut sum = 0.0;
        for grain in &mut self.grains {
            if !grain.active {
                continue;
            }
            let t = grain.age as f32 / grain.length as f32;
            sum += sample.read(0, grain.position) * grain_window(t);
            grain.position += grain.advance;
            grain.age += 1;
            if grain.age >= grain.length {
                grain.active = false;
            }
        }
        sum
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f32 = 48_000.0;

    /// A bank holding one second of full-scale DC, so any grain that sounds
    /// contributes its window shape and nothing else.
    fn dc_bank() -> SampleBank {
        let mut bank = SampleBank::new();
        bank.allocate(0, 1, RATE as usize, RATE);
        for slot in bank.get_mut(0).unwrap().data_mut() {
            *slot = 1.0;
        }
        bank
    }

    fn settings() -> GrainSettings {
        GrainSettings::default()
    }

    #[test]
    fn the_window_rises_holds_and_reaches_zero() {
        assert_eq!(grain_window(0.0), 0.0);
        assert!((grain_window(0.2) - 1.0).abs() < 1e-6);
        assert!((grain_window(0.35) - 1.0).abs() < 1e-6);
        assert!((grain_window(0.5) - 1.0).abs() < 1e-6);
        // Exactly zero at the end, not merely small: anything else is a click
        // at every single grain boundary.
        assert_eq!(grain_window(1.0), 0.0);
        assert!(grain_window(0.75) > 0.0 && grain_window(0.75) < 1.0);
    }

    #[test]
    fn the_window_is_silent_outside_the_grain() {
        assert_eq!(grain_window(-0.1), 0.0);
        assert_eq!(grain_window(1.1), 0.0);
    }

    #[test]
    fn the_window_never_goes_backwards_on_the_way_up_or_down() {
        let mut previous = 0.0;
        for i in 0..=50 {
            let value = grain_window(i as f32 / 100.0);
            assert!(value >= previous - 1e-6, "the rise dipped at {i}");
            previous = value;
        }
        let mut previous = 1.0;
        for i in 50..=100 {
            let value = grain_window(i as f32 / 100.0);
            assert!(value <= previous + 1e-6, "the fall rose at {i}");
            previous = value;
        }
    }

    #[test]
    fn stretch_decouples_the_scan_from_the_grain_rate() {
        // The control that makes granular time-stretching possible at all.
        let normal = scan_advance_unit(0.04, 2.0, 1.0);
        let stretched = scan_advance_unit(0.04, 2.0, 2.0);
        assert!((stretched - normal / 2.0).abs() < 1e-9);
        // A stretch of zero would divide by zero and freeze the scan by
        // accident; it is floored instead so `freeze` stays the way to do that.
        assert!(scan_advance_unit(0.04, 2.0, 0.0).is_finite());
    }

    #[test]
    fn a_grain_never_reads_past_the_end_of_the_buffer() {
        // The click at the moment the scan reaches the end, which is the most
        // noticeable place in the whole control surface to put one.
        for random in [0.0, 0.5, 1.0] {
            let offset = grain_offset_frames(1.0, 1.0, 48_000.0, 4_800.0, random);
            assert!(offset >= 0.0 && offset <= 48_000.0 - 4_800.0, "offset {offset} escaped");
        }
    }

    #[test]
    fn a_buffer_shorter_than_one_grain_reads_from_the_start() {
        assert_eq!(grain_offset_frames(0.5, 1.0, 1_000.0, 4_800.0, 0.9), 0.0);
    }

    #[test]
    fn a_cloud_makes_sound_and_overlaps_its_grains() {
        let bank = dc_bank();
        let mut cloud = GrainCloud::new(RATE, 1);
        let mut peak_active = 0;
        let mut energy = 0.0;
        // 80 ms grains every 40 ms: two alive at any moment once running.
        for _ in 0..(RATE * 0.5) as usize {
            energy += cloud.process(&bank, 0, &settings()).abs();
            peak_active = peak_active.max(cloud.active_grains());
        }
        assert!(energy > 100.0, "the cloud was silent: {energy}");
        assert!(peak_active >= 2, "grains never overlapped: {peak_active}");
    }

    #[test]
    fn an_absent_sample_is_silence_rather_than_a_fault() {
        let bank = SampleBank::new();
        let mut cloud = GrainCloud::new(RATE, 1);
        for _ in 0..1_000 {
            assert_eq!(cloud.process(&bank, 7, &settings()), 0.0);
        }
    }

    #[test]
    fn freeze_holds_the_scan_still_but_keeps_the_grains_coming() {
        let bank = dc_bank();
        let mut cloud = GrainCloud::new(RATE, 1);
        let frozen = GrainSettings { freeze: true, position: 0.5, ..settings() };
        cloud.retrigger(0.5);
        let mut energy = 0.0;
        for _ in 0..(RATE * 0.3) as usize {
            energy += cloud.process(&bank, 0, &frozen).abs();
        }
        assert!((cloud.scan_position() - 0.5).abs() < 1e-6, "a frozen scan moved");
        assert!(energy > 100.0, "freeze silenced the cloud instead of holding it");
    }

    #[test]
    fn the_scan_advances_when_not_frozen_and_wraps_at_the_end() {
        let bank = dc_bank();
        let mut cloud = GrainCloud::new(RATE, 1);
        for _ in 0..(RATE * 0.5) as usize {
            cloud.process(&bank, 0, &settings());
        }
        assert!(cloud.scan_position() > 0.0, "the scan never moved");
        // Run long enough to pass the end; it must wrap rather than stall.
        for _ in 0..(RATE * 3.0) as usize {
            cloud.process(&bank, 0, &settings());
        }
        let scan = cloud.scan_position();
        assert!((0.0..1.0).contains(&scan), "the scan escaped its range: {scan}");
    }

    #[test]
    fn jitter_spreads_the_read_position_and_no_jitter_does_not() {
        let steady = grain_offset_frames(0.5, 0.0, 48_000.0, 4_800.0, 0.9);
        let jittered = grain_offset_frames(0.5, 0.5, 48_000.0, 4_800.0, 0.9);
        assert!((steady - 0.5 * (48_000.0 - 4_800.0)).abs() < 1e-3);
        assert!((jittered - steady).abs() > 1.0, "jitter did nothing");
    }

    #[test]
    fn the_cloud_is_deterministic_for_a_given_seed() {
        // A granular patch has to sound the same every time a project opens,
        // or it is not a patch.
        let bank = dc_bank();
        let render = || {
            let mut cloud = GrainCloud::new(RATE, 12345);
            let jittery = GrainSettings { jitter: 0.9, ..settings() };
            (0..4_000).map(|_| cloud.process(&bank, 0, &jittery)).collect::<Vec<_>>()
        };
        assert_eq!(render(), render());
    }

    #[test]
    fn the_cloud_steals_rather_than_dropping_when_it_runs_out_of_grains() {
        // Very long grains at very short spacing: far more than MAX_GRAINS want
        // to be alive at once.
        let bank = dc_bank();
        let mut cloud = GrainCloud::new(RATE, 1);
        let dense = GrainSettings { size_sec: 1.0, spacing_sec: 0.001, ..settings() };
        let mut energy = 0.0;
        for _ in 0..(RATE * 0.2) as usize {
            energy += cloud.process(&bank, 0, &dense).abs();
        }
        assert!(cloud.active_grains() <= MAX_GRAINS);
        assert!(energy > 100.0, "the cloud went silent under pressure");
    }

    #[test]
    fn stays_finite_across_the_whole_control_surface() {
        let bank = dc_bank();
        let mut cloud = GrainCloud::new(RATE, 7);
        for step in 0..=12 {
            let t = step as f32 / 12.0;
            let hostile = GrainSettings {
                size_sec: t * 4.0 - 1.0,
                spacing_sec: t * 4.0 - 1.0,
                position: t * 2.0 - 0.5,
                jitter: t * 2.0 - 0.5,
                stretch: t * 8.0 - 4.0,
                freeze: step % 3 == 0,
                rate: t * 40.0 - 20.0,
            };
            for _ in 0..3_000 {
                let out = cloud.process(&bank, 0, &hostile);
                assert!(out.is_finite(), "non-finite output at step {step}");
                assert!(out.abs() < 100.0, "runaway output {out} at step {step}");
            }
        }
    }

    #[test]
    fn clearing_silences_it() {
        let bank = dc_bank();
        let mut cloud = GrainCloud::new(RATE, 1);
        for _ in 0..2_000 {
            cloud.process(&bank, 0, &settings());
        }
        assert!(cloud.active_grains() > 0);
        cloud.clear();
        assert_eq!(cloud.active_grains(), 0);
        assert_eq!(cloud.scan_position(), 0.0);
    }
}
