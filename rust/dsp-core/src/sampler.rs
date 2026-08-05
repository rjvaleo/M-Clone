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

/// How many notes may sound at once before the oldest is taken.
pub const MAX_VOICES: usize = 16;

/// The release applied when a voice is stolen or the bank is silenced, in
/// seconds. Short enough to be immediate, long enough not to click.
const STEAL_FADE_SEC: f32 = 0.005;

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
    /// Amplitude release once the note ends, in seconds.
    pub decay_sec: f32,
    /// True: the note sounds only while held. False: it runs to the end
    /// regardless, which is what a drum hit wants.
    pub gate: bool,
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
        }
    }
}

/// Semitones to a frequency ratio. Twelve of them double it.
pub fn semitone_ratio(semitones: f32) -> f32 {
    2.0f32.powf(clamp(semitones, -60.0, 60.0) / 12.0)
}

#[derive(Clone, Copy)]
struct Voice {
    active: bool,
    note: u8,
    sample: u32,
    /// Read head in frames.
    position: f32,
    advance: f32,
    amplitude: f32,
    /// Per-sample amplitude step while releasing; 0 while sustaining.
    release_step: f32,
    /// Held down. A gated voice releases when this goes false.
    held: bool,
    age: u32,
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
        }
    }
}

/// A polyphonic sample player.
pub struct Sampler {
    voices: [Voice; MAX_VOICES],
    slots: [u32; SLOT_COUNT],
    sample_rate: f32,
}

impl Sampler {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            voices: [Voice::default(); MAX_VOICES],
            slots: [NO_SAMPLE; SLOT_COUNT],
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

    /// What a note plays, or `NO_SAMPLE`.
    pub fn slot(&self, note: u8) -> u32 {
        self.slots[note as usize]
    }

    pub fn active_voices(&self) -> usize {
        self.voices.iter().filter(|voice| voice.active).count()
    }

    pub fn clear(&mut self) {
        self.voices = [Voice::default(); MAX_VOICES];
    }

    /// Release everything, without a click.
    pub fn all_notes_off(&mut self) {
        let step = self.fade_step(STEAL_FADE_SEC);
        for voice in &mut self.voices {
            voice.held = false;
            voice.release_step = step;
        }
    }

    fn fade_step(&self, seconds: f32) -> f32 {
        1.0 / (seconds.max(0.0005) * self.sample_rate)
    }

    pub fn note_on(
        &mut self,
        bank: &SampleBank,
        note: u8,
        velocity: f32,
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

        let ratio = semitone_ratio(settings.pitch_semitones) * settings.rate;
        let mut advance = bank.advance_per_sample(sample, self.sample_rate, ratio);
        if settings.reverse {
            advance = -advance;
        }
        let last = (frames - 1) as f32;
        let position = if settings.reverse { last } else { 0.0 };

        let index = self.free_or_oldest();
        self.voices[index] = Voice {
            active: true,
            note,
            sample,
            position,
            advance,
            amplitude: clamp(velocity, 0.0, 1.0),
            release_step: 0.0,
            held: true,
            age: 0,
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
                if settings.gate {
                    voice.release_step = step;
                }
            }
        }
    }

    fn free_or_oldest(&mut self) -> usize {
        let mut oldest = 0;
        for (index, voice) in self.voices.iter().enumerate() {
            if !voice.active {
                return index;
            }
            if voice.age > self.voices[oldest].age {
                oldest = index;
            }
        }
        oldest
    }

    /// One output sample, summing every sounding voice.
    pub fn process(&mut self, bank: &SampleBank, settings: &SamplerSettings) -> f32 {
        let mut sum = 0.0;
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

            sum += audio.read(0, voice.position) * voice.amplitude;
            voice.position += voice.advance;
            voice.age += 1;

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
        sampler.note_on(&bank, 60, 1.0, &settings());
        assert_eq!(sampler.active_voices(), 1);
        assert!((sampler.process(&bank, &settings()) - 1.0).abs() < 1e-3);
    }

    #[test]
    fn an_unassigned_note_is_silence_rather_than_a_fault() {
        // A kit with half its slots filled is normal; the rest must do nothing.
        let (bank, mut sampler) = rig();
        sampler.note_on(&bank, 61, 1.0, &settings());
        assert_eq!(sampler.active_voices(), 0);
        assert_eq!(sampler.process(&bank, &settings()), 0.0);
    }

    #[test]
    fn a_note_whose_sample_is_gone_does_not_fault() {
        let (_, mut sampler) = rig();
        let empty = SampleBank::new();
        sampler.note_on(&empty, 60, 1.0, &settings());
        assert_eq!(sampler.process(&empty, &settings()), 0.0);
    }

    #[test]
    fn an_ungated_note_runs_to_the_end_after_the_key_is_released() {
        // The difference between a drum kit and a keyboard: a hit finishes.
        let (bank, mut sampler) = rig();
        let hit = SamplerSettings { gate: false, ..settings() };
        sampler.note_on(&bank, 60, 1.0, &hit);
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
        sampler.note_on(&bank, 60, 1.0, &held);
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
        sampler.note_on(&short, 60, 1.0, &settings());
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
        sampler.note_on(&bank, 60, 1.0, &backwards);
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
        sampler.note_on(&bank, 60, 1.0, &looped);
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
        sampler.note_on(&bank, 60, 1.0, &backwards);
        for _ in 0..3_000 {
            sampler.process(&bank, &backwards);
        }
        assert_eq!(sampler.active_voices(), 1);
    }

    #[test]
    fn pitch_and_rate_both_move_the_playback_speed() {
        let (bank, mut sampler) = rig();
        let up = SamplerSettings { pitch_semitones: 12.0, ..settings() };
        sampler.note_on(&bank, 60, 1.0, &up);
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
            sampler.note_on(&bank, note, 1.0, &settings());
        }
        assert_eq!(sampler.active_voices(), MAX_VOICES);
        assert!(sampler.process(&bank, &settings()).abs() > 0.0);
    }

    #[test]
    fn all_notes_off_silences_everything_without_a_click() {
        let (bank, mut sampler) = rig();
        sampler.note_on(&bank, 60, 1.0, &settings());
        sampler.all_notes_off();
        let mut previous = sampler.process(&bank, &settings());
        let mut biggest_step = 0.0f32;
        for _ in 0..((RATE * 0.02) as usize) {
            let current = sampler.process(&bank, &settings());
            biggest_step = biggest_step.max((current - previous).abs());
            previous = current;
        }
        assert_eq!(sampler.active_voices(), 0);
        assert!(biggest_step < 0.01, "the fade had a step in it: {biggest_step}");
    }

    #[test]
    fn clearing_a_slot_stops_new_notes_from_using_it() {
        let (bank, mut sampler) = rig();
        sampler.set_slot(60, NO_SAMPLE);
        sampler.note_on(&bank, 60, 1.0, &settings());
        assert_eq!(sampler.active_voices(), 0);
    }

    #[test]
    fn an_out_of_range_slot_is_ignored() {
        let (_, mut sampler) = rig();
        sampler.set_slot(9_999, 0);
        assert_eq!(sampler.slot(60), 0);
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
            };
            sampler.note_on(&bank, 60, 1.0, &hostile);
            for _ in 0..2_000 {
                let out = sampler.process(&bank, &hostile);
                assert!(out.is_finite(), "non-finite at step {step}");
                assert!(out.abs() < 50.0, "runaway {out} at step {step}");
            }
        }
    }
}
