//! The Grain Engine's heavy work, done where the audio is not.
//!
//! MultiGrainLive never runs its onset detector, its hybrid separation or its
//! grain enumeration on the audio thread: `live.rs` builds the transient map
//! and separates on threads of their own, and `/api/grains` enumerates on the
//! request thread. idMLab's audio thread is an `AudioWorklet`, so these run in
//! a Web Worker on a second instance of this same engine (`rust/wasm`'s
//! `job_*` calls), and the results cross to the worklet in pieces small enough
//! that no quantum carries much of the copy (`GrainEngineModule::job_buffer`).
//!
//! Every function here is the crate's own call with the arguments
//! MultiGrainLive gives it. Each result starts with a key — the inputs it was
//! made from — so a result that arrives after its controls have moved on is
//! recognised as stale and dropped, as `live.rs` drops a separation that lands
//! after the file has changed.

use crate::samples::Sample;
use prism_grain::{Source, StreamParams};

/// The hybrid's separation: `Parts::separate`.
pub const PARTS: u32 = 1;
/// WSOLA's transient onsets: the detector `build_map` runs.
pub const ONSETS: u32 = 2;
/// The grain cloud's grains, for the pad: `grains_sampled`.
pub const GRAINS: u32 = 3;

/// How many grains a picture is sent at most: MultiGrainLive's `grain_cap`
/// default.
pub const GRAIN_CAP: usize = 8_000;

/// The bank's sample, stereo and at the rack's rate, as the Grain Engine plays
/// it. Shared so the worker separates exactly what the module stretches.
pub fn source_of(sample: &Sample, rate: f32) -> Source {
    let ratio = sample.sample_rate() / rate;
    let frames = ((sample.frames() as f32) / ratio).floor().max(0.0) as usize;
    let mut samples = Vec::with_capacity(frames * 2);
    for frame in 0..frames {
        let at = frame as f32 * ratio;
        let left = sample.read(0, at);
        let right = if sample.channels() > 1 { sample.read(1, at) } else { left };
        samples.push(left);
        samples.push(right);
    }
    Source { samples, channels: 2 }
}

/// What a separation was made from: the split, and which sample and how long.
pub fn parts_key(sp: &StreamParams, sample: u32) -> [f32; 6] {
    let split = sp.hybrid.split();
    [split.fft_size as f32, split.time_span as f32, split.freq_span as f32, split.margin, sp.in_frames as f32, sample as f32]
}

/// What the onsets were found with. Ratio, window and guard only place the
/// anchors around them, which is cheap and done where the audio is.
pub fn onsets_key(sp: &StreamParams, sample: u32) -> [f32; 5] {
    let w = &sp.wsola;
    [if w.preserve_transients { 1.0 } else { 0.0 }, w.sensitivity, w.floor, sp.in_frames as f32, sample as f32]
}

fn keyed(key: &[f32], payload_len: usize) -> Vec<f32> {
    let mut out = Vec::with_capacity(1 + key.len() + payload_len);
    out.push(key.len() as f32);
    out.extend_from_slice(key);
    out
}

/// Split a result into its key and what follows it.
pub fn split_key(data: &[f32]) -> Option<(&[f32], &[f32])> {
    let n = *data.first()? as usize;
    (data.len() > n).then(|| (&data[1..1 + n], &data[1 + n..]))
}

/// The hybrid's three parts, one after another, behind their key.
pub fn parts_job(source: &Source, sp: &StreamParams, sample: u32) -> Vec<f32> {
    let parts = prism_grain::hstream::Parts::separate(&source.samples, source.channels, sp.hybrid);
    let mut out = keyed(&parts_key(sp, sample), parts.harmonic.len() * 3);
    out.extend_from_slice(&parts.harmonic);
    out.extend_from_slice(&parts.percussive);
    out.extend_from_slice(&parts.residual);
    out
}

/// The three parts back out of a job's payload.
pub fn parts_from(payload: &[f32], sp: &StreamParams) -> prism_grain::hstream::Parts {
    let third = payload.len() / 3;
    prism_grain::hstream::Parts {
        harmonic: payload[..third].to_vec(),
        percussive: payload[third..2 * third].to_vec(),
        residual: payload[2 * third..3 * third].to_vec(),
        channels: 2,
        split: Some(sp.hybrid.split()),
    }
}

/// A frame number as two floats, each a whole number below 2^16, so it
/// survives an f32 at any length.
fn wide(n: u64, out: &mut Vec<f32>) {
    out.push((n >> 16) as f32);
    out.push((n & 0xffff) as f32);
}

fn unwide(hi: f32, lo: f32) -> u64 {
    ((hi as u64) << 16) | lo as u64
}

/// The onsets `build_map` would find, behind their key. None found while
/// transients are not preserved, as `map_for` returns no map then.
pub fn onsets_job(source: &Source, sp: &StreamParams, sample: u32) -> Vec<f32> {
    let hits = if sp.wsola.preserve_transients {
        prism_grain::transient::onsets(&source.samples, source.channels, sp.sample_rate, sp.wsola.sensitivity, sp.wsola.floor)
    } else {
        Vec::new()
    };
    let mut out = keyed(&onsets_key(sp, sample), hits.len() * 2);
    for hit in hits {
        wide(hit as u64, &mut out);
    }
    out
}

pub fn onsets_from(payload: &[f32]) -> Vec<usize> {
    payload.chunks_exact(2).map(|pair| unwide(pair[0], pair[1]) as usize).collect()
}

/// `map_for`, from onsets already found: the anchors `build_map` places
/// around them, at the guard it works out from the grain plan's hop.
pub fn map_from(sp: &StreamParams, hits: &[usize]) -> Option<prism_grain::transient::TimeMap> {
    if !sp.wsola.preserve_transients {
        return None;
    }
    let hop = prism_grain::grain::plan(sp.in_frames, sp.sample_rate, sp.ratio, sp.window_ms, &sp.grain).hop.max(1);
    let guard = ((hop as f32) * sp.wsola.guard_hops.clamp(1.0, 16.0)) as usize;
    Some(prism_grain::transient::TimeMap::with_transients(sp.in_frames, sp.ratio, hits, guard.max(1)))
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

    fn bank_with(frames: usize) -> SampleBank {
        let mut bank = SampleBank::new();
        assert!(bank.allocate(1, 2, frames, RATE));
        let data = bank.get_mut(1).unwrap().data_mut();
        for (n, v) in data.iter_mut().enumerate() {
            let f = n % frames;
            *v = 0.4 * (std::f32::consts::TAU * 220.0 * f as f32 / RATE).sin() + if f % 6_000 < 40 { 0.7 } else { 0.0 };
        }
        bank
    }

    #[test]
    fn the_onsets_make_the_map_build_map_makes() {
        let bank = bank_with(24_000);
        let source = source_of(bank.get(1).unwrap(), RATE);
        let mut sp = StreamParams::new(source.frames(), RATE as u32);
        sp.ratio = 2.0;
        sp.wsola.preserve_transients = true;
        let job = onsets_job(&source, &sp, 1);
        let (key, payload) = split_key(&job).unwrap();
        assert_eq!(key, onsets_key(&sp, 1));
        let hits = onsets_from(payload);
        assert!(!hits.is_empty());
        let hop = prism_grain::grain::plan(source.frames(), sp.sample_rate, sp.ratio, sp.window_ms, &sp.grain).hop.max(1);
        let want = prism_grain::stream::WsolaStream::build_map(&source.samples, 2, sp.sample_rate, sp.ratio, hop, &sp.wsola).unwrap();
        let got = map_from(&sp, &hits).unwrap();
        assert_eq!(format!("{got:?}"), format!("{want:?}"));
    }

    #[test]
    fn the_parts_come_back_as_they_went() {
        let bank = bank_with(12_000);
        let source = source_of(bank.get(1).unwrap(), RATE);
        let sp = StreamParams::new(source.frames(), RATE as u32);
        let job = parts_job(&source, &sp, 1);
        let (key, payload) = split_key(&job).unwrap();
        assert_eq!(key, parts_key(&sp, 1));
        let back = parts_from(payload, &sp);
        let want = prism_grain::hstream::Parts::separate(&source.samples, 2, sp.hybrid);
        assert_eq!((back.harmonic, back.percussive, back.residual), (want.harmonic, want.percussive, want.residual));
    }

    #[test]
    fn the_grains_are_grains_sampled_and_survive_long_files() {
        let bank = bank_with(48_000);
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
