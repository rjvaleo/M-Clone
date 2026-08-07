//! Audio the host has handed the engine, and random access into it.
//!
//! This is the piece granular processing has been waiting on. Every sample in
//! idMLab currently lives in JavaScript as an `AudioBuffer`, which the Rust
//! engine cannot see at all — so the samplers are the one part of the rack
//! that cannot move. A grain is a short read from an arbitrary position at an
//! arbitrary rate, which means the engine needs the audio *in its own memory*,
//! not a handle to something across the boundary.
//!
//! # Why reads take a fractional position
//!
//! A granular voice almost never reads on a frame boundary. Its rate is a
//! ratio (pitch shift, time stretch, sample-rate conversion between the file
//! and the device), so position advances by a fraction each sample and lands
//! between frames essentially always. A bank that only answered integer
//! indices would push interpolation into every caller, and every caller would
//! do it slightly differently.
//!
//! # Why the layout is planar
//!
//! `data` is channel-major: all of channel 0, then all of channel 1. A grain
//! reads one channel forward, so planar keeps that a contiguous walk.
//! Interleaved would stride over the other channels for every sample.
//!
//! # What is deliberately not here
//!
//! Allocation. `allocate` is called from the host thread before a sample is
//! playable and never during `process`; the audio thread only ever reads. That
//! split is the whole reason a granular voice can be allocation-free.

use crate::clamp;

/// One decoded file, owned by the engine.
pub struct Sample {
    channels: usize,
    frames: usize,
    sample_rate: f32,
    /// Channel-major: `data[channel * frames + frame]`.
    data: Vec<f32>,
}

impl Sample {
    pub fn channels(&self) -> usize {
        self.channels
    }

    pub fn frames(&self) -> usize {
        self.frames
    }

    /// The rate the file was recorded at, which is not necessarily the
    /// device's — a grain reading a 44.1 kHz file on a 48 kHz device has to
    /// advance by the ratio or it plays sharp.
    pub fn sample_rate(&self) -> f32 {
        self.sample_rate
    }

    pub fn duration_seconds(&self) -> f32 {
        if self.sample_rate <= 0.0 {
            return 0.0;
        }
        self.frames as f32 / self.sample_rate
    }

    /// The whole buffer, for the host to write into after allocating.
    pub fn data_mut(&mut self) -> &mut [f32] {
        &mut self.data
    }

    /// One frame, exactly. Out of range reads as silence.
    pub fn frame(&self, channel: usize, frame: usize) -> f32 {
        if channel >= self.channels || frame >= self.frames {
            return 0.0;
        }
        self.data[channel * self.frames + frame]
    }

    /// Read at a fractional frame position, interpolating between neighbours.
    ///
    /// The valid domain is `0..=frames-1`; anything outside it — including a
    /// non-finite position, which a runaway rate will produce — reads as
    /// silence rather than wrapping or panicking. A grain that overruns its
    /// buffer should fade out, not restart at the top of the file or take the
    /// process down.
    pub fn read(&self, channel: usize, position: f32) -> f32 {
        if channel >= self.channels || self.frames == 0 || !position.is_finite() {
            return 0.0;
        }
        let last = (self.frames - 1) as f32;
        if position < 0.0 || position > last {
            return 0.0;
        }
        let index = position.floor();
        let fraction = position - index;
        let i = index as usize;
        let base = channel * self.frames;
        let a = self.data[base + i];
        // At exactly the last frame there is no neighbour to reach for; the
        // fraction is zero there, so `a` is the answer either way.
        let b = if i + 1 < self.frames { self.data[base + i + 1] } else { a };
        a + (b - a) * fraction
    }
}

/// Every sample the engine currently holds, addressed by a host-assigned id.
///
/// Ids are slot indices rather than the app's content hashes: the ABI carries
/// numbers, and the host already assigns numeric ids to modules the same way.
/// A slot is `None` until allocated and again after `free`, so an id from a
/// released sample reads as absent rather than as somebody else's audio.
#[derive(Default)]
pub struct SampleBank {
    slots: Vec<Option<Sample>>,
}

impl SampleBank {
    pub fn new() -> Self {
        Self::default()
    }

    /// How many slots are occupied.
    pub fn len(&self) -> usize {
        self.slots.iter().filter(|slot| slot.is_some()).count()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Reserve zeroed storage for a sample, replacing whatever the id held.
    ///
    /// Returns false for a shape that cannot hold audio. Allocating is a host
    /// -thread operation; nothing here runs during `process`.
    pub fn allocate(&mut self, id: u32, channels: usize, frames: usize, sample_rate: f32) -> bool {
        if channels == 0 || frames == 0 || !sample_rate.is_finite() || sample_rate <= 0.0 {
            return false;
        }
        let index = id as usize;
        if index >= self.slots.len() {
            self.slots.resize_with(index + 1, || None);
        }
        self.slots[index] = Some(Sample {
            channels,
            frames,
            sample_rate,
            data: vec![0.0; channels * frames],
        });
        true
    }

    pub fn get(&self, id: u32) -> Option<&Sample> {
        self.slots.get(id as usize).and_then(|slot| slot.as_ref())
    }

    pub fn get_mut(&mut self, id: u32) -> Option<&mut Sample> {
        self.slots.get_mut(id as usize).and_then(|slot| slot.as_mut())
    }

    /// Release a sample. Freeing an id that holds nothing is not an error —
    /// the host may tear down a patch it never finished building.
    pub fn free(&mut self, id: u32) {
        if let Some(slot) = self.slots.get_mut(id as usize) {
            *slot = None;
        }
    }

    /// Drop everything. Called when the rack resets rather than per patch
    /// change, because a sample outlives the node that referenced it.
    pub fn clear(&mut self) {
        self.slots.clear();
    }

    /// Read one channel of one sample, interpolated. Absent ids are silence,
    /// so a voice whose sample was freed mid-grain fades rather than faults.
    pub fn read(&self, id: u32, channel: usize, position: f32) -> f32 {
        match self.get(id) {
            Some(sample) => sample.read(channel, position),
            None => 0.0,
        }
    }

    /// How far to advance per output sample to play at `rate` — the file's own
    /// rate against the device's, times the musical rate the caller wants.
    ///
    /// Clamped rather than unbounded: a rate of zero freezes a grain in place,
    /// which is a real granular effect, and an enormous one would step past
    /// the end in a single sample and only ever produce silence.
    pub fn advance_per_sample(&self, id: u32, device_rate: f32, rate: f32) -> f32 {
        let Some(sample) = self.get(id) else { return 0.0 };
        if device_rate <= 0.0 || !rate.is_finite() {
            return 0.0;
        }
        clamp(rate, -MAX_PLAYBACK_RATE, MAX_PLAYBACK_RATE) * (sample.sample_rate / device_rate)
    }
}

/// Sixteen times up or down — five octaves. Past that a grain is either a
/// click or a DC offset, and both are better prevented than rendered.
pub const MAX_PLAYBACK_RATE: f32 = 16.0;

#[cfg(test)]
mod tests {
    use super::*;

    /// A bank holding one ramp, so a read's value states its own position.
    fn ramp(frames: usize) -> SampleBank {
        let mut bank = SampleBank::new();
        bank.allocate(0, 1, frames, 48_000.0);
        let data = bank.get_mut(0).unwrap().data_mut();
        for (i, slot) in data.iter_mut().enumerate() {
            *slot = i as f32;
        }
        bank
    }

    #[test]
    fn allocation_starts_silent() {
        let mut bank = SampleBank::new();
        assert!(bank.allocate(0, 1, 8, 48_000.0));
        assert_eq!(bank.read(0, 0, 3.0), 0.0);
        assert_eq!(bank.get(0).unwrap().frames(), 8);
    }

    #[test]
    fn refuses_a_shape_that_cannot_hold_audio() {
        let mut bank = SampleBank::new();
        assert!(!bank.allocate(0, 0, 8, 48_000.0));
        assert!(!bank.allocate(0, 1, 0, 48_000.0));
        assert!(!bank.allocate(0, 1, 8, 0.0));
        assert!(!bank.allocate(0, 1, 8, f32::NAN));
        assert!(bank.is_empty());
    }

    #[test]
    fn reads_a_whole_frame_exactly() {
        let bank = ramp(8);
        assert_eq!(bank.read(0, 0, 0.0), 0.0);
        assert_eq!(bank.read(0, 0, 5.0), 5.0);
        assert_eq!(bank.read(0, 0, 7.0), 7.0);
    }

    #[test]
    fn interpolates_between_frames() {
        // The reason reads take a float: a grain lands here almost always.
        let bank = ramp(8);
        assert!((bank.read(0, 0, 2.5) - 2.5).abs() < 1e-6);
        assert!((bank.read(0, 0, 6.25) - 6.25).abs() < 1e-6);
    }

    #[test]
    fn reads_outside_the_buffer_as_silence() {
        // A grain that overruns must fade, not wrap to the top of the file.
        let bank = ramp(8);
        assert_eq!(bank.read(0, 0, -0.5), 0.0);
        assert_eq!(bank.read(0, 0, 7.5), 0.0);
        assert_eq!(bank.read(0, 0, 1000.0), 0.0);
    }

    #[test]
    fn reads_a_non_finite_position_as_silence() {
        // A runaway rate produces these; they must not poison the output.
        let bank = ramp(8);
        assert_eq!(bank.read(0, 0, f32::NAN), 0.0);
        assert_eq!(bank.read(0, 0, f32::INFINITY), 0.0);
    }

    #[test]
    fn keeps_channels_apart() {
        let mut bank = SampleBank::new();
        bank.allocate(0, 2, 4, 48_000.0);
        let data = bank.get_mut(0).unwrap().data_mut();
        // Planar: channel 0 is frames 0..4, channel 1 is 4..8.
        data[0..4].copy_from_slice(&[1.0, 1.0, 1.0, 1.0]);
        data[4..8].copy_from_slice(&[2.0, 2.0, 2.0, 2.0]);
        assert_eq!(bank.read(0, 0, 1.0), 1.0);
        assert_eq!(bank.read(0, 1, 1.0), 2.0);
        assert_eq!(bank.read(0, 2, 1.0), 0.0);
    }

    #[test]
    fn an_absent_sample_is_silence_rather_than_a_fault() {
        // A voice whose sample was freed mid-grain has to keep running.
        let bank = SampleBank::new();
        assert_eq!(bank.read(7, 0, 1.0), 0.0);
        assert!(bank.get(7).is_none());
    }

    #[test]
    fn freeing_releases_the_slot() {
        let mut bank = ramp(8);
        assert_eq!(bank.len(), 1);
        bank.free(0);
        assert_eq!(bank.len(), 0);
        assert_eq!(bank.read(0, 0, 1.0), 0.0);
        // Freeing nothing is allowed: a patch may be torn down half-built.
        bank.free(99);
    }

    #[test]
    fn reallocating_an_id_replaces_what_it_held() {
        let mut bank = ramp(8);
        bank.allocate(0, 1, 4, 48_000.0);
        assert_eq!(bank.get(0).unwrap().frames(), 4);
        assert_eq!(bank.read(0, 0, 1.0), 0.0);
    }

    #[test]
    fn holds_several_samples_at_once() {
        let mut bank = SampleBank::new();
        bank.allocate(0, 1, 4, 48_000.0);
        bank.allocate(5, 1, 4, 44_100.0);
        assert_eq!(bank.len(), 2);
        assert_eq!(bank.get(5).unwrap().sample_rate(), 44_100.0);
    }

    #[test]
    fn reports_duration_from_the_files_own_rate() {
        let mut bank = SampleBank::new();
        bank.allocate(0, 1, 22_050, 44_100.0);
        assert!((bank.get(0).unwrap().duration_seconds() - 0.5).abs() < 1e-6);
    }

    #[test]
    fn advances_by_the_rate_ratio_between_file_and_device() {
        // A 44.1k file on a 48k device must step slower than one frame per
        // sample or it plays sharp — the bug every naive sampler ships once.
        let mut bank = SampleBank::new();
        bank.allocate(0, 1, 8, 44_100.0);
        let step = bank.advance_per_sample(0, 48_000.0, 1.0);
        assert!((step - 44_100.0 / 48_000.0).abs() < 1e-6);
        // Matched rates step exactly one frame.
        bank.allocate(1, 1, 8, 48_000.0);
        assert!((bank.advance_per_sample(1, 48_000.0, 1.0) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn a_frozen_grain_is_allowed_and_a_runaway_one_is_not() {
        let mut bank = SampleBank::new();
        bank.allocate(0, 1, 8, 48_000.0);
        // Rate zero holds position: a real granular effect, not an error.
        assert_eq!(bank.advance_per_sample(0, 48_000.0, 0.0), 0.0);
        // Absurd rates clamp rather than stepping past the end every sample.
        assert_eq!(bank.advance_per_sample(0, 48_000.0, 1e9), MAX_PLAYBACK_RATE);
        assert_eq!(bank.advance_per_sample(0, 48_000.0, -1e9), -MAX_PLAYBACK_RATE);
        assert_eq!(bank.advance_per_sample(0, 48_000.0, f32::NAN), 0.0);
    }

    #[test]
    fn an_absent_sample_does_not_advance() {
        let bank = SampleBank::new();
        assert_eq!(bank.advance_per_sample(3, 48_000.0, 1.0), 0.0);
    }

    #[test]
    fn clearing_drops_everything() {
        let mut bank = ramp(8);
        bank.clear();
        assert!(bank.is_empty());
    }
}
