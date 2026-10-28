//! Straight sample playback: the percussion kit and the looper.
//!
//! Distinct from `grain.rs` on purpose. A grain cloud emits many short reads
//! from a scan point; this plays one read from start to end, optionally
//! looping. Trying to serve both from one structure would mean a cloud with a
//! grain count of one and no window, which is a worse sampler and a worse
//! cloud.
//!
//! # Notes address samples through a table, not a parameter
//!
//! A percussion kit maps note numbers to different files. That mapping is
//! structural — it comes from the document's slot editor — and it is not a
//! value anyone turns, so it arrives through `set_sample_slot` rather than as
//! a parameter. The table is indexed by MIDI note directly: 128 `u32`s is half
//! a kilobyte, which is cheaper than any scheme for compressing it and removes
//! every question about what a note maps to.

use crate::clamp;
use crate::samples::SampleBank;

/// Every MIDI note can name its own sample.
pub const SLOT_COUNT: usize = 128;

/// Nothing assigned. Matches the engine's own `NO_MODULE` convention.
pub const NO_SAMPLE: u32 = u32::MAX;

/// How many notes may sound at once before the oldest is taken. The browser
/// kit's `DEFAULT_MAX_VOICES`.
pub const MAX_VOICES: usize = 32;

/// Room for the ceiling plus voices still fading out, which the browser no
/// longer counts once a choke or a steal has taken them.
const VOICE_SLOTS: usize = MAX_VOICES * 2;

/// How long a choked, stolen or silenced voice takes to get out of the way:
/// the browser's `CHOKE_SEC`, as a `setTargetAtTime` time constant, stopped
/// two of them later.
pub const CHOKE_SEC: f32 = 0.02;

#[derive(Clone, Copy, Debug)]
pub struct SamplerSettings {
    /// Playback rate, before the file-to-device ratio. 1 is unity.
    pub rate: f32,
    /// Extra pitch in semitones, folded into the rate.
    pub pitch_semitones: f32,
    pub looping: bool,
    /// Loop bounds as fractions of the buffer.
    pub loop_start: f32,
    pub loop_end: f32,
    pub reverse: bool,
    /// Amplitude release once the note ends, in seconds — or, with
    /// `hit_decay`, the time constant of the hit's decay.
    pub decay_sec: f32,
    /// True: the note sounds only while held. False: it runs to the end
    /// regardless, which is what a drum hit wants.
    pub gate: bool,
    /// The browser kit's envelope: from the strike the level falls as
    /// `setTargetAtTime(0, start, decay)` does, and the voice stops three time
    /// constants in.
    pub hit_decay: bool,
}

impl Default for SamplerSettings {
    fn default() -> Self {
        Self {
            rate: 1.0,
            pitch_semitones: 0.0,
            looping: false,
            loop_start: 0.0,
            loop_end: 1.0,
            reverse: false,
            decay_sec: 0.5,
            gate: false,
            hit_decay: false,
        }
    }
}

/// Semitones to a frequency ratio. Twelve of them double it.
pub fn semitone_ratio(semitones: f32) -> f32 {
    2.0f32.powf(clamp(semitones, -60.0, 60.0) / 12.0)
}

/// What a kit pad does to its sample beyond naming it.
#[derive(Clone, Copy)]
struct Shape {
    gain: f32,
    /// Left and right gains, or `None` for a centred pad, which the browser
    /// plays with no panner of its own: the same signal in both channels.
    pan: Option<(f32, f32)>,
    /// Pads sharing a positive group silence each other.
    choke: i32,
}

impl Default for Shape {
    fn default() -> Self {
        Self { gain: 1.0, pan: None, choke: 0 }
    }
}

#[derive(Clone, Copy)]
struct Voice {
    active: bool,
    note: u8,
    sample: u32,
    /// Read head in frames.
    position: f32,
    advance: f32,
    /// Level at the strike: pad gain × velocity².
    amplitude: f32,
    /// Per-sample amplitude step while releasing; 0 while sustaining.
    release_step: f32,
    /// Held down. A gated voice releases when this goes false.
    held: bool,
    /// Frames since the strike.
    age: u32,
    /// The hit decay's time constant in frames, or 0 for none.
    decay_frames: f32,
    /// Frames the voice may play for, or infinity.
    life_frames: f32,
    pan: Option<(f32, f32)>,
    choke: i32,
    /// Set once the voice is choked, stolen or silenced: the level it fades
    /// from, and the frames since.
    fade_from: Option<f32>,
    fade_age: u32,
}

impl Default for Voice {
    fn default() -> Self {
        Self {
            active: false,
            note: 0,
            sample: NO_SAMPLE,
            position: 0.0,
            advance: 0.0,
            amplitude: 0.0,
            release_step: 0.0,
            held: false,
            age: 0,
            decay_frames: 0.0,
            life_frames: f32::INFINITY,
            pan: None,
            choke: 0,
            fade_from: None,
            fade_age: 0,
        }
    }
}

impl Voice {
    /// The level this frame plays at.
    fn level(&self, choke_frames: f32) -> f32 {
        if let Some(from) = self.fade_from {
            return from * (-(self.fade_age as f32) / choke_frames).exp();
        }
        if self.decay_frames > 0.0 {
            self.amplitude * (-(self.age as f32) / self.decay_frames).exp()
        } else {
            self.amplitude
        }
    }

    fn fading(&self) -> bool {
        self.fade_from.is_some()
    }
}

/// A polyphonic sample player.
pub struct Sampler {
    voices: [Voice; VOICE_SLOTS],
    slots: [u32; SLOT_COUNT],
    shapes: [Shape; SLOT_COUNT],
    sample_rate: f32,
}

impl Sampler {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            voices: [Voice::default(); VOICE_SLOTS],
            slots: [NO_SAMPLE; SLOT_COUNT],
            shapes: [Shape::default(); SLOT_COUNT],
            sample_rate: if sample_rate > 0.0 { sample_rate } else { 48_000.0 },
        }
    }

    pub fn set_sample_rate(&mut self, sample_rate: f32) {
        self.sample_rate = if sample_rate > 0.0 { sample_rate } else { 48_000.0 };
        self.clear();
    }

    /// Point one note at a sample. `NO_SAMPLE` clears the assignment.
    pub fn set_slot(&mut self, slot: u32, sample: u32) {
        if (slot as usize) < SLOT_COUNT {
            self.slots[slot as usize] = sample;
        }
    }

    /// A kit pad's gain, pan (−1 to +1) and choke group, as the browser kit
    /// reads them: pan clamped, and a pan of exactly 0 meaning no panner.
    pub fn set_slot_shape(&mut self, slot: u32, gain: f32, pan: f32, choke: i32) {
        let Some(shape) = self.shapes.get_mut(slot as usize) else { return };
        let pan = if pan.is_finite() { clamp(pan, -1.0, 1.0) } else { 0.0 };
        let angle = (pan + 1.0) * core::f32::consts::FRAC_PI_4;
        *shape = Shape {
            gain: if gain.is_finite() { gain } else { 1.0 },
            pan: if pan == 0.0 { None } else { Some((angle.cos(), angle.sin())) },
            choke,
        };
    }

    /// What a note plays, or `NO_SAMPLE`.
    pub fn slot(&self, note: u8) -> u32 {
        self.slots[note as usize]
    }

    /// Voices making sound, those fading out included.
    pub fn active_voices(&self) -> usize {
        self.voices.iter().filter(|voice| voice.active).count()
    }

    /// Voices that count toward the ceiling: sounding and not on their way out.
    pub fn sounding_voices(&self) -> usize {
        self.voices.iter().filter(|voice| voice.active && !voice.fading()).count()
    }

    pub fn clear(&mut self) {
        self.voices = [Voice::default(); VOICE_SLOTS];
    }

    /// Fade everything out over the choke time, as the browser's panic does.
    pub fn all_notes_off(&mut self) {
        let choke_frames = self.choke_frames();
        for voice in &mut self.voices {
            voice.held = false;
            if voice.active && !voice.fading() {
                Self::fade_out(voice, choke_frames);
            }
        }
    }

    fn choke_frames(&self) -> f32 {
        CHOKE_SEC * self.sample_rate
    }

    /// Start a voice's fade from the level it is at now.
    fn fade_out(voice: &mut Voice, choke_frames: f32) {
        voice.fade_from = Some(voice.level(choke_frames));
        voice.fade_age = 0;
        voice.release_step = 0.0;
    }

    fn fade_step(&self, seconds: f32) -> f32 {
        1.0 / (seconds.max(0.0005) * self.sample_rate)
    }

    /// `detune_cents` is the microtonal remainder of the note, and for a
    /// sampler that is a playback rate: there is no oscillator to retune, so a
    /// pitch between the keys is the same audio read fractionally faster.
    /// Compounds with `settings.pitch_semitones` rather than replacing it —
    /// one is what the patch does to every note, the other is what the score
    /// asked of this one.
    ///
    /// The level is the pad's gain times velocity squared, as the browser's
    /// `velocityGain` has it: loudness is not linear in velocity.
    pub fn note_on(
        &mut self,
        bank: &SampleBank,
        note: u8,
        velocity: f32,
        detune_cents: f32,
        settings: &SamplerSettings,
    ) {
        let sample = self.slots[note as usize];
        // An unassigned note is silence, not a fault: a kit with eight of
        // sixteen slots filled is normal, and the other eight must do nothing.
        if sample == NO_SAMPLE {
            return;
        }
        let Some(audio) = bank.get(sample) else { return };
        let frames = audio.frames();
        if frames < 2 {
            return;
        }

        let cents = if detune_cents.is_finite() { detune_cents } else { 0.0 };
        let ratio =
            semitone_ratio(settings.pitch_semitones + cents / 100.0) * settings.rate;
        let mut advance = bank.advance_per_sample(sample, self.sample_rate, ratio);
        if settings.reverse {
            advance = -advance;
        }
        let last = (frames - 1) as f32;
        let position = if settings.reverse { last } else { 0.0 };
        let shape = self.shapes[note as usize];
        let choke_frames = self.choke_frames();

        // The browser's order: the group is choked, then the ceiling enforced,
        // then the new voice starts.
        if shape.choke > 0 {
            for voice in &mut self.voices {
                if voice.active && !voice.fading() && voice.choke == shape.choke {
                    Self::fade_out(voice, choke_frames);
                }
            }
        }
        while self.sounding_voices() >= MAX_VOICES {
            let oldest = (0..VOICE_SLOTS)
                .filter(|&i| self.voices[i].active && !self.voices[i].fading())
                .max_by_key(|&i| self.voices[i].age)
                .unwrap_or(0);
            Self::fade_out(&mut self.voices[oldest], choke_frames);
        }

        let velocity = if velocity.is_finite() { clamp(velocity, 0.0, 1.0) } else { 0.0 };
        let (decay_frames, life_frames) = if settings.hit_decay {
            let tau = settings.decay_sec.max(0.001) * self.sample_rate;
            (tau, 3.0 * tau)
        } else {
            (0.0, f32::INFINITY)
        };
        let index = self.free_or_oldest();
        self.voices[index] = Voice {
            active: true,
            note,
            sample,
            position,
            advance,
            amplitude: shape.gain * velocity * velocity,
            release_step: 0.0,
            held: true,
            age: 0,
            decay_frames,
            life_frames,
            pan: shape.pan,
            choke: shape.choke,
            fade_from: None,
            fade_age: 0,
        };
    }

    pub fn note_off(&mut self, note: u8, settings: &SamplerSettings) {
        // Computed before the loop: it reads `self.sample_rate`, which the
        // mutable borrow of `self.voices` would otherwise rule out.
        let step = self.fade_step(settings.decay_sec);
        for voice in &mut self.voices {
            if voice.active && voice.note == note {
                voice.held = false;
                // Only a gated voice cares. A drum hit runs to the end whether
                // the key is still down or not, which is the whole difference
                // between a kit and a keyboard.
                if settings.gate && !voice.fading() {
                    voice.release_step = step;
                }
            }
        }
    }

    /// A free voice, or failing that the one furthest through its fade.
    fn free_or_oldest(&mut self) -> usize {
        let mut oldest = 0;
        for (index, voice) in self.voices.iter().enumerate() {
            if !voice.active {
                return index;
            }
            if voice.fade_age > self.voices[oldest].fade_age {
                oldest = index;
            }
        }
        oldest
    }

    /// One output sample for a source with no panned pads, summing every voice.
    pub fn process(&mut self, bank: &SampleBank, settings: &SamplerSettings) -> f32 {
        self.process_stereo(bank, settings)[0]
    }

    /// One stereo frame. A centred pad is the same in both channels; a panned
    /// one takes Web Audio's equal-power law for a mono source.
    pub fn process_stereo(&mut self, bank: &SampleBank, settings: &SamplerSettings) -> [f32; 2] {
        let choke_frames = self.choke_frames();
        let mut sum = [0.0f32; 2];
        for voice in &mut self.voices {
            if !voice.active {
                continue;
            }
            let Some(audio) = bank.get(voice.sample) else {
                voice.active = false;
                continue;
            };
            let frames = audio.frames();
            let last = (frames - 1) as f32;

            let value = audio.read(0, voice.position) * voice.level(choke_frames);
            match voice.pan {
                Some((left, right)) => {
                    sum[0] += value * left;
                    sum[1] += value * right;
                }
                None => {
                    sum[0] += value;
                    sum[1] += value;
                }
            }
            voice.position += voice.advance;
            voice.age += 1;

            if voice.fading() {
                voice.fade_age += 1;
                if voice.fade_age as f32 >= 2.0 * choke_frames {
                    voice.active = false;
                    continue;
                }
            }
            if voice.age as f32 >= voice.life_frames {
                voice.active = false;
                continue;
            }
            if voice.release_step > 0.0 {
                voice.amplitude -= voice.release_step;
                if voice.amplitude <= 0.0 {
                    voice.active = false;
                    continue;
                }
            }

            if settings.looping {
                // Fractions of the buffer, ordered so a start above the end is
                // read as the same span rather than as an empty one.
                let a = clamp(settings.loop_start, 0.0, 1.0) * last;
                let b = clamp(settings.loop_end, 0.0, 1.0) * last;
                let (low, high) = if a <= b { (a, b) } else { (b, a) };
                let span = high - low;
                if span > 1.0 {
                    if voice.position > high {
                        voice.position = low + (voice.position - high);
                    } else if voice.position < low {
                        voice.position = high - (low - voice.position);
                    }
                    continue;
                }
            }

            // Past either end and not looping: done.
            if voice.position < 0.0 || voice.position > last {
                voice.active = false;
            }
        }
        sum
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f32 = 48_000.0;

    /// One second of DC in slot 0, assigned to note 60.
    fn rig() -> (SampleBank, Sampler) {
        let mut bank = SampleBank::new();
        bank.allocate(0, 1, RATE as usize, RATE);
        for slot in bank.get_mut(0).unwrap().data_mut() {
            *slot = 1.0;
        }
        let mut sampler = Sampler::new(RATE);
        sampler.set_slot(60, 0);
        (bank, sampler)
    }

    fn settings() -> SamplerSettings {
        SamplerSettings::default()
    }

    #[test]
    fn semitones_convert_to_a_ratio() {
        assert!((semitone_ratio(0.0) - 1.0).abs() < 1e-6);
        assert!((semitone_ratio(12.0) - 2.0).abs() < 1e-5);
        assert!((semitone_ratio(-12.0) - 0.5).abs() < 1e-5);
    }

    #[test]
    fn a_note_plays_its_assigned_sample() {
        let (bank, mut sampler) = rig();
        sampler.note_on(&bank, 60, 1.0, 0.0, &settings());
        assert_eq!(sampler.active_voices(), 1);
        assert!((sampler.process(&bank, &settings()) - 1.0).abs() < 1e-3);
    }

    /// A one-second ramp from 0 to 1, so the value read *is* the read head's
    /// position — which is how a rate change becomes something to assert on.
    fn ramp_rig() -> (SampleBank, Sampler) {
        let mut bank = SampleBank::new();
        let frames = RATE as usize;
        bank.allocate(0, 1, frames, RATE);
        let data = bank.get_mut(0).unwrap().data_mut();
        for (index, slot) in data.iter_mut().enumerate() {
            *slot = index as f32 / frames as f32;
        }
        let mut sampler = Sampler::new(RATE);
        sampler.set_slot(60, 0);
        (bank, sampler)
    }

    #[test]
    fn a_notes_detune_speeds_the_playback_up() {
        // A sampler has no oscillator to retune, so a pitch between the keys is
        // the same audio read faster. 1200 cents is an octave, so the head
        // should be at twice the position after the same number of samples.
        let advance_after = |cents: f32| {
            let (bank, mut sampler) = ramp_rig();
            sampler.note_on(&bank, 60, 1.0, cents, &settings());
            let mut last = 0.0;
            for _ in 0..1000 {
                last = sampler.process(&bank, &settings());
            }
            last
        };
        let plain = advance_after(0.0);
        let octave_up = advance_after(1200.0);
        assert!(plain > 0.0);
        let ratio = octave_up / plain;
        assert!((ratio - 2.0).abs() < 0.05, "expected 2x, got {ratio}");
    }

    #[test]
    fn a_notes_detune_compounds_with_the_patchs_pitch() {
        // One is what the patch does to every note, the other is what the score
        // asked of this one; an octave of each is two octaves.
        let (bank, mut sampler) = ramp_rig();
        let up_an_octave = SamplerSettings { pitch_semitones: 12.0, ..settings() };
        sampler.note_on(&bank, 60, 1.0, 1200.0, &up_an_octave);
        let mut last = 0.0;
        for _ in 0..1000 {
            last = sampler.process(&bank, &up_an_octave);
        }

        let (plain_bank, mut plain) = ramp_rig();
        plain.note_on(&plain_bank, 60, 1.0, 0.0, &settings());
        let mut base = 0.0;
        for _ in 0..1000 {
            base = plain.process(&plain_bank, &settings());
        }
        let ratio = last / base;
        assert!((ratio - 4.0).abs() < 0.1, "expected 4x, got {ratio}");
    }

    #[test]
    fn a_nonsense_detune_still_plays_the_note() {
        // NaN in the advance would leave the read head lost for the life of the
        // voice, and silence is the worse of the two failures.
        let (bank, mut sampler) = rig();
        sampler.note_on(&bank, 60, 1.0, f32::NAN, &settings());
        assert_eq!(sampler.active_voices(), 1);
        assert!((sampler.process(&bank, &settings()) - 1.0).abs() < 1e-3);
    }

    #[test]
    fn an_unassigned_note_is_silence_rather_than_a_fault() {
        // A kit with half its slots filled is normal; the rest must do nothing.
        let (bank, mut sampler) = rig();
        sampler.note_on(&bank, 61, 1.0, 0.0, &settings());
        assert_eq!(sampler.active_voices(), 0);
        assert_eq!(sampler.process(&bank, &settings()), 0.0);
    }

    #[test]
    fn a_note_whose_sample_is_gone_does_not_fault() {
        let (_, mut sampler) = rig();
        let empty = SampleBank::new();
        sampler.note_on(&empty, 60, 1.0, 0.0, &settings());
        assert_eq!(sampler.process(&empty, &settings()), 0.0);
    }

    #[test]
    fn an_ungated_note_runs_to_the_end_after_the_key_is_released() {
        // The difference between a drum kit and a keyboard: a hit finishes.
        let (bank, mut sampler) = rig();
        let hit = SamplerSettings { gate: false, ..settings() };
        sampler.note_on(&bank, 60, 1.0, 0.0, &hit);
        sampler.note_off(60, &hit);
        for _ in 0..1_000 {
            sampler.process(&bank, &hit);
        }
        assert_eq!(sampler.active_voices(), 1, "a drum hit was cut off by note-off");
    }

    #[test]
    fn a_gated_note_releases_when_the_key_goes_up() {
        let (bank, mut sampler) = rig();
        let held = SamplerSettings { gate: true, decay_sec: 0.01, ..settings() };
        sampler.note_on(&bank, 60, 1.0, 0.0, &held);
        sampler.note_off(60, &held);
        for _ in 0..((RATE * 0.05) as usize) {
            sampler.process(&bank, &held);
        }
        assert_eq!(sampler.active_voices(), 0, "a gated voice never released");
    }

    #[test]
    fn a_one_shot_ends_when_it_reaches_the_end() {
        let (bank, mut sampler) = rig();
        // A short sample so the test does not have to render a whole second.
        let mut short = SampleBank::new();
        short.allocate(0, 1, 64, RATE);
        for slot in short.get_mut(0).unwrap().data_mut() {
            *slot = 1.0;
        }
        sampler.note_on(&short, 60, 1.0, 0.0, &settings());
        for _ in 0..200 {
            sampler.process(&short, &settings());
        }
        assert_eq!(sampler.active_voices(), 0);
        let _ = bank;
    }

    #[test]
    fn reverse_plays_from_the_end_backwards() {
        let mut bank = SampleBank::new();
        bank.allocate(0, 1, 100, RATE);
        // A ramp, so the first sample out states which end it started at.
        let data = bank.get_mut(0).unwrap().data_mut();
        for (i, slot) in data.iter_mut().enumerate() {
            *slot = i as f32;
        }
        let mut sampler = Sampler::new(RATE);
        sampler.set_slot(60, 0);
        let backwards = SamplerSettings { reverse: true, ..settings() };
        sampler.note_on(&bank, 60, 1.0, 0.0, &backwards);
        let first = sampler.process(&bank, &backwards);
        assert!(first > 90.0, "reverse started at the beginning: {first}");
    }

    #[test]
    fn looping_keeps_a_voice_alive_past_the_end() {
        let mut bank = SampleBank::new();
        bank.allocate(0, 1, 200, RATE);
        for slot in bank.get_mut(0).unwrap().data_mut() {
            *slot = 1.0;
        }
        let mut sampler = Sampler::new(RATE);
        sampler.set_slot(60, 0);
        let looped = SamplerSettings { looping: true, ..settings() };
        sampler.note_on(&bank, 60, 1.0, 0.0, &looped);
        for _ in 0..5_000 {
            sampler.process(&bank, &looped);
        }
        assert_eq!(sampler.active_voices(), 1, "the loop ended");
    }

    #[test]
    fn an_inverted_loop_span_is_read_as_the_same_span() {
        // start > end is a slider dragged past its partner, not a request for
        // an empty loop.
        let mut bank = SampleBank::new();
        bank.allocate(0, 1, 200, RATE);
        for slot in bank.get_mut(0).unwrap().data_mut() {
            *slot = 1.0;
        }
        let mut sampler = Sampler::new(RATE);
        sampler.set_slot(60, 0);
        let backwards = SamplerSettings {
            looping: true,
            loop_start: 0.8,
            loop_end: 0.2,
            ..settings()
        };
        sampler.note_on(&bank, 60, 1.0, 0.0, &backwards);
        for _ in 0..3_000 {
            sampler.process(&bank, &backwards);
        }
        assert_eq!(sampler.active_voices(), 1);
    }

    #[test]
    fn pitch_and_rate_both_move_the_playback_speed() {
        let (bank, mut sampler) = rig();
        let up = SamplerSettings { pitch_semitones: 12.0, ..settings() };
        sampler.note_on(&bank, 60, 1.0, 0.0, &up);
        for _ in 0..100 {
            sampler.process(&bank, &up);
        }
        // An octave up covers twice the buffer in the same time; the voice is
        // still running, which only says it did not fall over — the ratio
        // itself is pinned by `semitones_convert_to_a_ratio`.
        assert_eq!(sampler.active_voices(), 1);
    }

    #[test]
    fn plays_several_notes_at_once_and_steals_past_the_ceiling() {
        let (bank, mut sampler) = rig();
        for note in 0..(MAX_VOICES as u8 + 8) {
            sampler.set_slot(u32::from(note), 0);
            sampler.note_on(&bank, note, 1.0, 0.0, &settings());
        }
        assert_eq!(sampler.sounding_voices(), MAX_VOICES);
        assert!(sampler.process(&bank, &settings()).abs() > 0.0);
    }

    #[test]
    fn all_notes_off_fades_everything_as_the_browsers_panic_does() {
        // `setTargetAtTime(0, now, CHOKE_SEC)`, stopped two time constants on —
        // where the browser's fade still stands at e^-2, and so does this one.
        let (bank, mut sampler) = rig();
        sampler.note_on(&bank, 60, 1.0, 0.0, &settings());
        sampler.all_notes_off();
        let first = sampler.process(&bank, &settings());
        assert!((first - 1.0).abs() < 1e-6, "the fade did not start from where it was: {first}");
        let mut last = first;
        for _ in 1..((RATE * 2.0 * CHOKE_SEC) as usize) {
            last = sampler.process(&bank, &settings());
        }
        let expected = (-(2.0 * CHOKE_SEC * RATE - 1.0) / (CHOKE_SEC * RATE)).exp();
        assert!((last - expected).abs() < 1e-5, "{last} vs {expected}");
        assert_eq!(sampler.active_voices(), 0);
    }

    #[test]
    fn clearing_a_slot_stops_new_notes_from_using_it() {
        let (bank, mut sampler) = rig();
        sampler.set_slot(60, NO_SAMPLE);
        sampler.note_on(&bank, 60, 1.0, 0.0, &settings());
        assert_eq!(sampler.active_voices(), 0);
    }

    #[test]
    fn an_out_of_range_slot_is_ignored() {
        let (_, mut sampler) = rig();
        sampler.set_slot(9_999, 0);
        assert_eq!(sampler.slot(60), 0);
    }

    // ---- the browser kit's laws ---------------------------------------------
    //
    // The same hit `src/modular/audio/voices.test.ts` reads off Web Audio's
    // timeline: pad gain 0.9, velocity 64, decay 0.5 s. (The module's level of
    // 0.8 is applied after the sampler, by its shell.)

    const PAD_GAIN: f32 = 0.9;
    const VELOCITY: f32 = 64.0 / 127.0;
    const DECAY: f32 = 0.5;

    fn kit() -> SamplerSettings {
        SamplerSettings { decay_sec: DECAY, hit_decay: true, ..settings() }
    }

    /// Four seconds of DC on notes 42, 46 and 60, so the output is the envelope.
    fn kit_rig() -> (SampleBank, Sampler) {
        let mut bank = SampleBank::new();
        bank.allocate(0, 1, (RATE * 4.0) as usize, RATE);
        for slot in bank.get_mut(0).unwrap().data_mut() {
            *slot = 1.0;
        }
        // Sample 1 is silence: a pad that sounds nothing but still chokes.
        bank.allocate(1, 1, (RATE * 4.0) as usize, RATE);
        let mut sampler = Sampler::new(RATE);
        for note in [42, 46, 60] {
            sampler.set_slot(note, 0);
        }
        (bank, sampler)
    }

    /// Render `frames` and return the last frame's pair.
    fn render(sampler: &mut Sampler, bank: &SampleBank, settings: &SamplerSettings, frames: usize) -> [f32; 2] {
        let mut out = [0.0; 2];
        for _ in 0..frames {
            out = sampler.process_stereo(bank, settings);
        }
        out
    }

    fn near(a: f32, b: f32) -> bool {
        (a - b).abs() <= 1e-6 * b.abs().max(1e-3)
    }

    #[test]
    fn velocity_scales_a_hit_by_its_square() {
        let (bank, mut sampler) = kit_rig();
        sampler.note_on(&bank, 60, VELOCITY, 0.0, &kit());
        let first = sampler.process_stereo(&bank, &kit());
        assert!(near(first[0], VELOCITY * VELOCITY), "{} vs {}", first[0], VELOCITY * VELOCITY);
    }

    #[test]
    fn a_pads_gain_trims_its_hit() {
        let (bank, mut sampler) = kit_rig();
        sampler.set_slot_shape(46, PAD_GAIN, 0.0, 0);
        sampler.note_on(&bank, 46, VELOCITY, 0.0, &kit());
        let start = PAD_GAIN * VELOCITY * VELOCITY;
        assert!(near(sampler.process_stereo(&bank, &kit())[0], start));
    }

    #[test]
    fn a_hit_decays_from_its_start_as_set_target_at_time_does() {
        let (bank, mut sampler) = kit_rig();
        sampler.set_slot_shape(46, PAD_GAIN, 0.0, 0);
        sampler.note_on(&bank, 46, VELOCITY, 0.0, &kit());
        let start = PAD_GAIN * VELOCITY * VELOCITY;
        // Frame 4800 is 0.1 s in.
        let at = render(&mut sampler, &bank, &kit(), 4801)[0];
        assert!(near(at, start * (-0.1f32 / DECAY).exp()), "{at}");
    }

    #[test]
    fn a_hit_stops_three_time_constants_in() {
        let (bank, mut sampler) = kit_rig();
        sampler.note_on(&bank, 60, 1.0, 0.0, &kit());
        let life = (3.0 * DECAY * RATE) as usize;
        render(&mut sampler, &bank, &kit(), life);
        assert_eq!(sampler.active_voices(), 0, "a hit outlived 3 × its decay");
    }

    #[test]
    fn a_centred_pad_is_full_level_in_both_channels() {
        let (bank, mut sampler) = kit_rig();
        sampler.note_on(&bank, 60, 1.0, 0.0, &kit());
        assert_eq!(sampler.process_stereo(&bank, &kit()), [1.0, 1.0]);
    }

    #[test]
    fn a_panned_pad_takes_web_audios_mono_panner_law() {
        let (bank, mut sampler) = kit_rig();
        sampler.set_slot_shape(42, 1.0, 0.35, 0);
        sampler.note_on(&bank, 42, 1.0, 0.0, &kit());
        let out = sampler.process_stereo(&bank, &kit());
        let angle = (0.35f32 + 1.0) * core::f32::consts::FRAC_PI_4;
        // Read off Chrome's own StereoPannerNode: 0.4886212, 0.8724960.
        assert!(near(out[0], angle.cos()) && near(out[1], angle.sin()), "{out:?}");
        assert!(near(out[0], 0.488_621_23) && near(out[1], 0.872_496_0), "{out:?}");
    }

    #[test]
    fn a_choke_fades_the_group_from_where_it_is() {
        let (bank, mut sampler) = kit_rig();
        sampler.set_slot_shape(46, PAD_GAIN, 0.0, 1);
        sampler.set_slot_shape(42, 1.0, 0.0, 1);
        sampler.note_on(&bank, 46, VELOCITY, 0.0, &kit());
        let start = PAD_GAIN * VELOCITY * VELOCITY;
        // 0.12 s of open hat, then the closed hat strikes on frame 5760.
        render(&mut sampler, &bank, &kit(), 5760);
        sampler.set_slot(42, 1); // a silent closed hat: hear only the open hat's fade
        sampler.note_on(&bank, 42, 1.0, 0.0, &kit());
        let at_choke = start * (-0.12f32 / DECAY).exp();
        let first = sampler.process_stereo(&bank, &kit())[0];
        assert!(near(first, at_choke), "{first} vs {at_choke}");
        // 10 ms later it is down by e^(−0.01 / 0.02).
        let later = render(&mut sampler, &bank, &kit(), 480)[0];
        assert!(near(later, at_choke * (-0.5f32).exp()), "{later}");
        // And it stops 40 ms after the choke, leaving only the silent hat.
        render(&mut sampler, &bank, &kit(), 1920 - 481);
        assert_eq!(sampler.active_voices(), 1);
    }

    #[test]
    fn a_choke_spares_other_groups_and_ungrouped_pads() {
        let (bank, mut sampler) = kit_rig();
        sampler.set_slot_shape(46, 1.0, 0.0, 1);
        sampler.set_slot_shape(60, 1.0, 0.0, 0);
        sampler.set_slot_shape(42, 1.0, 0.0, 2);
        sampler.note_on(&bank, 46, 1.0, 0.0, &kit());
        sampler.note_on(&bank, 60, 1.0, 0.0, &kit());
        sampler.note_on(&bank, 42, 1.0, 0.0, &kit());
        render(&mut sampler, &bank, &kit(), 2000);
        assert_eq!(sampler.active_voices(), 3);
    }

    #[test]
    fn a_voice_is_its_own_group_when_it_strikes_again() {
        // The browser chokes every voice of the group, the same pad's last hit
        // included.
        let (bank, mut sampler) = kit_rig();
        sampler.set_slot_shape(46, 1.0, 0.0, 1);
        sampler.note_on(&bank, 46, 1.0, 0.0, &kit());
        render(&mut sampler, &bank, &kit(), 100);
        sampler.note_on(&bank, 46, 1.0, 0.0, &kit());
        render(&mut sampler, &bank, &kit(), 1920);
        assert_eq!(sampler.active_voices(), 1);
    }

    #[test]
    fn a_stolen_voice_fades_the_way_a_choked_one_does() {
        let (bank, mut sampler) = kit_rig();
        for note in 0..MAX_VOICES as u8 {
            sampler.set_slot(u32::from(note), 0);
            sampler.note_on(&bank, note, 1.0, 0.0, &kit());
        }
        render(&mut sampler, &bank, &kit(), 9600);
        sampler.note_on(&bank, 60, 1.0, 0.0, &kit());
        assert_eq!(sampler.sounding_voices(), MAX_VOICES);
        assert_eq!(sampler.active_voices(), MAX_VOICES + 1, "the oldest should still be fading");
        render(&mut sampler, &bank, &kit(), 1920);
        assert_eq!(sampler.active_voices(), MAX_VOICES);
    }

    #[test]
    fn an_out_of_range_shape_is_ignored() {
        let (bank, mut sampler) = kit_rig();
        sampler.set_slot_shape(9_999, 0.0, 0.0, 0);
        sampler.note_on(&bank, 60, 1.0, 0.0, &kit());
        assert_eq!(sampler.process_stereo(&bank, &kit()), [1.0, 1.0]);
    }

    #[test]
    fn stays_finite_across_the_whole_control_surface() {
        let (bank, mut sampler) = rig();
        for step in 0..=12 {
            let t = step as f32 / 12.0;
            let hostile = SamplerSettings {
                rate: t * 40.0 - 20.0,
                pitch_semitones: t * 200.0 - 100.0,
                looping: step % 2 == 0,
                loop_start: t * 2.0 - 0.5,
                loop_end: 1.5 - t * 2.0,
                reverse: step % 3 == 0,
                decay_sec: t * 4.0 - 1.0,
                gate: step % 4 == 0,
                hit_decay: step % 5 == 0,
            };
            sampler.note_on(&bank, 60, 1.0, 0.0, &hostile);
            for _ in 0..2_000 {
                let out = sampler.process(&bank, &hostile);
                assert!(out.is_finite(), "non-finite at step {step}");
                assert!(out.abs() < 50.0, "runaway {out} at step {step}");
            }
        }
    }
}
