//! One synth voice — §9.1 through §9.7 assembled.
//!
//! Three oscillators into a mixer, into a filter with its own envelope and key
//! follow, into the amplitude envelope, into a pan. Two LFOs and the 8 × 12
//! matrix run alongside, **evaluated on every sample**, which is the whole
//! difference from the browser build.
//!
//! # The scale sequencer's voice, as the browser plays it
//!
//! The laws are `src/modular/audio/synthLaws.ts`, restated here and pinned to
//! the same numbers; the browser's own parts are `webaudio.rs`:
//!
//! - **Oscillators** read Web Audio's band-limited tables (`WebOsc`): the
//!   built-in waves from the module's shared tables, the pulse from 256
//!   cosine terms the note builds at its width — fixed for the note's life,
//!   as the original builds a `PeriodicWave` per note.
//! - **Frequency** is computed as the browser computes it: the note's hertz
//!   as an `AudioParam` holds it, times `2^(detune/1200)` in single precision.
//! - **Envelopes** are the calls `playNote` makes, on a Web Audio timeline
//!   (`ParamTimeline`). A sequenced note knows its gate and writes its release
//!   at the start, so a gate inside the attack holds silence until the gate
//!   and then jumps to the sustain, as the original does. A note played live
//!   writes the same release when its key comes up, over what is there.
//! - **The filter** is Web Audio's lowpass (`WebLowpass`), its frequency the
//!   module's cutoff knob — gliding as the original's `setTargetAtTime` does —
//!   plus this note's envelope as an offset from the knob, plus the LFOs.
//! - **The end**: the oscillators stop 50 ms after the amp release, and the
//!   voice is free.
//!
//! # Why the filter is per voice
//!
//! The scale sequencer this design came from shared one filter across the whole
//! instrument. A filter envelope belongs to a note, so the filter does too. A
//! *classic* voice is the exception the module asks for: it skips its filter
//! and pan, and the module puts every classic voice through one shared filter,
//! as the original does (see `Synth` in `modules.rs`).
//!
//! # The order of the modulation
//!
//! Sources are read, the matrix is evaluated, and *then* everything is applied.
//! Doing it in that order means a routing from LFO 1 to LFO 2's rate uses this
//! sample's LFO 1 rather than last sample's, and — more importantly — that no
//! destination can depend on the order the code happens to apply them in.

use crate::lfo::{Lfo, LfoShape, LfoTrigger};
use crate::modmatrix::{apply, ModDest, ModMatrix, ModSource, DEST_COUNT, SOURCE_COUNT};
use crate::osc::Wave;
use crate::webaudio::{
    partials_for_range, pulse_coefficients, BandLimitedWave, BasicShape, Ifft, ParamTimeline, WebLowpass,
    WebOsc, PULSE_COMPONENTS,
};
use crate::{clamp, Rng};

pub const OSC_COUNT: usize = 3;

/// A4 = 440 Hz at MIDI note 69, the tuning everything else is measured from.
pub const A4_HZ: f32 = 440.0;
pub const A4_MIDI: f32 = 69.0;

/// Where key follow pivots: middle C tracks at whatever the cutoff is set to,
/// and notes either side move around it.
pub const KEY_FOLLOW_PIVOT_MIDI: f32 = 60.0;

pub const MIN_CUTOFF_HZ: f32 = 20.0;
pub const MAX_CUTOFF_HZ: f32 = 20_000.0;

/// A full filter envelope reaches the base cutoff times this: `2^4 − 1`.
pub const FILTER_ENV_SPAN: f32 = 15.0;

/// Where a modulated pulse width is held.
pub const MIN_MODULATED_PW: f32 = 0.05;
pub const MAX_MODULATED_PW: f32 = 0.95;

/// The original's gate: a note holds 85 % of its step.
pub const ORIGINAL_GATE: f32 = 0.85;
/// An oscillator stops this long after its amp release ends.
pub const NOTE_TAIL_SEC: f32 = 0.05;
/// A stolen voice fades on this time constant, and stops after twice it.
pub const STEAL_FADE_SEC: f32 = 0.02;

/// Convert a MIDI note to hertz, fractional notes included so that pitch
/// modulation and detune land between the keys.
#[inline]
pub fn note_to_hz(note: f32) -> f32 {
    A4_HZ * ((note - A4_MIDI) / 12.0).exp2()
}

/// A note's hertz as the browser voice sets its oscillator's frequency: the
/// note in double precision (`rootHzForMidi`), held by the `AudioParam` as a
/// float.
#[inline]
pub fn web_note_hz(note: u8) -> f32 {
    (440.0f64 * ((note as f64 - 69.0) / 12.0).exp2()) as f32
}

/// The cutoff a note starts from: the knob moved by key follow, measured from
/// middle C by the note's true pitch. Clamped above only, as the original.
pub fn key_followed_cutoff(cutoff_hz: f32, pitch: f32, key_follow: f32) -> f32 {
    let semitones = (pitch - KEY_FOLLOW_PIVOT_MIDI) * clamp(key_follow, 0.0, 1.0);
    (cutoff_hz * (semitones / 12.0).exp2()).min(MAX_CUTOFF_HZ)
}

/// Where a filter envelope goes: `(base, peak, sustain)` in hertz.
///
/// `amount` is the original's −1…+1, linear in hertz — `base + amount · base ·
/// 15`, the sustain scaled by its level — and `octaves` is idMLab's own
/// exponential amount alongside it. Peak and sustain are held to 20 Hz–20 kHz.
pub fn filter_sweep(base: f32, octaves: f32, amount: f32, sustain: f32) -> (f32, f32, f32) {
    let oct = clamp(octaves, -8.0, 8.0);
    let reach = clamp(amount, -1.0, 1.0) * FILTER_ENV_SPAN * base;
    let s = clamp(sustain, 0.0, 1.0);
    (
        base,
        clamp(base * oct.exp2() + reach, MIN_CUTOFF_HZ, MAX_CUTOFF_HZ),
        clamp(base * (oct * s).exp2() + reach * s, MIN_CUTOFF_HZ, MAX_CUTOFF_HZ),
    )
}

/// The calls `playNote` makes for one envelope, onto `timeline`: `from` at the
/// note, ramps to `peak` and `sustain`, and — when the release time is known —
/// the sustain at it and a ramp back to `from`. Times in seconds from the note.
pub fn write_envelope(
    timeline: &mut ParamTimeline,
    at: f64,
    from: f32,
    peak: f32,
    sustain: f32,
    times: AdsrSettings,
    release_at: Option<f64>,
) {
    let attack = times.attack.max(0.0) as f64;
    let decay = times.decay.max(0.0) as f64;
    timeline.set_value_at_time(from, at);
    timeline.linear_ramp_to_value_at_time(peak, at + attack);
    timeline.linear_ramp_to_value_at_time(sustain, at + attack + decay);
    if let Some(release) = release_at {
        write_release(timeline, release, sustain, from, times.release);
    }
}

/// The release the original writes at the gate: the sustain, then a ramp to `to`.
pub fn write_release(timeline: &mut ParamTimeline, at: f64, sustain: f32, to: f32, release: f32) {
    timeline.set_value_at_time(sustain, at);
    timeline.linear_ramp_to_value_at_time(to, at + release.max(0.0) as f64);
}

/// The module's shared wave tables and the transform that fills them.
///
/// The built-in waves are the browser's, the same for every voice and every
/// LFO, so they are computed once — each table the first time a note needs
/// it — into storage allocated here. A pulse's normalisation depends only on
/// its width, so the last few are remembered.
pub struct WaveContext {
    pub sample_rate: f32,
    pub fft: Ifft,
    basic: [BandLimitedWave; 4],
    pulse_scales: [(u32, f32); 32],
    next_scale: usize,
}

impl WaveContext {
    pub fn new(sample_rate: f32) -> Self {
        let rate = if sample_rate > 0.0 { sample_rate } else { 48_000.0 };
        let make = |shape| BandLimitedWave::basic(shape, rate);
        let basic = [
            make(BasicShape::Sine),
            make(BasicShape::Square),
            make(BasicShape::Sawtooth),
            make(BasicShape::Triangle),
        ];
        Self {
            sample_rate: rate,
            fft: Ifft::new(basic[0].size()),
            basic,
            pulse_scales: [(u32::MAX, 0.0); 32],
            next_scale: 0,
        }
    }

    /// One sample of a built-in wave.
    #[inline]
    pub fn basic_sample(&mut self, osc: &mut WebOsc, shape: BasicShape, frequency: f32) -> f32 {
        osc.next(frequency, self.sample_rate, &mut self.basic[shape as usize], &mut self.fft)
    }

    /// A pulse's normalisation at `width`, remembered by width.
    fn pulse_scale(&mut self, width: f32, real: &[f32; PULSE_COMPONENTS]) -> f32 {
        let key = width.to_bits();
        if let Some(&(_, scale)) = self.pulse_scales.iter().find(|(bits, _)| *bits == key) {
            return scale;
        }
        let full = PULSE_COMPONENTS.min(partials_for_range(0, self.fft.size()) + 1);
        let scale = self.fft.normalisation(real, &[0.0; PULSE_COMPONENTS], full);
        self.pulse_scales[self.next_scale] = (key, scale);
        self.next_scale = (self.next_scale + 1) % self.pulse_scales.len();
        scale
    }
}

/// The browser wave an oscillator wave is — or `None` for the pulse.
fn basic_shape(wave: Wave) -> Option<BasicShape> {
    match wave {
        Wave::Sine => Some(BasicShape::Sine),
        Wave::Triangle => Some(BasicShape::Triangle),
        Wave::Sawtooth => Some(BasicShape::Sawtooth),
        Wave::Square => Some(BasicShape::Square),
        Wave::Pulse => None,
    }
}

/// Everything a voice needs that the performer sets rather than the note.
///
/// Shared across voices by value: a voice reads it every sample, so it has to
/// be cheap to copy and free of anything that could be mutated underneath a
/// note in flight.
#[derive(Clone)]
pub struct VoiceSettings {
    pub waves: [Wave; OSC_COUNT],
    /// Semitone offset per oscillator.
    pub detune_semis: [f32; OSC_COUNT],
    /// Fine detune in cents, for the beating that makes a stack sound wide.
    pub detune_cents: [f32; OSC_COUNT],
    pub levels: [f32; OSC_COUNT],
    pub pulse_width: [f32; OSC_COUNT],

    /// The cutoff the filters run at this sample: the knob, gliding.
    pub cutoff_hz: f32,
    /// The knob itself — what a new note measures its envelope from.
    pub knob_hz: f32,
    /// Q in decibels, as Web Audio's lowpass reads it.
    pub resonance: f32,
    /// How much the filter envelope opens the cutoff, in octaves.
    pub filter_env_octaves: f32,
    /// The original's envelope amount, −1…+1, linear in hertz.
    pub filter_env_amount: f32,
    /// 0 = cutoff is the same at every pitch, 1 = it tracks the keyboard.
    pub key_follow: f32,

    pub amp: AdsrSettings,
    pub filter_env: AdsrSettings,

    pub lfo: [LfoSettings; 2],
    pub matrix: ModMatrix,

    pub pan: f32,
    /// The voice's peak, before velocity.
    pub level: f32,

    /// A new note skips its own filter and pan, for the module's shared one.
    pub classic: bool,
    /// The pulse width swing a new note is built with — the module's pulse
    /// LFOs, read at the note.
    pub pw_swing: f32,
    /// What the module's LFOs add to every voice filter, this sample.
    pub lfo_cutoff_hz: f32,
    pub lfo_q: f32,
}

#[derive(Clone, Copy)]
pub struct AdsrSettings {
    pub attack: f32,
    pub decay: f32,
    pub sustain: f32,
    pub release: f32,
}

#[derive(Clone, Copy)]
pub struct LfoSettings {
    pub shape: LfoShape,
    pub trigger: LfoTrigger,
    pub rate_hz: f32,
    pub depth: f32,
    pub phase_degrees: f32,
}

impl Default for VoiceSettings {
    fn default() -> Self {
        Self {
            waves: [Wave::Sawtooth; OSC_COUNT],
            detune_semis: [0.0; OSC_COUNT],
            detune_cents: [0.0; OSC_COUNT],
            // Only the first oscillator sounds by default, so a fresh Synth is
            // one clean voice rather than three stacked at unity.
            levels: [1.0, 0.0, 0.0],
            pulse_width: [0.5; OSC_COUNT],
            cutoff_hz: 8_000.0,
            knob_hz: 8_000.0,
            resonance: 1.0,
            filter_env_octaves: 0.0,
            filter_env_amount: 0.0,
            key_follow: 0.0,
            amp: AdsrSettings { attack: 0.005, decay: 0.1, sustain: 0.8, release: 0.15 },
            filter_env: AdsrSettings { attack: 0.005, decay: 0.2, sustain: 0.4, release: 0.2 },
            lfo: [
                LfoSettings {
                    shape: LfoShape::Sine,
                    trigger: LfoTrigger::Free,
                    rate_hz: 5.0,
                    depth: 1.0,
                    phase_degrees: 0.0,
                },
                LfoSettings {
                    shape: LfoShape::Triangle,
                    trigger: LfoTrigger::Free,
                    rate_hz: 0.5,
                    depth: 1.0,
                    phase_degrees: 0.0,
                },
            ],
            matrix: ModMatrix::new(),
            pan: 0.0,
            level: 1.0,
            classic: false,
            pw_swing: 0.0,
            lfo_cutoff_hz: 0.0,
            lfo_q: 0.0,
        }
    }
}

/// What one voice produces for one sample.
///
/// `classic` is a classic voice's output: mono, unfiltered, for the module's
/// shared filter. A voice is one or the other, so one of the two is silent.
#[derive(Clone, Copy, Debug, Default)]
pub struct StereoSample {
    pub left: f32,
    pub right: f32,
    pub classic: f32,
}

pub struct Voice {
    sample_rate: f32,
    oscs: [WebOsc; OSC_COUNT],
    /// Each oscillator's pulse, built by the note at its width.
    pulses: [BandLimitedWave; OSC_COUNT],
    filter: WebLowpass,
    /// The amp envelope, 0…1, timed from the note's start.
    amp: ParamTimeline,
    /// The filter envelope as offsets from the cutoff knob, in hertz.
    filter_env: ParamTimeline,
    /// The same envelope as 0…1, for the matrix's `FilterEnv` source.
    filter_unit: ParamTimeline,
    lfos: [Lfo; 2],
    rng: Rng,

    /// The note currently sounding, if any.
    note: Option<u8>,
    /// The microtonal remainder of that note's pitch.
    ///
    /// Belongs to the note rather than to `VoiceSettings` because it is not a
    /// setting: `settings.detune_cents` is per-oscillator and fixed for the
    /// life of a patch, while this changes with every note a scale quantiser
    /// touches.
    detune_cents: f32,
    velocity: f32,
    /// One random value per note — §9.7's `Random` source, which is fixed for
    /// the life of a note rather than noise.
    note_random: f32,
    mod_wheel: f32,
    /// Fixed when the note starts: its routing, its waves and widths.
    classic: bool,
    waves: [Wave; OSC_COUNT],
    widths: [f32; OSC_COUNT],
    /// Frames since the note started.
    frame: u64,
    /// The frame the oscillators stop, once the release is written.
    stop_frame: Option<u64>,
    sounding: bool,
    released: bool,
    sustain: f32,
    filter_from: f32,
    sustain_offset: f32,
}

impl Voice {
    pub fn new(sample_rate: f32, seed: u32) -> Self {
        let rate = if sample_rate > 0.0 { sample_rate } else { 48_000.0 };
        let mut rng = Rng::new(seed);
        let note_random = rng.next_bipolar();
        let pulse = || BandLimitedWave::with_components(rate, 2, PULSE_COMPONENTS);
        Self {
            sample_rate: rate,
            oscs: [WebOsc::new(); OSC_COUNT],
            pulses: [pulse(), pulse(), pulse()],
            filter: WebLowpass::new(),
            amp: ParamTimeline::new(0.0),
            filter_env: ParamTimeline::new(0.0),
            filter_unit: ParamTimeline::new(0.0),
            // Separate seeds so the two LFOs' random shapes do not move in
            // lockstep, which would make them one source with two names.
            lfos: [Lfo::new(rate, seed ^ 0x5EED), Lfo::new(rate, seed ^ 0xA5A5)],
            rng,
            note: None,
            detune_cents: 0.0,
            velocity: 0.0,
            note_random,
            mod_wheel: 0.0,
            classic: false,
            waves: [Wave::Sawtooth; OSC_COUNT],
            widths: [0.5; OSC_COUNT],
            frame: 0,
            stop_frame: None,
            sounding: false,
            released: false,
            sustain: 0.0,
            filter_from: 0.0,
            sustain_offset: 0.0,
        }
    }

    pub fn note(&self) -> Option<u8> {
        self.note
    }

    /// Still sounding: started, and its oscillators not yet stopped.
    pub fn is_active(&self) -> bool {
        self.sounding
    }

    /// Let go, or written with its release: a key-up changes nothing.
    pub fn is_released(&self) -> bool {
        self.released
    }

    pub fn set_mod_wheel(&mut self, value: f32) {
        self.mod_wheel = clamp(value, 0.0, 1.0);
    }

    /// Apply settings that do not depend on the note.
    pub fn configure(&mut self, settings: &VoiceSettings) {
        for (index, lfo) in self.lfos.iter_mut().enumerate() {
            let config = settings.lfo[index];
            lfo.set_shape(config.shape);
            lfo.set_trigger(config.trigger);
            lfo.set_rate_hz(config.rate_hz);
            lfo.set_depth(config.depth);
            lfo.set_phase_degrees(config.phase_degrees);
        }
    }

    fn seconds(&self, frames: u64) -> f64 {
        frames as f64 / self.sample_rate as f64
    }

    /// Note on.
    ///
    /// `detune_cents` is the part of the pitch MIDI cannot say. `velocity` is
    /// 0…1 and is heard squared, as the browser voice hears it. `release_after`
    /// is, for a sequenced note, how long after its start it releases — the
    /// gate — so its release is written with the rest of its envelope.
    pub fn start(
        &mut self,
        note: u8,
        velocity: f32,
        detune_cents: f32,
        settings: &VoiceSettings,
        release_after: Option<f32>,
        ctx: &mut WaveContext,
    ) {
        self.configure(settings);
        self.note = Some(note);
        // A non-finite value would poison the oscillator frequency for the
        // life of the voice, and there is no sound to recover to.
        self.detune_cents = if detune_cents.is_finite() { detune_cents } else { 0.0 };
        self.velocity = if velocity.is_finite() { clamp(velocity, 0.0, 1.0) } else { 0.0 };
        self.note_random = self.rng.next_bipolar();
        self.classic = settings.classic;
        self.frame = 0;
        self.sounding = true;
        self.released = false;
        self.stop_frame = None;
        self.filter.clear();
        let swing = if settings.pw_swing.is_finite() { settings.pw_swing } else { 0.0 };
        for index in 0..OSC_COUNT {
            self.oscs[index].reset();
            self.waves[index] = settings.waves[index];
            let width = clamp(settings.pulse_width[index] + swing, MIN_MODULATED_PW, MAX_MODULATED_PW);
            self.widths[index] = width;
            if self.waves[index] == Wave::Pulse {
                // The original builds this note's pulse at this width.
                let mut real = [0.0f32; PULSE_COMPONENTS];
                pulse_coefficients(width, &mut real);
                let scale = ctx.pulse_scale(width, &real);
                self.pulses[index].set_coefficients(&real, &[0.0; PULSE_COMPONENTS], Some(scale));
            }
        }

        let release_at = release_after.filter(|t| t.is_finite()).map(|t| t.max(0.0) as f64);
        let amp = settings.amp;
        self.sustain = clamp(amp.sustain, 0.0, 1.0);
        self.amp.clear();
        write_envelope(&mut self.amp, 0.0, 0.0, 1.0, self.sustain, amp, release_at);

        let env = settings.filter_env;
        let knob = positive(settings.knob_hz, 2_000.0);
        let pitch = note as f32 + self.detune_cents / 100.0;
        let base = key_followed_cutoff(knob, pitch, settings.key_follow);
        let (base, peak, sustain) =
            filter_sweep(base, settings.filter_env_octaves, settings.filter_env_amount, env.sustain);
        self.filter_from = base - knob;
        self.sustain_offset = sustain - knob;
        self.filter_env.clear();
        write_envelope(&mut self.filter_env, 0.0, self.filter_from, peak - knob, self.sustain_offset, env, release_at);
        self.filter_unit.clear();
        write_envelope(&mut self.filter_unit, 0.0, 0.0, 1.0, clamp(env.sustain, 0.0, 1.0), env, release_at);
        if let Some(release) = release_at {
            self.released = true;
            self.stop_at(release, amp.release);
        }
        for lfo in self.lfos.iter_mut() {
            lfo.retrigger();
        }
    }

    fn stop_at(&mut self, release_at: f64, release: f32) {
        let stop = release_at + release.max(0.0) as f64 + NOTE_TAIL_SEC as f64;
        self.stop_frame = Some((stop * self.sample_rate as f64).ceil() as u64);
    }

    /// Note off: the sustain set now and a ramp down, written over what is
    /// there. A note already let go — or written with its release — is left.
    pub fn release(&mut self, settings: &VoiceSettings) {
        if self.released || !self.sounding {
            return;
        }
        self.released = true;
        let now = self.seconds(self.frame);
        write_release(&mut self.amp, now, self.sustain, 0.0, settings.amp.release);
        write_release(&mut self.filter_env, now, self.sustain_offset, self.filter_from, settings.filter_env.release);
        let unit = clamp(settings.filter_env.sustain, 0.0, 1.0);
        write_release(&mut self.filter_unit, now, unit, 0.0, settings.filter_env.release);
        self.stop_at(now, settings.amp.release);
    }

    /// Cut the note short to make room for another: it fades on a 20 ms time
    /// constant from where it is and stops after 40, as the browser voice's
    /// steal does.
    pub fn steal(&mut self) {
        if !self.sounding {
            return;
        }
        self.released = true;
        let now = self.seconds(self.frame);
        let current = self.amp.value();
        self.amp.cancel_scheduled_values(now);
        self.amp.set_value_at_time(current, now);
        self.amp.set_target_at_time(0.0, now, STEAL_FADE_SEC as f64);
        let stop = now + 2.0 * STEAL_FADE_SEC as f64;
        let frame = (stop * self.sample_rate as f64).ceil() as u64;
        self.stop_frame = Some(self.stop_frame.map_or(frame, |f| f.min(frame)));
    }

    /// Silence now, for a panic.
    pub fn kill(&mut self) {
        self.sounding = false;
        self.released = true;
        self.note = None;
        self.detune_cents = 0.0;
        self.amp.clear();
        self.filter_env.clear();
        self.filter_unit.clear();
        self.filter.clear();
    }

    /// The eight matrix sources, as of this sample.
    #[inline]
    fn sources(&self, amp: f32, filter_env: f32, lfo1: f32, lfo2: f32) -> [f32; SOURCE_COUNT] {
        let mut sources = [0.0; SOURCE_COUNT];
        sources[ModSource::Lfo1 as usize] = lfo1;
        sources[ModSource::Lfo2 as usize] = lfo2;
        sources[ModSource::AmpEnv as usize] = amp;
        sources[ModSource::FilterEnv as usize] = filter_env;
        sources[ModSource::Velocity as usize] = self.velocity;
        // Note as a bipolar position across the keyboard, so that a routing to
        // cutoff brightens the top half and darkens the bottom rather than
        // only ever adding.
        sources[ModSource::Note as usize] =
            self.note.map(|n| (n as f32 - 64.0) / 64.0).unwrap_or(0.0);
        sources[ModSource::ModWheel as usize] = self.mod_wheel;
        sources[ModSource::Random as usize] = self.note_random;
        sources
    }

    /// One sample.
    #[inline]
    pub fn next(&mut self, settings: &VoiceSettings, ctx: &mut WaveContext) -> StereoSample {
        if !self.sounding {
            return StereoSample::default();
        }
        if self.stop_frame.is_some_and(|stop| self.frame >= stop) {
            self.kill();
            return StereoSample::default();
        }
        let rate = self.sample_rate as f64;
        let frame = self.frame;
        self.frame += 1;

        // 1. Read every source for this sample.
        let amp_env = self.amp.value_at(frame, rate);
        let filter_offset = self.filter_env.value_at(frame, rate);
        let filter_unit = self.filter_unit.value_at(frame, rate);
        let lfo1 = self.lfos[0].next();
        let lfo2 = self.lfos[1].next();
        let sources = self.sources(amp_env, filter_unit, lfo1, lfo2);

        // 2. Evaluate the whole matrix once. Every destination below reads from
        //    this, so none of them can be affected by the order they are applied.
        let m: [f32; DEST_COUNT] = settings.matrix.evaluate(&sources);

        // 3. LFO rates are themselves destinations.
        for index in 0..2 {
            let dest = if index == 0 { ModDest::Lfo1Rate } else { ModDest::Lfo2Rate };
            let modulation = m[dest as usize];
            if modulation != 0.0 {
                self.lfos[index].set_rate_hz(apply(dest, settings.lfo[index].rate_hz, modulation));
            }
        }

        // 4. Oscillators, at the frequency the browser voice sets: the note's
        //    hertz times its detune, in single precision.
        let note_hz = web_note_hz(self.note.unwrap_or(69));
        let mut mixed = 0.0;
        for index in 0..OSC_COUNT {
            let pitch_dest = match index {
                0 => ModDest::Osc1Pitch,
                1 => ModDest::Osc2Pitch,
                _ => ModDest::Osc3Pitch,
            };
            let level_dest = match index {
                0 => ModDest::Osc1Level,
                1 => ModDest::Osc2Level,
                _ => ModDest::Osc3Level,
            };
            let cents = settings.detune_semis[index] * 100.0 + settings.detune_cents[index] + self.detune_cents;
            let mut frequency = note_hz * (cents / 1200.0).exp2();
            if m[pitch_dest as usize] != 0.0 {
                frequency = apply(pitch_dest, frequency, m[pitch_dest as usize]);
            }
            let sample = match basic_shape(self.waves[index]) {
                Some(shape) => ctx.basic_sample(&mut self.oscs[index], shape, frequency),
                None => self.oscs[index].next(frequency, ctx.sample_rate, &mut self.pulses[index], &mut ctx.fft),
            };
            let mut level = clamp(settings.levels[index], 0.0, 1.0);
            if m[level_dest as usize] != 0.0 {
                level = clamp(apply(level_dest, level, m[level_dest as usize]), 0.0, 1.0);
            }
            mixed += sample * level;
        }

        // 5. Amplitude: the envelope, velocity squared, the voice's level.
        let mut level = clamp(settings.level, 0.0, 1.0);
        if m[ModDest::Volume as usize] != 0.0 {
            level = clamp(apply(ModDest::Volume, level, m[ModDest::Volume as usize]), 0.0, 1.0);
        }
        let gain = amp_env * (self.velocity * self.velocity * level);
        if self.classic {
            return StereoSample { classic: mixed * gain, ..StereoSample::default() };
        }

        // 6. Filter: this note's offset, plus the knob and the module's LFOs —
        //    the sum the browser voice's frequency param makes — then the matrix.
        let mut cutoff = filter_offset + (settings.cutoff_hz + settings.lfo_cutoff_hz);
        if m[ModDest::FilterCutoff as usize] != 0.0 {
            cutoff = apply(ModDest::FilterCutoff, cutoff, m[ModDest::FilterCutoff as usize]);
        }
        let mut q = clamp(settings.resonance, 0.0001, 30.0);
        if m[ModDest::FilterResonance as usize] != 0.0 {
            q = clamp(apply(ModDest::FilterResonance, settings.resonance, m[ModDest::FilterResonance as usize]), 0.0001, 30.0);
        }
        self.filter.set(cutoff, q + settings.lfo_q, self.sample_rate);
        let amplitude = self.filter.process(mixed) * gain;

        // 7. Pan, equal power, as a stereo panner places a mono input.
        let mut pan = clamp(settings.pan, -1.0, 1.0);
        if m[ModDest::Pan as usize] != 0.0 {
            pan = clamp(apply(ModDest::Pan, pan, m[ModDest::Pan as usize]), -1.0, 1.0);
        }
        let angle = (pan + 1.0) * 0.25 * core::f32::consts::PI;
        StereoSample { left: amplitude * angle.cos(), right: amplitude * angle.sin(), classic: 0.0 }
    }
}

fn positive(value: f32, fallback: f32) -> f32 {
    if value.is_finite() && value > 0.0 {
        value
    } else {
        fallback
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f32 = 48_000.0;

    /// A voice with the module's wave tables beside it.
    struct TestVoice {
        voice: Voice,
        ctx: WaveContext,
    }

    impl TestVoice {
        fn new(seed: u32) -> Self {
            Self { voice: Voice::new(RATE, seed), ctx: WaveContext::new(RATE) }
        }
        fn start(&mut self, note: u8, velocity: f32, detune: f32, settings: &VoiceSettings) {
            self.voice.start(note, velocity, detune, settings, None, &mut self.ctx);
        }
        fn start_gated(&mut self, note: u8, settings: &VoiceSettings, release_after: f32) {
            self.voice.start(note, 1.0, 0.0, settings, Some(release_after), &mut self.ctx);
        }
        fn next(&mut self, settings: &VoiceSettings) -> StereoSample {
            self.voice.next(settings, &mut self.ctx)
        }
    }

    impl core::ops::Deref for TestVoice {
        type Target = Voice;
        fn deref(&self) -> &Voice {
            &self.voice
        }
    }

    impl core::ops::DerefMut for TestVoice {
        fn deref_mut(&mut self) -> &mut Voice {
            &mut self.voice
        }
    }

    fn voice() -> (TestVoice, VoiceSettings) {
        (TestVoice::new(11), VoiceSettings::default())
    }

    fn render(voice: &mut TestVoice, settings: &VoiceSettings, seconds: f32) -> Vec<StereoSample> {
        (0..(seconds * RATE) as usize).map(|_| voice.next(settings)).collect()
    }

    fn peak(samples: &[StereoSample]) -> f32 {
        samples.iter().fold(0.0f32, |acc, s| acc.max(s.left.abs()).max(s.right.abs()))
    }

    fn mono(samples: &[StereoSample]) -> Vec<f32> {
        samples.iter().map(|s| s.left + s.right).collect()
    }

    use crate::testutil::brightness;

    #[test]
    fn a_voice_is_silent_until_a_note_starts() {
        let (mut voice, settings) = voice();
        assert!(!voice.is_active());
        assert_eq!(peak(&render(&mut voice, &settings, 0.05)), 0.0);
    }

    #[test]
    fn a_note_makes_sound_and_stops_when_released() {
        let (mut voice, settings) = voice();
        voice.start(60, 1.0, 0.0, &settings);
        assert!(peak(&render(&mut voice, &settings, 0.1)) > 0.05);

        voice.release(&settings);
        render(&mut voice, &settings, 0.5);
        assert!(!voice.is_active(), "still sounding after its release");
        assert_eq!(peak(&render(&mut voice, &settings, 0.05)), 0.0);
    }

    #[test]
    fn a_higher_note_is_a_higher_pitch() {
        let count = |samples: &[f32]| {
            samples.windows(2).filter(|p| p[0] <= 0.0 && p[1] > 0.0).count()
        };
        let (mut low, settings) = voice();
        low.start(48, 1.0, 0.0, &settings);
        let low_crossings = count(&mono(&render(&mut low, &settings, 0.2)));

        let (mut high, settings) = voice();
        high.start(72, 1.0, 0.0, &settings);
        let high_crossings = count(&mono(&render(&mut high, &settings, 0.2)));

        // Two octaves up is four times the rate.
        let ratio = high_crossings as f32 / low_crossings as f32;
        assert!((ratio - 4.0).abs() < 0.5, "expected 4x, got {ratio}");
    }

    #[test]
    fn a_notes_detune_moves_its_pitch() {
        // The whole point of the tuning library: a scale that does not fit the
        // twelve keys arrives as a note plus a remainder, and the remainder
        // has to reach the oscillator or every microtonal scale sounds like
        // 12-TET with extra steps.
        let count = |samples: &[f32]| {
            samples.windows(2).filter(|p| p[0] <= 0.0 && p[1] > 0.0).count()
        };
        let (mut plain, settings) = voice();
        plain.start(60, 1.0, 0.0, &settings);
        let plain_crossings = count(&mono(&render(&mut plain, &settings, 0.4)));

        // An octave expressed entirely as detune, so nothing but the argument
        // under test can account for the difference.
        let (mut sharp, settings) = voice();
        sharp.start(60, 1.0, 1200.0, &settings);
        let sharp_crossings = count(&mono(&render(&mut sharp, &settings, 0.4)));

        let ratio = sharp_crossings as f32 / plain_crossings as f32;
        assert!((ratio - 2.0).abs() < 0.2, "expected 2x, got {ratio}");
    }

    #[test]
    fn a_detune_of_fifty_cents_lands_between_two_keys() {
        // Half a semitone up from 60 is half a semitone down from 61, so the
        // two have to agree — which they only do if the remainder is added to
        // the note before the conversion rather than after it.
        assert!((note_to_hz(60.0 + 0.5) - note_to_hz(61.0 - 0.5)).abs() < 1e-3);
    }

    #[test]
    fn a_nonsense_detune_is_ignored_rather_than_silencing_the_voice() {
        // NaN in the frequency would stay in the oscillator for the life of
        // the note, and there is no sound to recover to.
        let (mut voice, settings) = voice();
        voice.start(60, 1.0, f32::NAN, &settings);
        assert!(peak(&render(&mut voice, &settings, 0.1)) > 0.05);
    }

    #[test]
    fn middle_c_is_where_it_should_be() {
        assert!((note_to_hz(69.0) - 440.0).abs() < 1e-3);
        assert!((note_to_hz(60.0) - 261.626).abs() < 0.01);
        assert!((note_to_hz(81.0) - 880.0).abs() < 1e-2);
    }

    #[test]
    fn velocity_scales_the_voice() {
        let (mut loud, settings) = voice();
        loud.start(60, 1.0, 0.0, &settings);
        let loud_peak = peak(&render(&mut loud, &settings, 0.1));

        let (mut soft, settings) = voice();
        soft.start(60, 0.25, 0.0, &settings);
        let soft_peak = peak(&render(&mut soft, &settings, 0.1));

        // Heard squared, as the browser voice hears it: a quarter of the
        // velocity is a sixteenth of the level.
        assert!((soft_peak / loud_peak - 0.0625).abs() < 0.01, "{soft_peak} vs {loud_peak}");
    }

    #[test]
    fn a_full_stack_of_oscillators_is_summed_as_the_browser_voice_sums_it() {
        // Three gains into one filter, not an average: a single oscillator at
        // full level is the scale sequencer's whole voice, and it has to be as
        // loud here as there. The master chain's limiter catches a stack.
        let single = {
            let (mut voice, mut settings) = voice();
            settings.cutoff_hz = 20_000.0;
            voice.start(60, 1.0, 0.0, &settings);
            peak(&render(&mut voice, &settings, 0.3))
        };
        let (mut voice, mut settings) = voice();
        settings.levels = [1.0; OSC_COUNT];
        settings.cutoff_hz = 20_000.0;
        voice.start(60, 1.0, 0.0, &settings);
        let p = peak(&render(&mut voice, &settings, 0.3));
        assert!((p / single - 3.0).abs() < 0.2, "{p} vs {single}");
    }

    #[test]
    fn the_filter_actually_removes_the_top() {
        let at = |cutoff: f32| {
            let (mut v, mut settings) = voice();
            settings.cutoff_hz = cutoff;
            v.start(48, 1.0, 0.0, &settings);
            brightness(&mono(&render(&mut v, &settings, 0.2)))
        };
        let bright = at(18_000.0);
        let dark = at(200.0);
        assert!(dark < bright * 0.5, "closing the filter changed little: {dark} vs {bright}");
    }

    #[test]
    fn key_follow_opens_the_filter_as_you_play_up() {
        let (mut high_voice, mut settings) = voice();
        settings.cutoff_hz = 1_000.0;
        settings.key_follow = 1.0;
        // An octave above the pivot doubles the cutoff; the voice has to still
        // be producing sound with more top than the low note.
        high_voice.start(72, 1.0, 0.0, &settings);
        let high = mono(&render(&mut high_voice, &settings, 0.2))
            .windows(2)
            .map(|p| (p[1] - p[0]).abs())
            .sum::<f32>();

        let (mut low_voice, _) = voice();
        low_voice.start(48, 1.0, 0.0, &settings);
        let low = mono(&render(&mut low_voice, &settings, 0.2))
            .windows(2)
            .map(|p| (p[1] - p[0]).abs())
            .sum::<f32>();
        assert!(high > low, "key follow did not brighten the top: {high} vs {low}");
    }

    #[test]
    fn an_lfo_routed_to_pitch_actually_moves_it() {
        // The headline. In the browser build this was structurally impossible:
        // the matrix was folded to scalars at note-on, so an LFO contributed
        // its value at that instant and never again.
        let (mut voice, mut settings) = voice();
        settings.lfo[0].rate_hz = 8.0;
        settings.lfo[0].shape = LfoShape::Sine;
        settings.matrix.set(ModSource::Lfo1, ModDest::Osc1Pitch, 1.0);
        voice.start(60, 1.0, 0.0, &settings);

        // Zero crossings in the first eighth of the LFO cycle versus the third
        // eighth: with a sine on pitch, one is sharp and the other flat.
        let samples = mono(&render(&mut voice, &settings, 0.25));
        let window = (RATE / 8.0 / 4.0) as usize;
        let count = |slice: &[f32]| {
            slice.windows(2).filter(|p| p[0] <= 0.0 && p[1] > 0.0).count()
        };
        let sharp = count(&samples[window..window * 2]);
        let flat = count(&samples[window * 3..window * 4]);
        assert!(sharp != flat, "pitch never moved: {sharp} and {flat}");
    }

    #[test]
    fn an_lfo_routed_to_volume_makes_a_tremolo() {
        let (mut voice, mut settings) = voice();
        settings.lfo[0].rate_hz = 6.0;
        settings.matrix.set(ModSource::Lfo1, ModDest::Volume, 1.0);
        voice.start(60, 1.0, 0.0, &settings);
        let samples = render(&mut voice, &settings, 0.4);

        // Peak level in successive tenth-cycles differs, which a static voice's
        // would not.
        let chunk = (RATE / 6.0 / 4.0) as usize;
        let a = peak(&samples[chunk..chunk * 2]);
        let b = peak(&samples[chunk * 2..chunk * 3]);
        assert!((a - b).abs() > 0.02, "no tremolo: {a} and {b}");
    }

    #[test]
    fn a_free_lfo_is_shared_across_notes_but_a_note_lfo_is_not() {
        // §9.6's distinction, at the level where it is audible.
        let (mut free, mut settings) = voice();
        settings.lfo[0].trigger = LfoTrigger::Free;
        settings.lfo[0].shape = LfoShape::Sawtooth;
        settings.lfo[0].rate_hz = 2.0;
        settings.matrix.set(ModSource::Lfo1, ModDest::Volume, 1.0);
        free.start(60, 1.0, 0.0, &settings);
        render(&mut free, &settings, 0.25);
        let before = free.lfos[0].phase();
        free.start(60, 1.0, 0.0, &settings);
        assert_eq!(free.lfos[0].phase(), before, "a note restarted a free LFO");

        let mut note_settings = settings.clone();
        note_settings.lfo[0].trigger = LfoTrigger::Note;
        let (mut retriggered, _) = voice();
        retriggered.start(60, 1.0, 0.0, &note_settings);
        render(&mut retriggered, &note_settings, 0.25);
        let before = retriggered.lfos[0].phase();
        retriggered.start(60, 1.0, 0.0, &note_settings);
        assert!((retriggered.lfos[0].phase() - before).abs() > 0.01, "a note did not restart a Note LFO");
    }

    #[test]
    fn velocity_to_cutoff_makes_a_harder_note_brighter() {
        let at = |velocity: f32| {
            let (mut v, mut settings) = voice();
            settings.cutoff_hz = 400.0;
            settings.matrix.set(ModSource::Velocity, ModDest::FilterCutoff, 1.0);
            v.start(48, velocity, 0.0, &settings);
            brightness(&mono(&render(&mut v, &settings, 0.2)))
        };
        let hard = at(1.0);
        let soft = at(0.2);
        assert!(hard > soft * 1.5, "velocity did not open the filter: {hard} vs {soft}");
    }

    #[test]
    fn pan_is_equal_power_and_holds_its_loudness() {
        let loudness = |pan: f32| {
            let (mut voice, mut settings) = voice();
            settings.pan = pan;
            voice.start(60, 1.0, 0.0, &settings);
            let samples = render(&mut voice, &settings, 0.1);
            let power: f32 = samples.iter().map(|s| s.left * s.left + s.right * s.right).sum();
            (power / samples.len() as f32).sqrt()
        };
        let centre = loudness(0.0);
        for pan in [-1.0, -0.5, 0.5, 1.0] {
            let value = loudness(pan);
            assert!((value / centre - 1.0).abs() < 0.1, "pan {pan} changed loudness: {value} vs {centre}");
        }
    }

    #[test]
    fn hard_left_and_hard_right_reach_one_side_only() {
        let (mut left, mut settings) = voice();
        settings.pan = -1.0;
        left.start(60, 1.0, 0.0, &settings);
        let samples = render(&mut left, &settings, 0.1);
        let left_energy: f32 = samples.iter().map(|s| s.left.abs()).sum();
        let right_energy: f32 = samples.iter().map(|s| s.right.abs()).sum();
        assert!(right_energy < left_energy * 0.01, "hard left leaked right");
    }

    #[test]
    fn a_stolen_voice_fades_and_stops_and_a_killed_one_stops_at_once() {
        let (mut voice, mut settings) = voice();
        settings.amp.release = 5.0;
        voice.start(60, 1.0, 0.0, &settings);
        render(&mut voice, &settings, 0.1);
        voice.steal();
        assert!(voice.is_active() && voice.is_released());
        let fade = render(&mut voice, &settings, 0.05);
        // A 20 ms time constant from where it was, stopped at 40 ms.
        assert!(fade[0].left.abs() > 0.0);
        assert!(!voice.is_active());
        assert_eq!(voice.note(), None);
        assert!(fade[1_920..].iter().all(|s| s.left == 0.0));
        voice.steal();
        voice.release(&settings);

        voice.start(60, 1.0, 0.0, &settings);
        render(&mut voice, &settings, 0.1);
        voice.kill();
        assert!(!voice.is_active());
        assert_eq!(peak(&render(&mut voice, &settings, 0.05)), 0.0);
    }

    #[test]
    fn the_output_is_finite_across_the_whole_control_surface() {
        // Every knob at an extreme at once, with the matrix full. This is the
        // configuration a preset randomiser finds and a person eventually does.
        let (mut voice, mut settings) = voice();
        settings.levels = [1.0; OSC_COUNT];
        settings.waves = [Wave::Pulse; OSC_COUNT];
        settings.pulse_width = [0.05, 0.95, 0.5];
        settings.detune_semis = [-24.0, 0.0, 24.0];
        settings.cutoff_hz = MIN_CUTOFF_HZ;
        settings.resonance = 1.0;
        settings.filter_env_octaves = 8.0;
        settings.key_follow = 1.0;
        for s in 0..SOURCE_COUNT as u32 {
            for d in 0..DEST_COUNT as u32 {
                settings.matrix.set(
                    ModSource::from_u32(s).expect("source"),
                    ModDest::from_u32(d).expect("dest"),
                    if (s + d) % 2 == 0 { 1.0 } else { -1.0 },
                );
            }
        }
        voice.set_mod_wheel(1.0);
        for note in [0u8, 60, 127] {
            voice.start(note, 1.0, 0.0, &settings);
            for sample in render(&mut voice, &settings, 0.2) {
                assert!(sample.left.is_finite() && sample.right.is_finite(), "not finite on note {note}");
                assert!(sample.left.abs() <= 64.0, "ran away on note {note}: {}", sample.left);
            }
        }
    }

    #[test]
    fn the_same_note_renders_identically_every_time() {
        // §31.2's render-from-data depends on this at the voice level.
        let settings = VoiceSettings::default();
        let mut a = TestVoice::new(4);
        let mut b = TestVoice::new(4);
        a.start(64, 0.8, 0.0, &settings);
        b.start(64, 0.8, 0.0, &settings);
        for i in 0..20_000 {
            let (x, y) = (a.next(&settings), b.next(&settings));
            assert_eq!(x.left, y.left, "diverged at {i}");
            assert_eq!(x.right, y.right, "diverged at {i}");
        }
    }

    #[test]
    fn a_silent_oscillator_still_keeps_its_place() {
        // Turning one back up should rejoin the others in phase rather than
        // wherever it happened to be left.
        let (mut a, mut settings) = voice();
        settings.levels = [1.0, 0.0, 0.0];
        a.start(60, 1.0, 0.0, &settings);
        render(&mut a, &settings, 0.1);

        let mut both = settings.clone();
        both.levels = [1.0, 1.0, 0.0];
        let (mut b, _) = voice();
        b.start(60, 1.0, 0.0, &both);
        render(&mut b, &both, 0.1);
        // Both oscillators tuned alike and in phase: the mix is coherent, so
        // the second raises the level rather than partially cancelling.
        assert!(peak(&render(&mut b, &both, 0.05)) > 0.0);
    }

    #[test]
    fn each_wave_is_the_browser_oscillator_itself() {
        // Classic, so the oscillator comes out as it is, times the envelope.
        let render_wave = |wave: Wave| {
            let (mut voice, mut settings) = voice();
            settings.classic = true;
            settings.waves = [wave; OSC_COUNT];
            settings.amp = AdsrSettings { attack: 0.0, decay: 0.0, sustain: 1.0, release: 0.1 };
            voice.start(69, 1.0, 0.0, &settings);
            render(&mut voice, &settings, 0.01).iter().map(|s| s.classic).collect::<Vec<f32>>()
        };
        // A 440 Hz sawtooth, as `webAudioLaws.test.ts` renders it.
        let saw = render_wave(Wave::Sawtooth);
        for (k, expected) in [(1, 0.011_840_009f32), (10, 0.161_495_61), (54, 0.656_023_86), (99, -0.163_309_31)] {
            assert!((saw[k] - expected).abs() < 3e-6, "saw[{k}] = {}", saw[k]);
        }
        for wave in [Wave::Sine, Wave::Triangle, Wave::Square, Wave::Pulse] {
            let samples = render_wave(wave);
            let top = samples.iter().fold(0.0f32, |a, v| a.max(v.abs()));
            assert!(top > 0.9 && top <= 1.0 + 1e-6, "{wave:?} peaks at {top}");
        }
    }

    #[test]
    fn a_notes_pulse_is_built_at_its_width_and_kept_for_its_life() {
        let duty = |settings: &mut VoiceSettings, change: f32| {
            let mut voice = TestVoice::new(3);
            settings.classic = true;
            settings.waves = [Wave::Pulse; OSC_COUNT];
            settings.amp = AdsrSettings { attack: 0.0, decay: 0.0, sustain: 1.0, release: 0.1 };
            voice.start(57, 1.0, 0.0, settings);
            settings.pulse_width = [change; OSC_COUNT];
            let samples = render(&mut voice, settings, 0.1);
            samples[1_000..].iter().filter(|s| s.classic > 0.0).count() as f32 / (samples.len() - 1_000) as f32
        };
        let mut settings = VoiceSettings { pulse_width: [0.2; OSC_COUNT], ..VoiceSettings::default() };
        // The knob moving mid-note does not reach it.
        assert!((duty(&mut settings, 0.8) - 0.2).abs() < 0.03);
    }

    #[test]
    fn a_sequenced_note_writes_its_release_at_the_gate() {
        // Pinned in synthLaws.test.ts: a 10 ms attack, 80 ms decay to 0.6,
        // a 200 ms release, a 125 ms step gated at 85 %.
        let (mut voice, mut settings) = voice();
        settings.classic = true;
        settings.amp = AdsrSettings { attack: 0.01, decay: 0.08, sustain: 0.6, release: 0.2 };
        voice.start_gated(60, &settings, 0.125 * ORIGINAL_GATE);
        assert!(voice.is_released());
        let mut values = Vec::new();
        for _ in 0..16_000 {
            voice.next(&settings);
            values.push(voice.amp.value());
        }
        for (k, expected) in [(0, 0.0f32), (240, 0.5), (480, 1.0), (2_400, 0.8), (4_320, 0.6), (5_100, 0.6), (5_101, 0.599_937_5), (9_900, 0.3), (14_700, 0.0)] {
            assert!((values[k] - expected).abs() < 1e-5, "amp[{k}] = {}", values[k]);
        }
        // Stopped 50 ms after the release ends: 106.25 + 200 + 50 ms.
        render(&mut voice, &settings, 0.022);
        assert!(voice.is_active());
        render(&mut voice, &settings, 0.002);
        assert!(!voice.is_active());
        settings.classic = false;
        voice.start_gated(60, &settings, 0.0);
        render(&mut voice, &settings, 0.2);
        assert!(voice.is_active());
        render(&mut voice, &settings, 0.06);
        assert!(!voice.is_active());
    }

    #[test]
    fn a_gate_inside_the_attack_holds_silence_until_the_gate() {
        // The original's own event order: the sustain set at the gate sorts
        // before the attack's end, so the note is silent until the gate, then
        // jumps to the sustain and ramps on to the peak.
        let (mut voice, mut settings) = voice();
        settings.amp = AdsrSettings { attack: 0.15, decay: 0.08, sustain: 0.6, release: 0.2 };
        voice.start_gated(60, &settings, 0.106_25);
        let mut values = Vec::new();
        for _ in 0..12_000 {
            voice.next(&settings);
            values.push(voice.amp.value());
        }
        // (Frame 5 100 is the gate itself; the step crosses the ABI as an f32,
        // so a frame exactly on the gate is the one place the two can differ.)
        for (k, expected) in [(100, 0.0f32), (5_099, 0.0), (5_101, 0.600_190_5), (6_000, 0.771_428_6), (7_200, 1.0), (9_000, 0.812_5), (11_040, 0.6)] {
            assert!((values[k] - expected).abs() < 1e-4, "amp[{k}] = {}", values[k]);
        }
    }

    #[test]
    fn a_live_release_is_written_over_the_envelope_without_cancelling_it() {
        let (mut voice, mut settings) = voice();
        settings.amp = AdsrSettings { attack: 0.15, decay: 0.08, sustain: 0.6, release: 0.2 };
        voice.start(60, 1.0, 0.0, &settings);
        render(&mut voice, &settings, 0.106_25);
        voice.release(&settings);
        voice.release(&settings);
        let mut values = Vec::new();
        for _ in 0..7_000 {
            voice.next(&settings);
            values.push(voice.amp.value());
        }
        // From the release on, exactly the sequenced note's curve.
        for (k, expected) in [(0, 0.6f32), (900, 0.771_428_6), (2_100, 1.0), (3_900, 0.812_5), (5_940, 0.6)] {
            assert!((values[k] - expected).abs() < 1e-4, "amp[{k}] = {}", values[k]);
        }
    }

    #[test]
    fn a_sounding_notes_filter_follows_the_knob() {
        let (mut voice, mut settings) = voice();
        settings.cutoff_hz = 300.0;
        settings.knob_hz = 300.0;
        voice.start(48, 1.0, 0.0, &settings);
        render(&mut voice, &settings, 0.05);
        let dark = brightness(&mono(&render(&mut voice, &settings, 0.1)));
        settings.cutoff_hz = 12_000.0;
        let bright = brightness(&mono(&render(&mut voice, &settings, 0.1)));
        assert!(bright > dark * 2.0, "{bright} vs {dark}");
    }

    #[test]
    fn a_notes_filter_envelope_is_an_offset_that_follows_the_knob() {
        let (mut voice, mut settings) = voice();
        settings.cutoff_hz = 1_000.0;
        settings.knob_hz = 1_000.0;
        settings.filter_env_amount = 1.0;
        settings.filter_env = AdsrSettings { attack: 0.01, decay: 0.15, sustain: 0.3, release: 0.3 };
        // An amp that outlasts the filter's release, so the voice keeps running.
        settings.amp.release = 0.5;
        voice.start(60, 1.0, 0.0, &settings);
        let offsets: Vec<f32> = (0..9_000).map(|_| {
            voice.next(&settings);
            voice.filter_env.value()
        }).collect();
        assert!(offsets[0].abs() < 1e-3);
        assert!((offsets[480] - 15_000.0).abs() < 1.0);
        assert!((offsets[8_999] - 4_500.0).abs() < 1e-2);
        // Turning the knob mid-note moves the filter, not the envelope.
        settings.cutoff_hz = 3_000.0;
        voice.next(&settings);
        assert!((voice.filter_env.value() - 4_500.0).abs() < 1e-2);
        voice.release(&settings);
        render(&mut voice, &settings, 0.35);
        assert!(voice.filter_env.value().abs() < 1e-3, "released to the base");
    }

    #[test]
    fn a_classic_voice_hands_its_sound_on_unfiltered_and_unpanned() {
        let (mut voice, mut settings) = voice();
        settings.classic = true;
        settings.pan = -1.0;
        voice.start(60, 1.0, 0.0, &settings);
        let samples = render(&mut voice, &settings, 0.05);
        assert!(samples.iter().all(|s| s.left == 0.0 && s.right == 0.0));
        assert!(samples.iter().any(|s| s.classic.abs() > 0.1));
    }

    #[test]
    fn a_notes_pulse_swing_widens_its_pulse_for_the_life_of_the_note() {
        let duty = |swing: f32| {
            let (mut voice, mut settings) = voice();
            settings.classic = true;
            settings.waves = [Wave::Pulse; OSC_COUNT];
            settings.pw_swing = swing;
            voice.start(60, 1.0, 0.0, &settings);
            settings.pw_swing = 0.0;
            let samples = render(&mut voice, &settings, 0.1);
            samples[1_000..].iter().filter(|s| s.classic > 0.0).count() as f32 / (samples.len() - 1_000) as f32
        };
        assert!((duty(0.0) - 0.5).abs() < 0.03);
        assert!((duty(0.3) - 0.8).abs() < 0.03);
        assert!((duty(0.9) - 0.95).abs() < 0.03);
        let (mut voice, mut settings) = voice();
        settings.pw_swing = f32::NAN;
        voice.start(60, f32::NAN, 0.0, &settings);
        assert!(render(&mut voice, &settings, 0.01).iter().all(|s| s.left == 0.0));
    }
}
