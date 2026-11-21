//! The port against Chromium and macOS themselves: digests (FNV-1a over the
//! bits) of what they gave, on the iMac (Apple M3, macOS 26.6.2, Chromium
//! 151.0.7922.34 offline at 48 kHz), and the same work done here.
//!
//! The graphs are rendered as the reference renders' spec renders the page:
//! a junction's sources added in the order they were connected. Each test
//! names the JavaScript it renders.

use super::graph::{params::*, Buffer, FilterType, Graph, NodeId, WaveId};
use super::*;

struct Draws(u64);
impl Draws {
    fn next(&mut self, lo: f64, hi: f64) -> f64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        lo + (hi - lo) * ((self.0 >> 11) as f64 / 9007199254740992.0)
    }
}

struct Fnv(u64);
impl Fnv {
    fn new() -> Self {
        Fnv(1469598103934665603)
    }
    fn bytes(&mut self, b: &[u8]) {
        for x in b {
            self.0 ^= *x as u64;
            self.0 = self.0.wrapping_mul(1099511628211);
        }
    }
}

/// The same draws as macOS's own functions were given (`exp2f`, `log2f`,
/// `vDSP_deq22D`, in a C program on the iMac).
#[test]
fn the_macos_routines_are_macos() {
    let mut d = Draws(11);
    let mut h = Fnv::new();
    for _ in 0..200_000 {
        h.bytes(&apple::exp2f(d.next(-0.3, 0.3) as f32).to_bits().to_le_bytes());
    }
    assert_eq!(h.0, 0x542c84afd0d91690, "exp2f");
    let mut d = Draws(12);
    let mut h = Fnv::new();
    for _ in 0..200_000 {
        h.bytes(&apple::exp2f(d.next(-20.0, 20.0) as f32).to_bits().to_le_bytes());
    }
    assert_eq!(h.0, 0xbf8f2e18fca9f8e0, "exp2f, wide");
    let mut d = Draws(13);
    let mut h = Fnv::new();
    for _ in 0..200_000 {
        h.bytes(&apple::log2f(d.next(1e-3, 4000.0) as f32).to_bits().to_le_bytes());
    }
    assert_eq!(h.0, 0xa2c8a5935d344bc9, "log2f");
    let mut d = Draws(14);
    let mut h = Fnv::new();
    let c = [0.01, 0.0, -0.01, -1.97, 0.98];
    let x: Vec<f64> = (0..4098).map(|_| d.next(-1.0, 1.0) as f32 as f64).collect();
    let mut y = vec![0.0f64; 4098];
    for k in 2..4098 {
        y[k] = apple::deq22d(&c, x[k], x[k - 1], x[k - 2], y[k - 1], y[k - 2]);
        h.bytes(&y[k].to_bits().to_le_bytes());
    }
    assert_eq!(h.0, 0x0851a7c8c1276434, "vDSP_deq22D");
}

fn render(g: &mut Graph, node: NodeId, frames: usize) -> u64 {
    let out = g.explicit_gain(2).unwrap();
    g.connect(node, out);
    let mut h = Fnv::new();
    let mut done = 0;
    while done < frames {
        g.render(&[out]);
        let b = g.bus(out);
        for k in 0..QUANTUM.min(frames - done) {
            h.bytes(&b.data[0][k].to_le_bytes());
            h.bytes(&b.data[1][k].to_le_bytes());
        }
        done += QUANTUM;
    }
    h.0
}

/// `const s = c.createConstantSource(), g = c.createGain(); s.connect(g); s.start(0);`
/// then `setValueAtTime(0, t)`, two `setTargetAtTime`s, `cancelAndHoldAtTime`
/// and a release `setTargetAtTime`.
#[test]
fn an_envelope_is_chromiums() {
    let mut g = Graph::new(48000.0, 64, 128);
    let s = g.constant().unwrap();
    let gn = g.gain().unwrap();
    g.connect(s, gn);
    g.start(s, 0.0);
    let (t, a, d, dur, r) = (0.01f64, 0.05f64, 0.1f64, 0.23f64, 0.08f64);
    let peak = (0.32f64 * 0.7) as f32;
    g.set_value_at_time(gn, GAIN, 0.0, t);
    g.set_target_at_time(gn, GAIN, peak, t, a / 3.0);
    g.set_target_at_time(gn, GAIN, (peak as f64 * 0.7) as f32, t + a, d / 3.0);
    g.cancel_and_hold_at_time(gn, GAIN, t + dur);
    g.set_target_at_time(gn, GAIN, 0.0, t + dur, r / 5.0);
    assert_eq!(render(&mut g, gn, 24000), 0x30a20c04cfc54257);
}

/// A sawtooth at 220 Hz, 7 cents up, a 0.13 Hz LFO of ±9 cents on its
/// detune, started at 1 ms and stopped mid-quantum.
#[test]
fn a_sawtooth_with_an_lfo_is_chromiums() {
    let mut g = Graph::new(48000.0, 64, 128);
    let o = g.oscillator(WaveId(2)).unwrap();
    g.set(o, FREQUENCY, 220.0);
    g.set(o, DETUNE_OSC, 7.0);
    let l = g.oscillator(WaveId(0)).unwrap();
    g.set(l, FREQUENCY, 0.13);
    let lg = g.gain().unwrap();
    g.set(lg, GAIN, 9.0);
    g.connect(l, lg);
    g.connect_param(lg, o, DETUNE_OSC);
    g.start(o, 0.001);
    g.start(l, 0.0);
    g.stop(o, 0.4123);
    assert_eq!(render(&mut g, o, 24000), 0xda768fdd16a60cc3);
}

/// A sawtooth through a panner at -0.35 (a zero bus on the pan), a k-rate
/// high-pass at 3 kHz and a low-pass of Q 4 dB whose cutoff glides.
#[test]
fn a_filter_chain_is_chromiums() {
    let mut g = Graph::new(48000.0, 64, 128);
    let o = g.oscillator(WaveId(2)).unwrap();
    g.set(o, FREQUENCY, 220.0);
    let z = g.constant().unwrap();
    g.set(z, OFFSET, 0.0);
    g.start(z, 0.0);
    g.connect_param(z, o, DETUNE_OSC);
    let p = g.panner().unwrap();
    g.set(p, PAN, -0.35);
    g.connect_param(z, p, PAN);
    let hp = g.biquad(FilterType::Highpass).unwrap();
    g.set(hp, FREQUENCY, 3000.0);
    let lp = g.biquad(FilterType::Lowpass).unwrap();
    g.set(lp, Q, 4.0);
    g.set_value_at_time(lp, FREQUENCY, 400.0, 0.0);
    g.set_target_at_time(lp, FREQUENCY, 5000.0, 0.02, 0.05);
    g.connect(o, p);
    g.connect(p, hp);
    g.connect(hp, lp);
    g.start(o, 0.0);
    assert_eq!(render(&mut g, lp, 24000), 0x60923c674c0b8ae3);
}

/// Two band-passes on a sine, one with a zero bus (times 600) on its
/// frequency, summed.
#[test]
fn band_passes_are_chromiums() {
    let mut g = Graph::new(48000.0, 64, 128);
    let o = g.oscillator(WaveId(0)).unwrap();
    g.set(o, FREQUENCY, 330.0);
    g.start(o, 0.0);
    let z = g.constant().unwrap();
    g.set(z, OFFSET, 0.0);
    g.start(z, 0.0);
    let vb = g.gain().unwrap();
    g.set(vb, GAIN, 600.0);
    g.connect(z, vb);
    let b1 = g.biquad(FilterType::Bandpass).unwrap();
    g.set(b1, FREQUENCY, 1090.0);
    g.set(b1, Q, 12.0);
    g.connect_param(vb, b1, FREQUENCY);
    let b2 = g.biquad(FilterType::Bandpass).unwrap();
    g.set(b2, FREQUENCY, 330.0);
    g.set(b2, Q, 40.0);
    let m = g.gain().unwrap();
    g.connect(o, b1);
    g.connect(o, b2);
    g.connect(b1, m);
    g.connect(b2, m);
    assert_eq!(render(&mut g, m, 24000), 0x2f736c750804894b);
}

/// Three detuned sawtooths, an LFO on their detune, panned, into one gain,
/// stopped at 1.3 s: (pans, gain, Chromium's digest).
#[test]
fn a_unison_is_chromiums() {
    for (pans, gain, want) in [
        ([-0.7f32, 0.0, 0.7], (1.0f64 / 3f64.sqrt()) as f32, 0xd7a258cd6825e280u64),
        ([0.0; 3], 1.0, 0xf9b8171cae9c3edf),
        ([-0.7, 0.3, 0.7], 1.0, 0x77d7e05ec3497600),
        ([-0.7, 0.0, 0.7], 1.0, 0x9b9e4cd09899d6d3),
    ] {
        let mut g = Graph::new(48000.0, 64, 128);
        let z = g.constant().unwrap();
        g.set(z, OFFSET, 0.0);
        g.start(z, 0.0);
        let dl = g.oscillator(WaveId(0)).unwrap();
        g.set(dl, FREQUENCY, 0.17);
        let dg = g.gain().unwrap();
        g.set(dg, GAIN, 3.6);
        g.connect(dl, dg);
        g.start(dl, 0.0);
        let gg = g.gain().unwrap();
        g.set(gg, GAIN, gain);
        for (i, cents) in [-12.3f32, 0.4, 11.8].into_iter().enumerate() {
            let o = g.oscillator(WaveId(2)).unwrap();
            g.set(o, DETUNE_OSC, cents);
            g.set(o, FREQUENCY, 220.0);
            g.connect_param(dg, o, DETUNE_OSC);
            g.connect_param(z, o, DETUNE_OSC);
            let mut out = o;
            if pans[i] != 0.0 {
                let p = g.panner().unwrap();
                g.set(p, PAN, pans[i]);
                g.connect_param(z, p, PAN);
                g.connect(o, p);
                out = p;
            }
            g.connect(out, gg);
            g.start(o, 0.0);
            g.stop(o, 1.3);
        }
        assert_eq!(render(&mut g, gg, 24000), want, "{pans:?}");
    }
}

/// Two clicks through a wave shaper with a straight curve of 1024 points,
/// at 2x (through the up- and down-samplers) and not oversampled.
#[test]
fn a_wave_shaper_is_chromiums() {
    for (oversample, want) in [(2u8, 0x3c18c5fcb6a9bb3bu64), (0, 0x7ab15e080f477733)] {
        let mut g = Graph::new(48000.0, 64, 128);
        let mut x = vec![0.0f32; 2000];
        x[100] = 0.5;
        x[400] = 0.25;
        let b = g.add_buffer(Buffer { channels: vec![x], sample_rate: 48000.0 });
        let s = g.buffer_source(b).unwrap();
        g.start(s, 0.0);
        let curve: Vec<f32> = (0..1024).map(|i| ((i as f64 / 1023.0) * 2.0 - 1.0) as f32).collect();
        let w = g.wave_shaper(&curve, oversample).unwrap();
        g.connect(s, w);
        assert_eq!(render(&mut g, w, 2048), want, "oversampled {oversample}x");
    }
}
