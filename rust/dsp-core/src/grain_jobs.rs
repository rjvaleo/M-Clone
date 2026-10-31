//! The cloud pad's grains, enumerated where the audio is not.
//!
//! MultiGrainLive draws its cloud from `/api/grains`, which enumerates on the
//! request thread, never the audio thread. Here the Grain Engine's builder
//! worker does it (`grainBuilder.ts`), on its second instance of this engine
//! that already holds the same samples, through `rust/wasm`'s `job_*` calls.
//! The map and the separation are the builder's other work
//! (`GrainEngineModule::set_deferred_builds`).

use crate::samples::Sample;
use prism_grain::StreamParams;

/// The grain cloud's grains, for the pad: `grains_sampled`.
pub const GRAINS: u32 = 3;

/// How many grains a picture is sent at most: MultiGrainLive's `grain_cap`
/// default.
pub const GRAIN_CAP: usize = 8_000;

/// A frame number as two floats, each a whole number below 2^16, so it
/// survives an f32 at any length.
fn wide(n: u64, out: &mut Vec<f32>) {
    out.push((n >> 16) as f32);
    out.push((n & 0xffff) as f32);
}

#[cfg(test)]
fn unwide(hi: f32, lo: f32) -> u64 {
    ((hi as u64) << 16) | lo as u64
}

/// One grain as the pad draws it, after `/api/grains`: where it lands, where
/// it reads, how long, its pitch, and its level and brightness measured from
/// the source it reads.
pub const GRAIN_FIELDS: usize = 7;

/// The grains of the cloud at the file's own rate and length, as
/// MultiGrainLive's `/api/grains` enumerates them (`grains_sampled` with the
/// document's ratio, pitch, window and grain section, capped at `cap`, over
/// the whole file), each measured from the file's first channel as its
/// `measure` does. Out: `[total hi, total lo, count, then GRAIN_FIELDS each:
/// out hi, out lo, source frame, size, pitch, rms, brightness]`.
pub fn grains_job(sample: &Sample, sp: &StreamParams, cap: usize) -> Vec<f32> {
    let frames = sample.frames();
    let (sent, total) = prism_grain::grain::grains_sampled(
        frames, sample.sample_rate() as u32, sp.ratio, sp.semitones, sp.window_ms, &sp.grain, cap, None,
    );
    let measure = |start: f32, len: usize| -> (f32, f32) {
        if frames == 0 {
            return (0.0, 0.0);
        }
        let a = (start as usize).min(frames.saturating_sub(1));
        let b = (a + len).min(frames);
        if b <= a + 1 {
            return (0.0, 0.0);
        }
        let mut sum = 0f64;
        let mut n = 0u32;
        let mut crossings = 0u32;
        let mut prev = 0f32;
        for f in (a..b).step_by(8) {
            let v = sample.frame(0, f);
            sum += (v as f64) * (v as f64);
            if prev <= 0.0 && v > 0.0 {
                crossings += 1;
            }
            prev = v;
            n += 1;
        }
        let rms = if n > 0 { (sum / n as f64).sqrt() as f32 } else { 0.0 };
        let brightness = if n > 1 { crossings as f32 / n as f32 } else { 0.0 };
        (rms, brightness.min(1.0))
    };
    let mut out = Vec::with_capacity(3 + sent.len() * GRAIN_FIELDS);
    wide(total as u64, &mut out);
    out.push(sent.len() as f32);
    for e in &sent {
        let (rms, bright) = measure(e.src_frame, e.size as usize);
        wide(e.out_frame, &mut out);
        out.extend_from_slice(&[e.src_frame, e.size as f32, e.pitch_semis, rms, bright]);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::samples::SampleBank;

    const RATE: f32 = 48_000.0;

    #[test]
    fn the_grains_are_grains_sampled_and_survive_long_files() {
        let mut bank = SampleBank::new();
        assert!(bank.allocate(1, 2, 48_000, RATE));
        for (n, v) in bank.get_mut(1).unwrap().data_mut().iter_mut().enumerate() {
            *v = 0.4 * (std::f32::consts::TAU * 220.0 * (n % 48_000) as f32 / RATE).sin();
        }
        let mut sp = StreamParams::new(48_000, RATE as u32);
        sp.ratio = 4.0;
        sp.grain.layers = 3;
        let job = grains_job(bank.get(1).unwrap(), &sp, 500);
        let (sent, total) = prism_grain::grain::grains_sampled(48_000, 48_000, 4.0, 0.0, sp.window_ms, &sp.grain, 500, None);
        assert_eq!(unwide(job[0], job[1]) as usize, total);
        assert_eq!(job[2] as usize, sent.len());
        for (i, e) in sent.iter().enumerate() {
            let at = 3 + i * GRAIN_FIELDS;
            assert_eq!(unwide(job[at], job[at + 1]), e.out_frame);
            assert_eq!(job[at + 2], e.src_frame);
            assert_eq!(job[at + 4], e.pitch_semis);
        }
        let mut far = Vec::new();
        wide(5_000_000_123, &mut far);
        assert_eq!(unwide(far[0], far[1]), 5_000_000_123);
    }
}
