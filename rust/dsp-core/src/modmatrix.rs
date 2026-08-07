//! The 8 × 12 modulation matrix, evaluated per sample.
//!
//! `ModularAudio_FuncSpec_v11` §9.7: any of eight sources reaches any of twelve
//! destinations with an independent bipolar amount, and several sources
//! modulating one destination sum. `src/modular/audio/modMatrix.ts` already
//! models exactly this and is well tested — what it could not do is *run*. In
//! the browser build the matrix was folded into scalars once at note-on, so a
//! continuous source could only ever contribute its value at the instant the
//! note started, and the two LFOs were therefore wired to zero.
//!
//! This is the same model with the one thing that was missing: it is cheap
//! enough to evaluate on every sample, so a source that moves actually moves
//! the destination.
//!
//! # Sum, then clamp — once
//!
//! Every source is bipolar `[-1, 1]` and every amount is bipolar, so a
//! destination could in principle be handed ±8. It sums first and clamps the
//! total, rather than clamping each contribution: clamping per routing would
//! make two half-strength routings quietly stronger than one full-strength one,
//! which is not what "their contributions sum" means to anyone reading the face.

use crate::clamp;

pub const SOURCE_COUNT: usize = 8;
pub const DEST_COUNT: usize = 12;

/// §9.7's sources. Discriminants are wire protocol — appending is safe,
/// reordering rewrites every saved patch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum ModSource {
    Lfo1 = 0,
    Lfo2 = 1,
    AmpEnv = 2,
    FilterEnv = 3,
    Velocity = 4,
    Note = 5,
    ModWheel = 6,
    Random = 7,
}

impl ModSource {
    pub fn from_u32(value: u32) -> Option<Self> {
        match value {
            0 => Some(Self::Lfo1),
            1 => Some(Self::Lfo2),
            2 => Some(Self::AmpEnv),
            3 => Some(Self::FilterEnv),
            4 => Some(Self::Velocity),
            5 => Some(Self::Note),
            6 => Some(Self::ModWheel),
            7 => Some(Self::Random),
            _ => None,
        }
    }

    /// Whether this source changes while a note is held.
    ///
    /// The distinction that matters: a per-note source could be folded in once
    /// at note-on and was, which is why the browser build worked at all. A
    /// continuous one cannot, and that is the whole reason for this file.
    pub fn is_continuous(self) -> bool {
        matches!(self, Self::Lfo1 | Self::Lfo2 | Self::AmpEnv | Self::FilterEnv | Self::ModWheel)
    }
}

/// §9.7's destinations.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum ModDest {
    Osc1Pitch = 0,
    Osc2Pitch = 1,
    Osc3Pitch = 2,
    Osc1Level = 3,
    Osc2Level = 4,
    Osc3Level = 5,
    FilterCutoff = 6,
    FilterResonance = 7,
    Lfo1Rate = 8,
    Lfo2Rate = 9,
    Pan = 10,
    Volume = 11,
}

impl ModDest {
    pub fn from_u32(value: u32) -> Option<Self> {
        match value {
            0 => Some(Self::Osc1Pitch),
            1 => Some(Self::Osc2Pitch),
            2 => Some(Self::Osc3Pitch),
            3 => Some(Self::Osc1Level),
            4 => Some(Self::Osc2Level),
            5 => Some(Self::Osc3Level),
            6 => Some(Self::FilterCutoff),
            7 => Some(Self::FilterResonance),
            8 => Some(Self::Lfo1Rate),
            9 => Some(Self::Lfo2Rate),
            10 => Some(Self::Pan),
            11 => Some(Self::Volume),
            _ => None,
        }
    }

    /// How far full modulation moves this destination, in its own units.
    ///
    /// Pitch is cents and filter/LFO rate are octaves, so that modulation is
    /// musical rather than linear: a vibrato of ±50 cents is the same interval
    /// at every pitch, where ±50 Hz is a semitone at the bottom of the keyboard
    /// and inaudible at the top.
    pub fn full_scale(self) -> f32 {
        match self {
            // Two octaves — enough for a dive-bomb, still controllable at small
            // amounts.
            Self::Osc1Pitch | Self::Osc2Pitch | Self::Osc3Pitch => 2400.0,
            Self::Osc1Level | Self::Osc2Level | Self::Osc3Level => 1.0,
            // Most of the audible range in either direction.
            Self::FilterCutoff => 5.0,
            Self::FilterResonance => 1.0,
            Self::Lfo1Rate | Self::Lfo2Rate => 4.0,
            Self::Pan => 1.0,
            Self::Volume => 1.0,
        }
    }

    /// Whether the destination's unit is a ratio (octaves, cents) rather than a
    /// linear offset. Ratios multiply the carrier; offsets add to it.
    pub fn is_ratio(self) -> bool {
        matches!(
            self,
            Self::Osc1Pitch
                | Self::Osc2Pitch
                | Self::Osc3Pitch
                | Self::FilterCutoff
                | Self::Lfo1Rate
                | Self::Lfo2Rate
        )
    }
}

/// The routing table.
///
/// A dense array rather than a list of live routings: 96 floats is nothing, it
/// never allocates, and evaluation is a flat loop with no branching on which
/// cells happen to be set — which is what makes running it every sample
/// uninteresting rather than a decision.
#[derive(Clone)]
pub struct ModMatrix {
    amounts: [[f32; DEST_COUNT]; SOURCE_COUNT],
}

impl Default for ModMatrix {
    fn default() -> Self {
        Self { amounts: [[0.0; DEST_COUNT]; SOURCE_COUNT] }
    }
}

impl ModMatrix {
    pub fn new() -> Self {
        Self::default()
    }

    /// Set one cell. Amounts are bipolar and clamp to ±1.
    pub fn set(&mut self, source: ModSource, dest: ModDest, amount: f32) {
        let amount = if amount.is_finite() { clamp(amount, -1.0, 1.0) } else { 0.0 };
        self.amounts[source as usize][dest as usize] = amount;
    }

    pub fn get(&self, source: ModSource, dest: ModDest) -> f32 {
        self.amounts[source as usize][dest as usize]
    }

    pub fn clear(&mut self) {
        self.amounts = [[0.0; DEST_COUNT]; SOURCE_COUNT];
    }

    /// How many cells are live — for the face, and for a cheap "is anything
    /// routed at all" check.
    pub fn active_count(&self) -> usize {
        self.amounts.iter().flatten().filter(|a| **a != 0.0).count()
    }

    /// Evaluate every destination from the current source values.
    ///
    /// Returns normalised `[-1, 1]` per destination; turning that into cents or
    /// octaves is `ModDest::full_scale`, kept separate so the summing rule and
    /// the unit mapping can be read and tested independently.
    #[inline]
    pub fn evaluate(&self, sources: &[f32; SOURCE_COUNT]) -> [f32; DEST_COUNT] {
        let mut out = [0.0f32; DEST_COUNT];
        for (source_index, row) in self.amounts.iter().enumerate() {
            let value = sources[source_index];
            // Skip a silent source rather than a zero row: a source at rest is
            // the common case, and it costs one compare instead of twelve
            // multiply-adds.
            if value == 0.0 {
                continue;
            }
            for (dest_index, amount) in row.iter().enumerate() {
                out[dest_index] += value * amount;
            }
        }
        for value in out.iter_mut() {
            *value = clamp(*value, -1.0, 1.0);
        }
        out
    }
}

/// Apply a normalised modulation to a carrier, in the destination's own unit.
///
/// Ratio destinations multiply — an octave of cutoff modulation doubles it —
/// and linear destinations add. Doing this in one place is what keeps a new
/// destination from quietly picking the wrong arithmetic.
#[inline]
pub fn apply(dest: ModDest, carrier: f32, normalised: f32) -> f32 {
    let amount = normalised * dest.full_scale();
    if dest.is_ratio() {
        match dest {
            // Pitch is cents; everything else measured in ratios is octaves.
            ModDest::Osc1Pitch | ModDest::Osc2Pitch | ModDest::Osc3Pitch => {
                carrier * (amount / 1200.0).exp2()
            }
            _ => carrier * amount.exp2(),
        }
    } else {
        carrier + amount
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sources(pairs: &[(ModSource, f32)]) -> [f32; SOURCE_COUNT] {
        let mut out = [0.0; SOURCE_COUNT];
        for (source, value) in pairs {
            out[*source as usize] = *value;
        }
        out
    }

    #[test]
    fn an_empty_matrix_modulates_nothing() {
        let matrix = ModMatrix::new();
        let out = matrix.evaluate(&sources(&[(ModSource::Lfo1, 1.0), (ModSource::Velocity, 1.0)]));
        assert!(out.iter().all(|v| *v == 0.0));
        assert_eq!(matrix.active_count(), 0);
    }

    #[test]
    fn one_routing_carries_its_source() {
        let mut matrix = ModMatrix::new();
        matrix.set(ModSource::Lfo1, ModDest::Osc1Pitch, 0.5);
        let out = matrix.evaluate(&sources(&[(ModSource::Lfo1, 1.0)]));
        assert!((out[ModDest::Osc1Pitch as usize] - 0.5).abs() < 1e-6);
        // And touches nothing else.
        assert_eq!(out[ModDest::Osc2Pitch as usize], 0.0);
        assert_eq!(matrix.active_count(), 1);
    }

    #[test]
    fn a_negative_amount_inverts() {
        let mut matrix = ModMatrix::new();
        matrix.set(ModSource::Lfo1, ModDest::FilterCutoff, -1.0);
        let out = matrix.evaluate(&sources(&[(ModSource::Lfo1, 0.4)]));
        assert!((out[ModDest::FilterCutoff as usize] + 0.4).abs() < 1e-6);
    }

    #[test]
    fn several_sources_into_one_destination_sum() {
        // §9.7: "Multiple sources can modulate the same destination
        // simultaneously — their contributions sum."
        let mut matrix = ModMatrix::new();
        matrix.set(ModSource::Lfo1, ModDest::FilterCutoff, 0.3);
        matrix.set(ModSource::Lfo2, ModDest::FilterCutoff, 0.2);
        matrix.set(ModSource::Velocity, ModDest::FilterCutoff, 0.1);
        let out = matrix.evaluate(&sources(&[
            (ModSource::Lfo1, 1.0),
            (ModSource::Lfo2, 1.0),
            (ModSource::Velocity, 1.0),
        ]));
        assert!((out[ModDest::FilterCutoff as usize] - 0.6).abs() < 1e-6);
    }

    #[test]
    fn one_source_reaches_several_destinations() {
        let mut matrix = ModMatrix::new();
        matrix.set(ModSource::Lfo1, ModDest::Osc1Pitch, 1.0);
        matrix.set(ModSource::Lfo1, ModDest::Pan, -0.5);
        let out = matrix.evaluate(&sources(&[(ModSource::Lfo1, 0.8)]));
        assert!((out[ModDest::Osc1Pitch as usize] - 0.8).abs() < 1e-6);
        assert!((out[ModDest::Pan as usize] + 0.4).abs() < 1e-6);
    }

    #[test]
    fn a_destination_sums_before_it_clamps() {
        // The rule that makes the face honest. Clamping each routing instead
        // would make two half-strength routings stronger than one at full,
        // because each would survive its own clamp intact.
        let mut matrix = ModMatrix::new();
        for source in [ModSource::Lfo1, ModSource::Lfo2, ModSource::Velocity] {
            matrix.set(source, ModDest::Volume, 1.0);
        }
        let out = matrix.evaluate(&sources(&[
            (ModSource::Lfo1, 1.0),
            (ModSource::Lfo2, 1.0),
            (ModSource::Velocity, 1.0),
        ]));
        assert_eq!(out[ModDest::Volume as usize], 1.0);

        // Two half-strength routings reach exactly the same place as one full
        // one, rather than overshooting it.
        let mut halves = ModMatrix::new();
        halves.set(ModSource::Lfo1, ModDest::Volume, 0.5);
        halves.set(ModSource::Lfo2, ModDest::Volume, 0.5);
        let out = halves.evaluate(&sources(&[(ModSource::Lfo1, 1.0), (ModSource::Lfo2, 1.0)]));
        assert!((out[ModDest::Volume as usize] - 1.0).abs() < 1e-6);
    }

    #[test]
    fn opposing_routings_cancel() {
        let mut matrix = ModMatrix::new();
        matrix.set(ModSource::Lfo1, ModDest::Pan, 1.0);
        matrix.set(ModSource::Lfo2, ModDest::Pan, -1.0);
        let out = matrix.evaluate(&sources(&[(ModSource::Lfo1, 0.7), (ModSource::Lfo2, 0.7)]));
        assert!(out[ModDest::Pan as usize].abs() < 1e-6);
    }

    #[test]
    fn amounts_clamp_to_bipolar_unity() {
        let mut matrix = ModMatrix::new();
        matrix.set(ModSource::Lfo1, ModDest::Volume, 50.0);
        assert_eq!(matrix.get(ModSource::Lfo1, ModDest::Volume), 1.0);
        matrix.set(ModSource::Lfo1, ModDest::Volume, -50.0);
        assert_eq!(matrix.get(ModSource::Lfo1, ModDest::Volume), -1.0);
    }

    #[test]
    fn a_non_finite_amount_is_refused_rather_than_stored() {
        // A NaN in the table would poison its destination for ever, and a
        // routing amount comes from a document that may have been hand-edited.
        let mut matrix = ModMatrix::new();
        matrix.set(ModSource::Lfo1, ModDest::Volume, f32::NAN);
        assert_eq!(matrix.get(ModSource::Lfo1, ModDest::Volume), 0.0);
        matrix.set(ModSource::Lfo1, ModDest::Volume, f32::INFINITY);
        assert_eq!(matrix.get(ModSource::Lfo1, ModDest::Volume), 0.0);
    }

    #[test]
    fn every_output_stays_bipolar_however_the_matrix_is_filled() {
        // Full table, every source at full swing — the worst case a face can
        // produce. Downstream code treats these as normalised, so this is the
        // guarantee everything else is built on.
        let mut matrix = ModMatrix::new();
        for s in 0..SOURCE_COUNT {
            for d in 0..DEST_COUNT {
                let source = ModSource::from_u32(s as u32).expect("source");
                let dest = ModDest::from_u32(d as u32).expect("dest");
                matrix.set(source, dest, if (s + d) % 2 == 0 { 1.0 } else { -1.0 });
            }
        }
        for swing in [-1.0, -0.5, 0.5, 1.0] {
            let out = matrix.evaluate(&[swing; SOURCE_COUNT]);
            for (index, value) in out.iter().enumerate() {
                assert!((-1.0..=1.0).contains(value), "dest {index} reached {value}");
            }
        }
        assert_eq!(matrix.active_count(), SOURCE_COUNT * DEST_COUNT);
    }

    #[test]
    fn clearing_removes_every_routing() {
        let mut matrix = ModMatrix::new();
        matrix.set(ModSource::Lfo1, ModDest::Volume, 1.0);
        matrix.set(ModSource::Note, ModDest::FilterCutoff, -0.5);
        matrix.clear();
        assert_eq!(matrix.active_count(), 0);
        assert!(matrix.evaluate(&[1.0; SOURCE_COUNT]).iter().all(|v| *v == 0.0));
    }

    #[test]
    fn the_lfos_and_the_envelopes_are_the_continuous_sources() {
        // This is the property the browser build could not honour: a per-note
        // source can be folded in once at note-on, a continuous one cannot.
        for source in [ModSource::Lfo1, ModSource::Lfo2, ModSource::AmpEnv, ModSource::FilterEnv, ModSource::ModWheel] {
            assert!(source.is_continuous(), "{source:?} should be continuous");
        }
        for source in [ModSource::Velocity, ModSource::Note, ModSource::Random] {
            assert!(!source.is_continuous(), "{source:?} is fixed for a note");
        }
    }

    #[test]
    fn pitch_modulation_is_musical_rather_than_linear() {
        // A ratio destination multiplies, so the same amount is the same
        // interval at every pitch — the reason pitch is in cents at all.
        let low = apply(ModDest::Osc1Pitch, 110.0, 0.5);
        let high = apply(ModDest::Osc1Pitch, 880.0, 0.5);
        assert!((low / 110.0 - high / 880.0).abs() < 1e-4);

        // Full scale is two octaves up, so +1 quadruples.
        let doubled = apply(ModDest::Osc1Pitch, 100.0, 0.5);
        assert!((doubled - 200.0).abs() < 0.01, "half scale should be one octave: {doubled}");
        let quadrupled = apply(ModDest::Osc1Pitch, 100.0, 1.0);
        assert!((quadrupled - 400.0).abs() < 0.05, "full scale should be two octaves: {quadrupled}");
    }

    #[test]
    fn cutoff_modulation_is_in_octaves() {
        let up = apply(ModDest::FilterCutoff, 1000.0, 1.0 / 5.0);
        assert!((up - 2000.0).abs() < 0.01, "one fifth of full scale should be an octave: {up}");
        let down = apply(ModDest::FilterCutoff, 1000.0, -1.0 / 5.0);
        assert!((down - 500.0).abs() < 0.01);
    }

    #[test]
    fn level_and_pan_modulation_is_a_plain_offset() {
        assert!((apply(ModDest::Osc1Level, 0.5, 0.25) - 0.75).abs() < 1e-6);
        assert!((apply(ModDest::Pan, 0.0, -0.5) + 0.5).abs() < 1e-6);
        assert!((apply(ModDest::Volume, 0.2, 0.3) - 0.5).abs() < 1e-6);
    }

    #[test]
    fn zero_modulation_leaves_a_carrier_exactly_alone() {
        // Bit-exact, not merely close: an unmodulated destination that drifted
        // would be a detune nobody asked for.
        for value in 0..DEST_COUNT {
            let dest = ModDest::from_u32(value as u32).expect("dest");
            assert_eq!(apply(dest, 440.0, 0.0), 440.0, "{dest:?} moved a carrier at zero");
        }
    }

    #[test]
    fn the_wire_protocol_round_trips() {
        for value in 0..SOURCE_COUNT as u32 {
            assert_eq!(ModSource::from_u32(value).map(|s| s as u32), Some(value));
        }
        assert_eq!(ModSource::from_u32(SOURCE_COUNT as u32), None);
        for value in 0..DEST_COUNT as u32 {
            assert_eq!(ModDest::from_u32(value).map(|d| d as u32), Some(value));
        }
        assert_eq!(ModDest::from_u32(DEST_COUNT as u32), None);
    }

    #[test]
    fn every_destination_declares_a_usable_scale() {
        for value in 0..DEST_COUNT as u32 {
            let dest = ModDest::from_u32(value).expect("dest");
            assert!(dest.full_scale() > 0.0, "{dest:?} has no range");
            // A ratio destination at full swing must stay finite, or a
            // dive-bomb becomes a divide by zero downstream.
            assert!(apply(dest, 440.0, 1.0).is_finite());
            assert!(apply(dest, 440.0, -1.0).is_finite());
        }
    }
}
