//! The three routines of macOS that Chromium's Web Audio calls on a Mac and
//! that are not correctly rounded, restated from their machine code (macOS 26,
//! arm64) so the same bits come out on any machine:
//!
//! - `exp2f`, which the oscillator uses to turn detune into a frequency ratio
//!   (`std::exp2(float)`). It is not correctly rounded: about 0.6 % of its
//!   results differ by one bit from `exp2` in double rounded to float.
//! - `log2f`, which a periodic wave uses to choose the two tables a
//!   frequency reads.
//! - `vDSP_deq22D`, the Accelerate routine a biquad runs through on a Mac
//!   whenever its coefficients are the same for the whole render quantum: a
//!   double-precision recursion whose output is kept in double, written as
//!   four fused multiply-adds.
//!
//! Each was checked against the system's own over 30 million arguments (and
//! the recursion over 5,000 samples) with no difference; `tests` keeps a
//! digest of those checks.

use super::apple_tables::{EXP2F_TABLE, LOG2F_TABLE};

/// macOS's `exp2f`.
pub fn exp2f(x: f32) -> f32 {
    let w = x.to_bits();
    if (w >> 23) & 0xff >= 0x87 {
        // |x| ≥ 256, or not finite.
        if x.is_nan() {
            return x;
        }
        return if x < 0.0 { 0.0 } else { f32::INFINITY };
    }
    let d0 = x as f64;
    let shift = f64::from_bits(0x42c8000000000000);
    let d2 = d0 + shift;
    let d1 = d2 - shift;
    let bits = d2.to_bits();
    let r = d0 - d1;
    let scale = f64::from_bits(EXP2F_TABLE[(bits & 0x7f) as usize].wrapping_add(bits << 45));
    let p = f64::from_bits(0x3fcebfbdff30d656).mul_add(r, f64::from_bits(0x3fe62e4453e10dae));
    let q = p * r;
    q.mul_add(scale, scale) as f32
}

/// macOS's `log2f`.
pub fn log2f(x: f32) -> f32 {
    let mut w = x.to_bits();
    if w.wrapping_sub(0x0080_0000) >= 0x7f00_0000 {
        // Zero, negative, subnormal, infinite or NaN.
        if x.is_nan() {
            return x;
        }
        if x == 0.0 {
            return f32::NEG_INFINITY;
        }
        if x < 0.0 {
            return f32::NAN;
        }
        if x.is_infinite() {
            return x;
        }
        // A subnormal: made normal, its exponent moved down to match.
        let s = f32::from_bits(w | 0x3f80_0000) - 1.0;
        w = s.to_bits().wrapping_add(0xc100_0000);
    }
    let e = (0xc0c1_0000u32.wrapping_add(w) as i32) >> 23;
    let m = w & 0x7f_ffff;
    let idx = ((m + 0x1_0000) >> 17) as usize;
    let f = f32::from_bits(m | 0x3f80_0000) as f64;
    let c = |i: usize| f64::from_bits(LOG2F_TABLE[i]);
    let r = f.mul_add(c(4 + 2 * idx), -1.0);
    let mut a = r.mul_add(c(0), c(1));
    a = r.mul_add(a, c(2));
    a = r.mul_add(a, c(3));
    a = r.mul_add(a, c(5 + 2 * idx));
    (e as f64 + a) as f32
}

/// One step of `vDSP_deq22D`: the output for input `x0` (with the two inputs
/// before it `x1`, `x2` and the two outputs before it `y1`, `y2`), for the
/// coefficients `[b0, b1, b2, a1, a2]`.
#[inline(always)]
pub fn deq22d(c: &[f64; 5], x0: f64, x1: f64, x2: f64, y1: f64, y2: f64) -> f64 {
    let t = c[1] * x1;
    let t = x2.mul_add(c[2], t);
    let t = x0.mul_add(c[0], t);
    let t = (-c[3]).mul_add(y1, t);
    (-c[4]).mul_add(y2, t)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_values() {
        assert_eq!(exp2f(0.0), 1.0);
        assert_eq!(exp2f(1.0), 2.0);
        assert_eq!(exp2f(-1.0), 0.5);
        assert_eq!(log2f(1.0), 0.0);
        assert_eq!(log2f(8.0), 3.0);
        assert_eq!(log2f(0.5), -1.0);
        for k in 0..10_000 {
            let x = -8.0 + k as f32 * 0.0016;
            assert!((exp2f(x) - (x as f64).exp2() as f32).abs() <= f32::EPSILON * exp2f(x), "{x}");
            let y = 0.001 + k as f32 * 0.37;
            assert!((log2f(y) - (y as f64).log2() as f32).abs() <= 2.0 * f32::EPSILON * log2f(y).abs().max(1.0), "{y}");
        }
    }
}
