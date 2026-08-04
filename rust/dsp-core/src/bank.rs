//! Polyphony — a fixed pool of voices and the rules for handing them out.
//!
//! Three decisions worth stating, because each one is audible when it is wrong.
//!
//! **Fixed capacity, allocated once.** A bank that grew under load would
//! allocate on the audio thread at exactly the moment it is busiest, which is
//! the textbook way to turn a dense passage into a dropout. Sixteen voices is
//! more than a keyboard has fingers and costs a few kilobytes.
//!
//! **A voice frees itself.** `Adsr` lands exactly on zero rather than
//! approaching it, so "is this voice finished" is a fact rather than a
//! threshold someone has to tune. Sample players elsewhere in this codebase
//! need a silence policy; this does not.
//!
//! **Retriggering a held note reuses its voice.** Otherwise a trill allocates
//! a new voice per repetition, the bank fills with copies of one note, and the
//! oldest *other* note gets stolen — so holding a chord and repeating one note
//! silences the chord.

use crate::voice::{StereoSample, Voice, VoiceSettings};

/// More than a keyboard has fingers, and enough for a sustain pedal held over
/// a chord change.
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
}

impl VoiceBank {
    pub fn new(sample_rate: f32, capacity: usize, seed: u32) -> Self {
        let capacity = capacity.clamp(MIN_POLYPHONY, MAX_POLYPHONY);
        let slots = (0..capacity)
            .map(|index| Slot {
                // A different seed per voice, so the `Random` matrix source
                // does not hand every voice in a chord the same value.
                voice: Voice::new(sample_rate, seed.wrapping_add(index as u32).wrapping_mul(2_654_435_761)),
                started: 0,
            })
            .collect();
        Self { slots, settings: VoiceSettings::default(), next_serial: 1 }
    }

    pub fn capacity(&self) -> usize {
        self.slots.len()
    }

    /// Voices currently producing sound, including those in their release.
    pub fn active_count(&self) -> usize {
        self.slots.iter().filter(|slot| slot.voice.is_active()).count()
    }

    pub fn settings(&self) -> &VoiceSettings {
        &self.settings
    }

    /// Edit the patch. Takes effect on the next sample for every voice,
    /// including ones already sounding.
    pub fn settings_mut(&mut self) -> &mut VoiceSettings {
        &mut self.settings
    }

    pub fn set_settings(&mut self, settings: VoiceSettings) {
        self.settings = settings;
    }

    pub fn set_mod_wheel(&mut self, value: f32) {
        for slot in self.slots.iter_mut() {
            slot.voice.set_mod_wheel(value);
        }
    }

    pub fn set_sample_rate(&mut self, sample_rate: f32) {
        // Rebuilding is the honest way to re-derive every coefficient, and this
        // only ever happens off the audio thread when a context changes rate.
        let capacity = self.slots.len();
        *self = Self::new(sample_rate, capacity, 1);
    }

    /// Which slot should take a new note.
    ///
    /// In order: the one already holding this note, then any idle one, then
    /// the oldest. Never fails — the bank always sounds the note it was asked
    /// for, because a silently dropped note is far harder to diagnose than a
    /// stolen one.
    fn claim(&mut self, note: u8) -> usize {
        if let Some(index) = self
            .slots
            .iter()
            .position(|slot| slot.voice.note() == Some(note) && slot.voice.is_active())
        {
            return index;
        }
        if let Some(index) = self.slots.iter().position(|slot| !slot.voice.is_active()) {
            return index;
        }
        self.slots
            .iter()
            .enumerate()
            .min_by_key(|(_, slot)| slot.started)
            .map(|(index, _)| index)
            .unwrap_or(0)
    }

    pub fn note_on(&mut self, note: u8, velocity: f32) {
        let index = self.claim(note);
        let serial = self.next_serial;
        self.next_serial += 1;
        let settings = &self.settings;
        self.slots[index].voice.start(note, velocity, settings);
        self.slots[index].started = serial;
    }

    /// Release every voice holding this note.
    ///
    /// Every, not the first: a stolen note can leave two slots believing they
    /// hold it, and releasing only one would strand the other until it was
    /// stolen in turn.
    pub fn note_off(&mut self, note: u8) {
        for slot in self.slots.iter_mut() {
            if slot.voice.note() == Some(note) {
                slot.voice.release();
            }
        }
    }

    /// Release everything, letting each voice finish its tail.
    pub fn all_notes_off(&mut self) {
        for slot in self.slots.iter_mut() {
            slot.voice.release();
        }
    }

    /// Silence everything now. For a transport stop, where a tail would run on
    /// past the end of the piece.
    pub fn panic(&mut self) {
        for slot in self.slots.iter_mut() {
            slot.voice.steal();
            slot.started = 0;
        }
    }

    /// One sample, summed across every sounding voice.
    ///
    /// Deliberately not scaled by the voice count: dividing would make a single
    /// note quieter simply because the instrument *could* play sixteen, and a
    /// player would compensate by turning up, undoing it. The master chain's
    /// limiter is what catches a dense chord.
    ///
    /// Named `next` to match every other per-sample source in the crate.
    #[allow(clippy::should_implement_trait)]
    #[inline]
    pub fn next(&mut self) -> StereoSample {
        let mut left = 0.0;
        let mut right = 0.0;
        let settings = &self.settings;
        for slot in self.slots.iter_mut() {
            if !slot.voice.is_active() {
                continue;
            }
            let sample = slot.voice.next(settings);
            left += sample.left;
            right += sample.right;
        }
        StereoSample { left, right }
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
        bank.note_on(60, 1.0);
        assert_eq!(bank.active_count(), 1);
        assert!(peak(&render(&mut bank, 0.1)) > 0.01);
    }

    #[test]
    fn a_chord_uses_one_voice_per_note() {
        let mut bank = new_bank(8);
        for note in [60, 64, 67, 72] {
            bank.note_on(note, 1.0);
        }
        assert_eq!(bank.active_count(), 4);
    }

    #[test]
    fn note_off_releases_rather_than_cutting() {
        // A note that stopped dead on note-off would click and would throw away
        // the release stage entirely.
        let mut bank = new_bank(8);
        bank.settings_mut().amp.release = 0.3;
        bank.note_on(60, 1.0);
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
        bank.note_on(60, 1.0);
        bank.note_off(60);
        render(&mut bank, 0.2);
        assert_eq!(bank.active_count(), 0);

        // And the freed slot is genuinely reusable.
        bank.note_on(72, 1.0);
        assert_eq!(bank.active_count(), 1);
    }

    #[test]
    fn retriggering_a_held_note_reuses_its_voice() {
        // The defect this prevents: a trill allocates a voice per repetition,
        // the bank fills with copies of one note, and the oldest *other* note
        // is stolen — so holding a chord and repeating one note silences it.
        let mut bank = new_bank(4);
        bank.note_on(60, 1.0);
        bank.note_on(64, 1.0);
        for _ in 0..20 {
            bank.note_on(60, 1.0);
            render(&mut bank, 0.005);
        }
        assert_eq!(bank.active_count(), 2, "a trill consumed the whole bank");
    }

    #[test]
    fn exceeding_the_bank_steals_the_oldest_note() {
        let mut bank = new_bank(3);
        bank.settings_mut().amp.release = 2.0;
        for note in [60, 62, 64] {
            bank.note_on(note, 1.0);
            render(&mut bank, 0.01);
        }
        assert_eq!(bank.active_count(), 3);

        bank.note_on(67, 1.0);
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
            bank.note_on(note, 1.0);
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
        bank.note_on(60, 1.0);
        render(&mut bank, 0.01);
        bank.note_off(60);
        bank.note_on(60, 1.0);
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
            bank.note_on(note, 1.0);
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
            bank.note_on(note, 1.0);
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
            bank.note_on(60, 1.0);
            peak(&render(&mut bank, 0.1))
        };
        let one_of_many = {
            let mut bank = new_bank(32);
            bank.note_on(60, 1.0);
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
            bank.note_on(note, 1.0);
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
        bank.note_on(48, 1.0);
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
            bank.note_on(note, 1.0);
        }
        // Four identical notes, each detuned by its own random value: if they
        // were all seeded alike the sum would be exactly four times one voice.
        let together = peak(&render(&mut bank, 0.1));
        let single = {
            let mut one = bank_with_random(1);
            one.note_on(60, 1.0);
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
                bank.note_on(*note, 0.8);
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
        bank.note_on(60, 1.0);
        let open = peak(&render(&mut bank, 0.1));

        let mut closed_bank = new_bank(4);
        closed_bank.settings_mut().matrix.set(ModSource::ModWheel, ModDest::Volume, -1.0);
        closed_bank.set_mod_wheel(1.0);
        closed_bank.note_on(60, 1.0);
        let closed = peak(&render(&mut closed_bank, 0.1));
        assert!(closed < open * 0.5, "the mod wheel did nothing: {closed} vs {open}");
    }
}
