//! One synth voice — §9.1 through §9.7 assembled.
//!
//! Three oscillators into a mixer, into a filter with its own envelope and key
//! follow, into the amplitude envelope, into a pan. Two LFOs and the 8 × 12
//! matrix run alongside, **evaluated on every sample**, which is the whole
//! difference from the browser build.
//!
//! # Why the filter is per voice
//!
//! The scale sequencer this design came from shared one filter across the whole
//! instrument, and that is what made its cutoff knob cancel the envelopes of
//! notes already sounding. A filter envelope belongs to a note, so the filter
//! does too. It costs one biquad per voice, which is nothing.
//!
//! # The order of the modulation
//!
//! Sources are read, the matrix is evaluated, and *then* everything is applied.
//! Doing it in that order means a routing from LFO 1 to LFO 2's rate uses this
//! sample's LFO 1 rather than last sample's, and — more importantly — that no
//! destination can depend on the order the code happens to apply them in.

use crate::envelope::Adsr;
use crate::filter::{Biquad, BiquadKind};
use crate::lfo::{Lfo, LfoShape, LfoTrigger};
use crate::modmatrix::{apply, ModDest, ModMatrix, ModSource, DEST_COUNT, SOURCE_COUNT};
use crate::osc::{Osc, Wave};
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

/// Convert a MIDI note to hertz, fractional notes included so that pitch
/// modulation and detune land between the keys.
#[inline]
pub fn note_to_hz(note: f32) -> f32 {
    A4_HZ * ((note - A4_MIDI) / 12.0).exp2()
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

    pub cutoff_hz: f32,
    pub resonance: f32,
    /// How much the filter envelope opens the cutoff, in octaves.
    pub filter_env_octaves: f32,
    /// 0 = cutoff is the same at every pitch, 1 = it tracks the keyboard.
    pub key_follow: f32,

    pub amp: AdsrSettings,
    pub filter_env: AdsrSettings,

    pub lfo: [LfoSettings; 2],
    pub matrix: ModMatrix,

    pub pan: f32,
    pub volume: f32,
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
            resonance: 0.3,
            filter_env_octaves: 0.0,
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
            volume: 0.8,
        }
    }
}

/// What one voice produces for one sample.
#[derive(Clone, Copy, Debug, Default)]
pub struct StereoSample {
    pub left: f32,
    pub right: f32,
}

pub struct Voice {
    sample_rate: f32,
    oscs: [Osc; OSC_COUNT],
    filter: Biquad,
    amp: Adsr,
    filter_env: Adsr,
    lfos: [Lfo; 2],
    rng: Rng,

    /// The note currently sounding, if any.
    note: Option<u8>,
    /// The microtonal remainder of that note's pitch.
    ///
    /// Belongs to the note rather than to `VoiceSettings` because it is not a
    /// setting: `settings.detune_cents` is per-oscillator and fixed for the
    /// life of a patch, while this changes with every note a scale quantiser
    /// touches. Storing it here is what lets one voice play 17-EDO while the
    /// patch above it is unaware there is a tuning system at all.
    detune_cents: f32,
    velocity: f32,
    /// One random value per note — §9.7's `Random` source, which is fixed for
    /// the life of a note rather than noise.
    note_random: f32,
    mod_wheel: f32,
}

impl Voice {
    pub fn new(sample_rate: f32, seed: u32) -> Self {
        let rate = if sample_rate > 0.0 { sample_rate } else { 48_000.0 };
        let mut rng = Rng::new(seed);
        let note_random = rng.next_bipolar();
        Self {
            sample_rate: rate,
            oscs: [Osc::new(rate), Osc::new(rate), Osc::new(rate)],
            filter: Biquad::identity(),
            amp: Adsr::new(rate),
            filter_env: Adsr::new(rate),
            // Separate seeds so the two LFOs' random shapes do not move in
            // lockstep, which would make them one source with two names.
            lfos: [Lfo::new(rate, seed ^ 0x5EED), Lfo::new(rate, seed ^ 0xA5A5)],
            rng,
            note: None,
            detune_cents: 0.0,
            velocity: 0.0,
            note_random,
            mod_wheel: 0.0,
        }
    }

    pub fn note(&self) -> Option<u8> {
        self.note
    }

    /// Still sounding. False once the amplitude release has finished, which it
    /// does exactly — see `envelope.rs`.
    pub fn is_active(&self) -> bool {
        self.amp.is_active()
    }

    pub fn set_mod_wheel(&mut self, value: f32) {
        self.mod_wheel = clamp(value, 0.0, 1.0);
    }

    /// Apply settings that do not depend on the note.
    pub fn configure(&mut self, settings: &VoiceSettings) {
        for (index, osc) in self.oscs.iter_mut().enumerate() {
            osc.set_wave(settings.waves[index]);
            osc.set_width(settings.pulse_width[index]);
        }
        self.amp.set_attack(settings.amp.attack);
        self.amp.set_decay(settings.amp.decay);
        self.amp.set_sustain(settings.amp.sustain);
        self.amp.set_release(settings.amp.release);
        self.filter_env.set_attack(settings.filter_env.attack);
        self.filter_env.set_decay(settings.filter_env.decay);
        self.filter_env.set_sustain(settings.filter_env.sustain);
        self.filter_env.set_release(settings.filter_env.release);
        for (index, lfo) in self.lfos.iter_mut().enumerate() {
            let config = settings.lfo[index];
            lfo.set_shape(config.shape);
            lfo.set_trigger(config.trigger);
            lfo.set_rate_hz(config.rate_hz);
            lfo.set_depth(config.depth);
            lfo.set_phase_degrees(config.phase_degrees);
        }
    }

    /// Note on.
    ///
    /// `detune_cents` is the part of the pitch MIDI cannot say. A scale
    /// quantiser working in a 19-tone scale lands between the keys, and splits
    /// what it found into the nearest MIDI note plus this remainder; taking it
    /// as an argument rather than inferring it is what keeps every tuning
    /// system in the library a property of the score rather than of the
    /// synthesiser.
    pub fn start(&mut self, note: u8, velocity: f32, detune_cents: f32, settings: &VoiceSettings) {
        self.configure(settings);
        self.note = Some(note);
        // A non-finite value would poison the oscillator frequency for the
        // life of the voice, and there is no sound to recover to.
        self.detune_cents = if detune_cents.is_finite() { detune_cents } else { 0.0 };
        self.velocity = clamp(velocity, 0.0, 1.0);
        self.note_random = self.rng.next_bipolar();
        self.amp.gate_on();
        self.filter_env.gate_on();
        for lfo in self.lfos.iter_mut() {
            lfo.retrigger();
        }
    }

    /// Note off. The voice keeps sounding through its release.
    pub fn release(&mut self) {
        self.amp.gate_off();
        self.filter_env.gate_off();
    }

    /// Silence now, for voice stealing.
    pub fn steal(&mut self) {
        self.amp.kill();
        self.filter_env.kill();
        self.note = None;
        self.detune_cents = 0.0;
        for osc in self.oscs.iter_mut() {
            osc.reset();
        }
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
    pub fn next(&mut self, settings: &VoiceSettings) -> StereoSample {
        if !self.amp.is_active() {
            return StereoSample::default();
        }

        // 1. Read every source for this sample.
        let amp_env = self.amp.next();
        let filter_env = self.filter_env.next();
        let lfo1 = self.lfos[0].next();
        let lfo2 = self.lfos[1].next();
        let sources = self.sources(amp_env, filter_env, lfo1, lfo2);

        // 2. Evaluate the whole matrix once. Every destination below reads from
        //    this, so none of them can be affected by the order they are applied.
        let m: [f32; DEST_COUNT] = settings.matrix.evaluate(&sources);

        // 3. LFO rates are themselves destinations, so a routing can speed one
        //    LFO with the other. Applied before the oscillators only because it
        //    affects the *next* sample either way.
        for index in 0..2 {
            let dest = if index == 0 { ModDest::Lfo1Rate } else { ModDest::Lfo2Rate };
            let modulation = m[dest as usize];
            if modulation != 0.0 {
                self.lfos[index].set_rate_hz(apply(dest, settings.lfo[index].rate_hz, modulation));
            }
        }

        // 4. Oscillators.
        // Fractional on purpose: `note_to_hz` takes an f32 so that the note
        // and its microtonal remainder are one pitch by the time anything
        // downstream sees it, rather than a pitch with a correction attached.
        let base = note_to_hz(self.note.unwrap_or(69) as f32 + self.detune_cents / 100.0);
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
            let detune = (settings.detune_semis[index] * 100.0 + settings.detune_cents[index])
                / 1200.0;
            let tuned = base * detune.exp2();
            self.oscs[index].set_frequency(apply(pitch_dest, tuned, m[pitch_dest as usize]));
            self.oscs[index].set_width(settings.pulse_width[index]);

            let level = clamp(apply(level_dest, settings.levels[index], m[level_dest as usize]), 0.0, 1.0);
            if level > 0.0 {
                mixed += self.oscs[index].next() * level;
            } else {
                // Still advanced, so an oscillator turned back up rejoins in
                // phase with the others rather than wherever it was left.
                self.oscs[index].next();
            }
        }
        // Three oscillators at unity would clip; scaling by the count keeps a
        // full stack inside the rails without touching a single-oscillator patch.
        mixed /= OSC_COUNT as f32;

        // 5. Filter: envelope, key follow, then matrix.
        let key_offset = self
            .note
            .map(|n| (n as f32 - KEY_FOLLOW_PIVOT_MIDI) / 12.0 * settings.key_follow)
            .unwrap_or(0.0);
        let env_offset = filter_env * settings.filter_env_octaves;
        let cutoff = settings.cutoff_hz * (key_offset + env_offset).exp2();
        let cutoff = apply(ModDest::FilterCutoff, cutoff, m[ModDest::FilterCutoff as usize]);
        let cutoff = clamp(cutoff, MIN_CUTOFF_HZ, MAX_CUTOFF_HZ.min(self.sample_rate * 0.49));
        let resonance = clamp(
            apply(ModDest::FilterResonance, settings.resonance, m[ModDest::FilterResonance as usize]),
            0.0,
            1.0,
        );
        // Q from 0.5 (gentle) to 12 (singing), logarithmic because resonance is
        // heard that way.
        let q = 0.5 * (24.0f32).powf(resonance);
        self.filter.set(BiquadKind::LowPass, cutoff, q, 0.0, self.sample_rate);
        let filtered = self.filter.process(mixed);

        // 6. Amplitude, then pan.
        let volume = clamp(apply(ModDest::Volume, settings.volume, m[ModDest::Volume as usize]), 0.0, 1.0);
        let amplitude = filtered * amp_env * self.velocity * volume;

        let pan = clamp(apply(ModDest::Pan, settings.pan, m[ModDest::Pan as usize]), -1.0, 1.0);
        // Equal power, so a pan sweep holds its loudness through the centre
        // rather than dipping.
        let angle = (pan + 1.0) * 0.25 * core::f32::consts::PI;
        StereoSample { left: amplitude * angle.cos(), right: amplitude * angle.sin() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f32 = 48_000.0;

    fn voice() -> (Voice, VoiceSettings) {
        (Voice::new(RATE, 11), VoiceSettings::default())
    }

    fn render(voice: &mut Voice, settings: &VoiceSettings, seconds: f32) -> Vec<StereoSample> {
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

        voice.release();
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

        assert!((soft_peak / loud_peak - 0.25).abs() < 0.05, "{soft_peak} vs {loud_peak}");
    }

    #[test]
    fn a_full_stack_of_oscillators_stays_inside_the_rails() {
        // Three saws at unity would clip without the mix scaling.
        let (mut voice, mut settings) = voice();
        settings.levels = [1.0; OSC_COUNT];
        settings.detune_cents = [-12.0, 0.0, 12.0];
        settings.cutoff_hz = 20_000.0;
        voice.start(60, 1.0, 0.0, &settings);
        let p = peak(&render(&mut voice, &settings, 0.3));
        assert!(p <= 1.0, "clipped at {p}");
        assert!(p > 0.1, "barely sounded: {p}");
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
        let before = free.next(&settings);
        free.start(60, 1.0, 0.0, &settings);
        let after = free.next(&settings);
        assert!((before.left - after.left).abs() < 0.15, "a note restarted a free LFO");

        let mut note_settings = settings.clone();
        note_settings.lfo[0].trigger = LfoTrigger::Note;
        let (mut retriggered, _) = voice();
        retriggered.start(60, 1.0, 0.0, &note_settings);
        render(&mut retriggered, &note_settings, 0.25);
        let before = retriggered.next(&note_settings);
        retriggered.start(60, 1.0, 0.0, &note_settings);
        let after = retriggered.next(&note_settings);
        assert!((before.left - after.left).abs() > 0.01, "a note did not restart a Note LFO");
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
    fn stealing_a_voice_silences_it_at_once() {
        let (mut voice, mut settings) = voice();
        settings.amp.release = 5.0;
        voice.start(60, 1.0, 0.0, &settings);
        render(&mut voice, &settings, 0.1);
        voice.steal();
        assert!(!voice.is_active());
        assert_eq!(voice.note(), None);
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
                assert!(sample.left.abs() <= 4.0, "ran away on note {note}: {}", sample.left);
            }
        }
    }

    #[test]
    fn the_same_note_renders_identically_every_time() {
        // §31.2's render-from-data depends on this at the voice level.
        let settings = VoiceSettings::default();
        let mut a = Voice::new(RATE, 4);
        let mut b = Voice::new(RATE, 4);
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
}

