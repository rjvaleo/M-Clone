//! Web Audio as Chromium 151 renders it on a Mac, sample for sample.
//!
//! `webaudio.rs` restates the spec's formulas for idMLab's synth. This goes
//! further, for MultiGrainLive's browser instruments, whose Rust versions must
//! play what the page played: it is a port of Chromium's own rendering code
//! (`third_party/blink/renderer/modules/webaudio` and `platform/audio`, tag
//! 151.0.7922.34, the build the reference renders were made with), with the
//! arithmetic in the order Chromium does it, on the paths an arm64 Mac takes:
//!
//! - [`fdlibm`]: the maths library Chromium uses for Web Audio.
//! - [`apple`]: the three macOS routines it calls (`exp2f`, `log2f`,
//!   `vDSP_deq22D`), restated from their machine code.
//! - [`param`]: an `AudioParam` and its automation timeline.
//! - [`wave`]: periodic waves and their band-limited tables.
//! - [`graph`]: a graph of nodes rendered a quantum (128 frames) at a time,
//!   pulled from its outputs, with Chromium's silence and tail rules.
//!
//! Everything is allocated when a graph is built; nodes come and go from a
//! fixed pool, so a note can build its voice on the audio thread.
//!
//! Where Chromium's result depends on something that cannot be followed — the
//! tables of a *custom* periodic wave, which Chromium makes with Accelerate's
//! FFT — the difference is measured and said where it arises.

pub mod apple;
mod conv_order;
mod apple_tables;
pub mod fdlibm;
pub mod graph;
pub mod param;
pub mod wave;

#[cfg(test)]
mod tests_against_chromium;

/// Frames in a render quantum.
pub const QUANTUM: usize = 128;

#[cfg(test)]
mod tests {
    use super::*;

    /// The same draws as `vectors.cc` (the test oracle built from Chromium's
    /// `ieee754.cc`), and FNV-1a over the results' bits.
    struct Draws(u64);
    impl Draws {
        fn next(&mut self, lo: f64, hi: f64) -> f64 {
            self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            lo + (hi - lo) * ((self.0 >> 11) as f64 / 9007199254740992.0)
        }
    }
    fn digest(seed: u64, mut f: impl FnMut(&mut Draws) -> f64) -> u64 {
        let mut d = Draws(seed);
        let mut h: u64 = 1469598103934665603;
        for _ in 0..200_000 {
            for b in f(&mut d).to_bits().to_le_bytes() {
                h ^= b as u64;
                h = h.wrapping_mul(1099511628211);
            }
        }
        h
    }

    /// Chromium's own fdlibm, compiled on the iMac with Chromium's flags,
    /// gave these digests.
    #[test]
    fn fdlibm_is_chromiums_to_the_bit() {
        assert_eq!(digest(1, |d| fdlibm::exp(d.next(-50.0, 50.0))), 0x735afa8954ac523c, "exp");
        assert_eq!(digest(2, |d| fdlibm::sin(d.next(-7.0, 7.0))), 0x38145d8679812f01, "sin");
        assert_eq!(digest(3, |d| fdlibm::cos(d.next(-7.0, 7.0))), 0xe35c2b9311482df0, "cos");
        assert_eq!(digest(4, |d| fdlibm::log(d.next(1e-9, 1e4))), 0x8df4ceeb06a26847, "log");
        assert_eq!(
            digest(5, |d| {
                let x = d.next(1e-4, 10.0);
                let y = d.next(-3.0, 3.0);
                fdlibm::pow(x, y)
            }),
            0xfbb7f87ca5436b95,
            "pow"
        );
        assert_eq!(digest(6, |d| fdlibm::sin(d.next(-4000.0, 4000.0))), 0xa5893db3b1c58ca5, "sin, wide");
        assert_eq!(digest(7, |d| fdlibm::exp(d.next(-1e-3, 1e-3))), 0x85e64938799c4ded, "exp, small");
    }
}
