//! Polyphony — a fixed pool of voices and the rules for handing them out.
//!
//! Four decisions worth stating, because each one is audible when it is wrong.
//!
//! **Fixed capacity, allocated once.** A bank that grew under load would
//! allocate on the audio thread at exactly the moment it is busiest, which is
//! the textbook way to turn a dense passage into a dropout. The whole pool is
//! allocated up front; the polyphony knob limits how much of it held notes use.
//!
//! **A voice frees itself.** Its oscillators stop 50 ms after the amp release
//! ends, as the browser voice's do, so "is this voice finished" is a fact.
//!
//! **A note struck again is a new voice**, as it is in the browser build and
//! in the scale sequencer, where every note is a new oscillator: the note
//! already sounding is let go and rings out its release while the new one
//! starts from silence.
//!
//! **Polyphony limits held notes.** A note let go — or a sequenced note,
//! written with its release — rings to its end without counting, as the
//! browser build's do. When held notes reach the limit the oldest is stolen
//! with a short fade; only when every slot is sounding is one cut outright,
//! the oldest released one first.

use crate::voice::{StereoSample, Voice, VoiceSettings, WaveContext};

/// The polyphony a module starts with.
pub const DEFAULT_POLYPHONY: usize = 16;

/// Never fewer than this, however the host is configured.
pub const MIN_POLYPHONY: usize = 1;
pub const MAX_POLYPHONY: usize = 64;

struct Slot {
    voice: Voice,
    /// When this slot was last started. Monotonic, so the oldest is the
    /// smallest — which is all "steal the oldest" needs.
    started: u64,
}

pub struct VoiceBank {
    slots: Vec<Slot>,
    settings: VoiceSettings,
    next_serial: u64,
    limit: usize,
    waves: WaveContext,
}

impl VoiceBank {
    pub fn new(sample_rate: f32, capacity: usize, seed: u32) -> Self {
        let capacity = capacity.clamp(MIN_POLYPHONY, MAX_POLYPHONY);
        let slots: Vec<Slot> = (0..capacity)
            .map(|index| Slot {
                voice: Voice::new(sample_rate, seed.wrapping_add(index as u32).wrapping_mul(2_654_435_761)),
                started: 0,
            })
            .collect();
        let limit = slots.len();
        Self { slots, settings: VoiceSettings::default(), next_serial: 1, limit, waves: WaveContext::new(sample_rate) }
    }

    pub fn capacity(&self) -> usize {
        self.limit
    }

    pub fn set_capacity(&mut self, voices: usize) {
        self.limit = voices.clamp(MIN_POLYPHONY, self.slots.len());
    }

    pub fn active_count(&self) -> usize {
        self.slots.iter().filter(|slot| slot.voice.is_active()).count()
    }

    /// Notes sounding and not yet let go.
    pub fn held_count(&self) -> usize {
        self.slots.iter().filter(|slot| slot.voice.is_active() && !slot.voice.is_released()).count()
    }

    pub fn settings(&self) -> &VoiceSettings {
        &self.settings
    }

    pub fn settings_mut(&mut self) -> &mut VoiceSettings {
        &mut self.settings
    }

    pub fn set_settings(&mut self, settings: VoiceSettings) {
        self.settings = settings;
    }

    /// The shared wave tables, for the module's LFOs.
    pub fn waves_mut(&mut self) -> &mut WaveContext {
        &mut self.waves
    }

    pub fn set_mod_wheel(&mut self, value: f32) {
        for slot in self.slots.iter_mut() {
            slot.voice.set_mod_wheel(value);
        }
    }

    pub fn set_sample_rate(&mut self, sample_rate: f32) {
        let capacity = self.slots.len();
        *self = Self::new(sample_rate, capacity, 1);
    }

    fn claim(&mut self) -> usize {
        // Held notes at the limit: the oldest is stolen, with its fade.
        if self.held_count() >= self.limit {
            if let Some(oldest) = self
                .slots
                .iter_mut()
                .filter(|slot| slot.voice.is_active() && !slot.voice.is_released())
                .min_by_key(|slot| slot.started)
            {
                oldest.voice.steal();
            }
        }
        if let Some(index) = self.slots.iter().position(|slot| !slot.voice.is_active()) {
            return index;
        }
        // Every slot sounding: cut the oldest, a released one before a held one.
        let oldest = |released: bool| {
            self.slots
                .iter()
                .enumerate()
                .filter(|(_, slot)| slot.voice.is_released() == released)
                .min_by_key(|(_, slot)| slot.started)
                .map(|(index, _)| index)
        };
        let index = oldest(true).or_else(|| oldest(false)).unwrap_or(0);
        self.slots[index].voice.kill();
        index
    }

    /// A note played live: it holds until its note-off.
    pub fn note_on(&mut self, note: u8, velocity: f32, detune_cents: f32) {
        self.note_on_gated(note, velocity, detune_cents, None);
    }

    /// A note, with — for a sequenced one — how long after its start it
    /// releases.
    pub fn note_on_gated(&mut self, note: u8, velocity: f32, detune_cents: f32, release_after: Option<f32>) {
        // The same key struck again lets the one sounding go first.
        self.note_off(note);
        let index = self.claim();
        let serial = self.next_serial;
        self.next_serial += 1;
        let settings = &self.settings;
        self.slots[index].voice.start(note, velocity, detune_cents, settings, release_after, &mut self.waves);
        self.slots[index].started = serial;
    }

    pub fn note_off(&mut self, note: u8) {
        for slot in self.slots.iter_mut() {
            if slot.voice.note() == Some(note) {
                slot.voice.release(&self.settings);
            }
        }
    }

    pub fn all_notes_off(&mut self) {
        for slot in self.slots.iter_mut() {
            slot.voice.release(&self.settings);
        }
    }

    pub fn panic(&mut self) {
        for slot in self.slots.iter_mut() {
            slot.voice.kill();
            slot.started = 0;
        }
    }

    #[allow(clippy::should_implement_trait)]
    #[inline]
    pub fn next(&mut self) -> StereoSample {
        let mut left = 0.0;
        let mut right = 0.0;
        let mut classic = 0.0;
        let settings = &self.settings;
        for slot in self.slots.iter_mut() {
            if !slot.voice.is_active() {
                continue;
            }
            let sample = slot.voice.next(settings, &mut self.waves);
            left += sample.left;
            right += sample.right;
            classic += sample.classic;
        }
        StereoSample { left, right, classic }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lfo::LfoShape;
    use crate::modmatrix::{ModDest, ModSource};
    use crate::testutil::brightness;

    const RATE: f32 = 48_000.0;

    fn mono(samples: &[StereoSample]) -> Vec<f32> {
        samples.iter().map(|s| s.left + s.right).collect()
    }

    fn new_bank(capacity: usize) -> VoiceBank {
        VoiceBank::new(RATE, capacity, 7)
    }

    fn render(bank: &mut VoiceBank, seconds: f32) -> Vec<StereoSample> {
        (0..(seconds * RATE) as usize).map(|_| bank.next()).collect()
    }

    fn peak(samples: &[StereoSample]) -> f32 {
        samples.iter().fold(0.0f32, |acc, s| acc.max(s.left.abs()).max(s.right.abs()))
    }

    #[test]
    fn polyphony_can_be_lowered_without_reallocating() {
        // The knob has to be real, and it has to be free: reallocating the pool
        // when someone drags the control would allocate on the audio thread at
        // the exact moment they are listening.
        let mut bank = new_bank(16);
        bank.set_capacity(2);
        assert_eq!(bank.capacity(), 2);

        for note in [60, 62, 64, 65] {
            bank.note_on(note, 1.0, 0.0);
        }
        assert!(bank.held_count() <= 2, "more notes held than the limit allows");
        // The stolen ones fade out and free their slots.
        render(&mut bank, 0.05);
        assert_eq!(bank.active_count(), 2);
    }

    #[test]
    fn polyphony_is_clamped_to_what_was_allocated() {
        // Asking for more than the pool holds must not index past it.
        let mut bank = new_bank(4);
        bank.set_capacity(999);
        assert_eq!(bank.capacity(), 4);
        bank.set_capacity(0);
        assert_eq!(bank.capacity(), MIN_POLYPHONY);
    }

    #[test]
    fn lowering_polyphony_lets_sounding_notes_finish() {
        // Thinning what comes next is the intent; cutting off what is already
        // ringing would make the control unusable during a performance.
        let mut bank = new_bank(8);
        for note in [60, 64, 67] {
            bank.note_on(note, 1.0, 0.0);
        }
        let before = bank.active_count();
        bank.set_capacity(1);
        assert_eq!(bank.active_count(), before);
    }

    #[test]
    fn a_new_bank_is_silent_and_idle() {
        let mut bank = new_bank(8);
        assert_eq!(bank.active_count(), 0);
        assert_eq!(peak(&render(&mut bank, 0.05)), 0.0);
    }

    #[test]
    fn capacity_clamps_to_something_usable() {
        assert_eq!(VoiceBank::new(RATE, 0, 1).capacity(), MIN_POLYPHONY);
        assert_eq!(VoiceBank::new(RATE, 10_000, 1).capacity(), MAX_POLYPHONY);
        assert_eq!(VoiceBank::new(RATE, 8, 1).capacity(), 8);
    }

    #[test]
    fn a_note_sounds_and_occupies_one_voice() {
        let mut bank = new_bank(8);
        bank.note_on(60, 1.0, 0.0);
        assert_eq!(bank.active_count(), 1);
        assert!(peak(&render(&mut bank, 0.1)) > 0.01);
    }

    #[test]
    fn a_chord_uses_one_voice_per_note() {
        let mut bank = new_bank(8);
        for note in [60, 64, 67, 72] {
            bank.note_on(note, 1.0, 0.0);
        }
        assert_eq!(bank.active_count(), 4);
    }

    #[test]
    fn note_off_releases_rather_than_cutting() {
        // A note that stopped dead on note-off would click and would throw away
        // the release stage entirely.
        let mut bank = new_bank(8);
        bank.settings_mut().amp.release = 0.3;
        bank.note_on(60, 1.0, 0.0);
        render(&mut bank, 0.1);

        bank.note_off(60);
        // Still sounding immediately after.
        assert_eq!(bank.active_count(), 1);
        assert!(peak(&render(&mut bank, 0.05)) > 0.01);

        // And gone once the release has run.
        render(&mut bank, 0.4);
        assert_eq!(bank.active_count(), 0);
    }

    #[test]
    fn a_voice_frees_itself_without_a_silence_threshold() {
        // The property `Adsr` was built for: it lands exactly on zero, so the
        // bank never has to guess when a tail has finished.
        let mut bank = new_bank(2);
        bank.settings_mut().amp.release = 0.05;
        bank.note_on(60, 1.0, 0.0);
        bank.note_off(60);
        render(&mut bank, 0.2);
        assert_eq!(bank.active_count(), 0);

        // And the freed slot is genuinely reusable.
        bank.note_on(72, 1.0, 0.0);
        assert_eq!(bank.active_count(), 1);
    }

    #[test]
    fn a_note_struck_again_lets_the_last_one_ring_and_spares_the_chord() {
        // As in the browser build and the original: the repeated note is a new
        // voice, the one before it rings out its release — and when the bank
        // fills with those tails, a tail is cut, never the note still held.
        let mut bank = new_bank(4);
        bank.note_on(60, 1.0, 0.0);
        bank.note_on(64, 1.0, 0.0);
        for _ in 0..20 {
            bank.note_on(60, 1.0, 0.0);
            render(&mut bank, 0.005);
        }
        assert_eq!(bank.held_count(), 2);
        assert!(bank.slots.iter().any(|s| s.voice.note() == Some(64) && !s.voice.is_released()));
        assert_eq!(bank.slots.iter().filter(|s| s.voice.note() == Some(60) && !s.voice.is_released()).count(), 1);
    }

    #[test]
    fn a_sequenced_note_rings_without_counting_against_the_limit() {
        let mut bank = new_bank(8);
        bank.set_capacity(1);
        bank.settings_mut().amp.release = 0.5;
        for note in [60, 62, 64] {
            bank.note_on_gated(note, 1.0, 0.0, Some(0.01));
        }
        assert_eq!(bank.held_count(), 0);
        assert_eq!(bank.active_count(), 3);
        // A full bank of tails gives up its oldest.
        let mut full = new_bank(2);
        full.settings_mut().amp.release = 5.0;
        for note in [60, 62, 64] {
            full.note_on_gated(note, 1.0, 0.0, Some(0.0));
        }
        assert_eq!(full.active_count(), 2);
        assert!(full.slots.iter().all(|s| s.voice.note() != Some(60)));
    }

    #[test]
    fn exceeding_the_bank_steals_the_oldest_note() {
        let mut bank = new_bank(3);
        bank.settings_mut().amp.release = 2.0;
        for note in [60, 62, 64] {
            bank.note_on(note, 1.0, 0.0);
            render(&mut bank, 0.01);
        }
        assert_eq!(bank.active_count(), 3);

        bank.note_on(67, 1.0, 0.0);
        // Still three, and the first note is the one that went.
        assert_eq!(bank.active_count(), 3);
        assert_eq!(bank.slots.iter().filter(|s| s.voice.note() == Some(60)).count(), 0);
        assert_eq!(bank.slots.iter().filter(|s| s.voice.note() == Some(67)).count(), 1);
    }

    #[test]
    fn a_note_is_never_silently_dropped() {
        // Refusing a note when full is the other plausible policy, and it is
        // much harder to diagnose than a stolen one — the instrument simply
        // goes quiet under the fingers.
        let mut bank = new_bank(2);
        bank.settings_mut().amp.release = 5.0;
        for note in 40..80u8 {
            bank.note_on(note, 1.0, 0.0);
            assert!(
                bank.slots.iter().any(|s| s.voice.note() == Some(note)),
                "note {note} was dropped"
            );
        }
    }

    #[test]
    fn releasing_a_note_releases_every_voice_holding_it() {
        // Stealing can leave two slots believing they hold one note. Releasing
        // only the first would strand the other until it was stolen in turn.
        let mut bank = new_bank(2);
        bank.settings_mut().amp.release = 1.0;
        bank.note_on(60, 1.0, 0.0);
        render(&mut bank, 0.01);
        bank.note_off(60);
        bank.note_on(60, 1.0, 0.0);
        render(&mut bank, 0.01);
        bank.note_off(60);
        render(&mut bank, 2.0);
        assert_eq!(bank.active_count(), 0, "a voice was stranded holding a released note");
    }

    #[test]
    fn all_notes_off_lets_the_tails_finish() {
        let mut bank = new_bank(8);
        bank.settings_mut().amp.release = 0.1;
        for note in [60, 64, 67] {
            bank.note_on(note, 1.0, 0.0);
        }
        bank.all_notes_off();
        assert!(bank.active_count() > 0, "cut the tails instead of releasing");
        render(&mut bank, 0.3);
        assert_eq!(bank.active_count(), 0);
    }

    #[test]
    fn panic_silences_everything_at_once() {
        let mut bank = new_bank(8);
        bank.settings_mut().amp.release = 10.0;
        for note in [60, 64, 67] {
            bank.note_on(note, 1.0, 0.0);
        }
        render(&mut bank, 0.05);
        bank.panic();
        assert_eq!(bank.active_count(), 0);
        assert_eq!(peak(&render(&mut bank, 0.05)), 0.0);
    }

    #[test]
    fn a_single_note_is_not_quieter_for_the_bank_being_large() {
        // Scaling by capacity is the obvious way to keep a full chord in range
        // and it is wrong: it makes one note quieter because the instrument
        // *could* play sixteen, and the player just turns up to compensate.
        let one_of_two = {
            let mut bank = new_bank(2);
            bank.note_on(60, 1.0, 0.0);
            peak(&render(&mut bank, 0.1))
        };
        let one_of_many = {
            let mut bank = new_bank(32);
            bank.note_on(60, 1.0, 0.0);
            peak(&render(&mut bank, 0.1))
        };
        assert!((one_of_two - one_of_many).abs() < 1e-6);
    }

    #[test]
    fn a_full_bank_stays_finite() {
        // Loud is expected — the master limiter downstream is what catches a
        // dense chord. Not-a-number is not.
        let mut bank = new_bank(16);
        for note in 48..64u8 {
            bank.note_on(note, 1.0, 0.0);
        }
        for sample in render(&mut bank, 0.2) {
            assert!(sample.left.is_finite() && sample.right.is_finite());
        }
    }

    #[test]
    fn a_patch_change_reaches_notes_already_sounding() {
        // Editing a knob mid-chord has to be heard, or the face lies.
        let mut bank = new_bank(4);
        bank.settings_mut().cutoff_hz = 12_000.0;
        bank.note_on(48, 1.0, 0.0);
        render(&mut bank, 0.05);
        let bright = brightness(&mono(&render(&mut bank, 0.1)));

        bank.settings_mut().cutoff_hz = 200.0;
        let dark = brightness(&mono(&render(&mut bank, 0.1)));
        assert!(dark < bright * 0.6, "a sounding voice ignored the patch: {dark} vs {bright}");
    }

    #[test]
    fn every_voice_gets_its_own_random_value() {
        // §9.7's `Random` is per note. Seeding every voice alike would make a
        // chord's "random" modulation identical across all of it, which is a
        // detune that does not detune.
        let mut bank = new_bank(8);
        bank.settings_mut().matrix.set(ModSource::Random, ModDest::Osc1Pitch, 1.0);
        bank.settings_mut().lfo[0].shape = LfoShape::Sine;
        for note in [60, 60, 60, 60] {
            bank.note_on(note, 1.0, 0.0);
        }
        // Four identical notes, each detuned by its own random value: if they
        // were all seeded alike the sum would be exactly four times one voice.
        let together = peak(&render(&mut bank, 0.1));
        let single = {
            let mut one = bank_with_random(1);
            one.note_on(60, 1.0, 0.0);
            peak(&render(&mut one, 0.1))
        };
        assert!(together < single * 4.0 * 0.99, "voices moved in lockstep");
    }

    fn bank_with_random(capacity: usize) -> VoiceBank {
        let mut bank = VoiceBank::new(RATE, capacity, 7);
        bank.settings_mut().matrix.set(ModSource::Random, ModDest::Osc1Pitch, 1.0);
        bank
    }

    #[test]
    fn the_same_performance_renders_identically_every_time() {
        // §31.2's render-from-data, at the level of a whole instrument.
        let play = || {
            let mut bank = VoiceBank::new(RATE, 8, 3);
            let mut out = Vec::new();
            for (index, note) in [60u8, 64, 67, 72].iter().enumerate() {
                bank.note_on(*note, 0.8, 0.0);
                out.extend(render(&mut bank, 0.02));
                if index == 1 {
                    bank.note_off(60);
                }
            }
            bank.all_notes_off();
            out.extend(render(&mut bank, 0.1));
            out
        };
        let a = play();
        let b = play();
        assert_eq!(a.len(), b.len());
        for (index, (x, y)) in a.iter().zip(b.iter()).enumerate() {
            assert_eq!(x.left, y.left, "diverged at {index}");
            assert_eq!(x.right, y.right, "diverged at {index}");
        }
    }

    #[test]
    fn the_mod_wheel_reaches_every_voice() {
        let mut bank = new_bank(4);
        bank.settings_mut().matrix.set(ModSource::ModWheel, ModDest::Volume, -1.0);
        bank.note_on(60, 1.0, 0.0);
        let open = peak(&render(&mut bank, 0.1));

        let mut closed_bank = new_bank(4);
        closed_bank.settings_mut().matrix.set(ModSource::ModWheel, ModDest::Volume, -1.0);
        closed_bank.set_mod_wheel(1.0);
        closed_bank.note_on(60, 1.0, 0.0);
        let closed = peak(&render(&mut closed_bank, 0.1));
        assert!(closed < open * 0.5, "the mod wheel did nothing: {closed} vs {open}");
    }
}
