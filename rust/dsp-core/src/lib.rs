//! Portable DSP for the idMLab modular rack.
//!
//! This crate is the answer to a question the TypeScript audio layer could not
//! answer: *what runs natively?* The browser build expressed its effects as a
//! graph of Web Audio nodes, which was the fastest way to make sound and is a
//! ceiling in three directions at once — no per-sample logic, no true feedback
//! shorter than a render quantum, and no way to leave the browser.
//!
//! Everything here is plain arithmetic over `f32` and `f64`. There is no
//! platform, no allocator after construction, no trait objects on the hot path,
//! and no dependencies. It compiles to `wasm32-unknown-unknown` for the
//! AudioWorklet and to any native target for a plugin or standalone host, and
//! the same tests run against both.
//!
//! # The three rules
//!
//! 1. **Nothing allocates after `new`.** Every buffer is sized at construction
//!    from a sample rate and a documented maximum. A `process` call that
//!    allocated would be a dropout waiting for a quiet moment to happen.
//! 2. **Nothing panics.** Indexing is masked, divisors are clamped, and every
//!    parameter setter clamps its input. A panic in an audio callback is not an
//!    error message, it is silence.
//! 3. **Everything is sample-rate independent.** Times are seconds, frequencies
//!    are hertz, and coefficients derive from `sample_rate` at construction.
//!    A patch must sound the same at 44.1 kHz and 96 kHz.

#![forbid(unsafe_code)]

pub mod delay;
pub mod engine;
pub mod dynamics;
pub mod fdn;
pub mod filter;
pub mod reverb;

/// Below this, a value is flushed to zero.
///
/// WebAssembly has **no flush-to-zero mode**. The spec mandates strict IEEE-754
/// and there is no way to ask for FTZ, so a denormal that would cost nothing on
/// native x86 costs 100+ cycles in a browser. A reverb tail decaying toward zero
/// for minutes is exactly the shape that produces them, so the flush is explicit
/// and lives in the primitives rather than in a mode someone forgets to set.
///
/// Set well above the denormal boundary (1.18e−38) because the boundary is not
/// the interesting number — the *stall* is. A decaying one-pole loses a fixed
/// fraction per sample, so it approaches zero geometrically and would sit in the
/// denormal range for a long time on its way through. Cutting at 1e−25 (−500 dBFS)
/// removes the whole approach, not just the last step of it.
pub const DENORMAL_FLOOR: f32 = 1.0e-25;

/// Anti-denormal DC, injected into every feedback loop.
///
/// −400 dBFS: inaudible by four orders of magnitude, and enough to keep a decaying
/// loop out of the denormal range without the branch that `flush` costs.
pub const ANTI_DENORMAL_DC: f32 = 1.0e-20;

/// Flush a denormal to zero.
///
/// The obvious implementation is `x + FLOOR - FLOOR`, which is branchless and
/// looks clever. It is also **wrong near the boundary**: the addition only
/// absorbs `x` when `x` is below `f32`'s relative epsilon against `FLOOR`, so
/// values within about seven decades above the floor survive it untouched. A
/// one-pole decaying toward zero stalls there — measured at 1.88e−37, which is
/// exactly the denormal range this is supposed to prevent.
///
/// The comparison is correct, and on every target that matters it compiles to a
/// compare-and-select rather than a branch, so it vectorises anyway.
#[inline(always)]
pub fn flush(x: f32) -> f32 {
    if x.abs() < DENORMAL_FLOOR {
        0.0
    } else {
        x
    }
}

#[inline(always)]
pub fn clamp(value: f32, low: f32, high: f32) -> f32 {
    if value < low {
        low
    } else if value > high {
        high
    } else {
        value
    }
}

/// Map a normalised `0..=1` control onto a logarithmic range.
///
/// The right curve for anything measured in hertz or seconds, because both are
/// perceived logarithmically: the audible distance from 100 Hz to 200 Hz is the
/// same as from 1 kHz to 2 kHz, and a linear knob would spend nine-tenths of its
/// travel in the top octave.
#[inline]
pub fn log_map(u: f32, low: f32, high: f32) -> f32 {
    let u = clamp(u, 0.0, 1.0);
    let low = low.max(1.0e-9);
    low * (high / low).powf(u)
}

/// A linear ramp, retargeted at block boundaries.
///
/// Every audible parameter goes through one of these. A parameter written
/// directly is a step, a step is a click, and a click is the one artefact a
/// listener always notices.
#[derive(Clone, Copy, Debug)]
pub struct Smoothed {
    current: f32,
    target: f32,
    step: f32,
    remaining: u32,
}

impl Smoothed {
    pub fn new(value: f32) -> Self {
        Self { current: value, target: value, step: 0.0, remaining: 0 }
    }

    /// Jump with no ramp. Construction only — never while sounding.
    pub fn reset(&mut self, value: f32) {
        self.current = value;
        self.target = value;
        self.step = 0.0;
        self.remaining = 0;
    }

    pub fn set_target(&mut self, target: f32, steps: u32) {
        self.target = target;
        if steps == 0 {
            self.current = target;
            self.step = 0.0;
            self.remaining = 0;
        } else {
            self.step = (target - self.current) / steps as f32;
            self.remaining = steps;
        }
    }

    /// Advance one sample and return the new value.
    ///
    /// Named `next` despite clippy's warning about the `Iterator` collision:
    /// this is read once per sample in the hot loop and `next()` is what every
    /// DSP author expects to call. Implementing `Iterator` instead would make it
    /// infinite and lazy, which is worse.
    #[allow(clippy::should_implement_trait)]
    #[inline(always)]
    pub fn next(&mut self) -> f32 {
        if self.remaining > 0 {
            self.remaining -= 1;
            self.current += self.step;
            if self.remaining == 0 {
                self.current = self.target;
            }
        }
        self.current
    }

    #[inline(always)]
    pub fn value(&self) -> f32 {
        self.current
    }

    #[inline(always)]
    pub fn target(&self) -> f32 {
        self.target
    }

    pub fn is_moving(&self) -> bool {
        self.remaining > 0
    }
}

/// A deterministic PRNG.
///
/// `xoshiro128++`. Seeded explicitly so an offline render is reproducible: a
/// reverb whose modulation came from `Math.random()` would render a different
/// tail every time, and a saved project would not reproduce the performance it
/// saved.
#[derive(Clone, Debug)]
pub struct Rng {
    state: [u32; 4],
}

impl Rng {
    pub fn new(seed: u32) -> Self {
        // SplitMix-style expansion so a low seed still fills the state.
        let mut s = seed.wrapping_mul(0x9E37_79B9).wrapping_add(0x1234_5678);
        let mut next = || {
            s ^= s << 13;
            s ^= s >> 17;
            s ^= s << 5;
            s | 1
        };
        Self { state: [next(), next(), next(), next()] }
    }

    #[inline]
    pub fn next_u32(&mut self) -> u32 {
        let result = self.state[0]
            .wrapping_add(self.state[3])
            .rotate_left(7)
            .wrapping_add(self.state[0]);
        let t = self.state[1] << 9;
        self.state[2] ^= self.state[0];
        self.state[3] ^= self.state[1];
        self.state[1] ^= self.state[2];
        self.state[0] ^= self.state[3];
        self.state[2] ^= t;
        self.state[3] = self.state[3].rotate_left(11);
        result
    }

    /// Uniform on `[-1, 1)`.
    #[inline]
    pub fn next_bipolar(&mut self) -> f32 {
        (self.next_u32() as f32 / u32::MAX as f32) * 2.0 - 1.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flush_kills_denormals_and_spares_audio() {
        assert_eq!(flush(1.0e-38), 0.0);
        assert_eq!(flush(-1.0e-38), 0.0);
        // The value the add-subtract trick failed to kill, which is why this
        // function is a comparison instead.
        assert_eq!(flush(1.880_791e-37), 0.0);
        assert_eq!(flush(1.0e-26), 0.0);
        // Ordinary audio round-trips bit-exactly, which is the part that matters:
        // a flush that altered signal would be a noise floor, not a fix.
        for x in [1.0f32, 0.5, -0.25, 1.0e-6, -1.0e-9] {
            assert_eq!(flush(x), x, "flush altered {x}");
        }
    }

    #[test]
    fn log_map_is_monotonic_and_hits_both_ends() {
        assert!((log_map(0.0, 20.0, 20_000.0) - 20.0).abs() < 1.0e-3);
        assert!((log_map(1.0, 20.0, 20_000.0) - 20_000.0).abs() < 1.0);
        let mut previous = 0.0;
        for i in 0..=100 {
            let v = log_map(i as f32 / 100.0, 20.0, 20_000.0);
            assert!(v > previous, "not monotonic at {i}");
            previous = v;
        }
        // The defining property: equal knob travel is equal ratio.
        let a = log_map(0.25, 20.0, 20_000.0) / log_map(0.0, 20.0, 20_000.0);
        let b = log_map(0.75, 20.0, 20_000.0) / log_map(0.5, 20.0, 20_000.0);
        assert!((a - b).abs() / a < 1.0e-4);
    }

    #[test]
    fn smoothed_reaches_its_target_exactly() {
        let mut s = Smoothed::new(0.0);
        s.set_target(1.0, 64);
        for _ in 0..63 {
            s.next();
        }
        assert!(s.is_moving());
        let final_value = s.next();
        // Exactly, not approximately: accumulated float error left un-snapped
        // becomes a parameter that never quite arrives.
        assert_eq!(final_value, 1.0);
        assert!(!s.is_moving());
    }

    #[test]
    fn smoothed_zero_steps_is_a_jump() {
        let mut s = Smoothed::new(0.0);
        s.set_target(0.5, 0);
        assert_eq!(s.value(), 0.5);
    }

    #[test]
    fn rng_is_deterministic_and_reproducible() {
        let a: Vec<u32> = (0..8).map(|_| Rng::new(42).next_u32()).collect();
        let b: Vec<u32> = (0..8).map(|_| Rng::new(42).next_u32()).collect();
        assert_eq!(a, b);
        assert_ne!(Rng::new(42).next_u32(), Rng::new(43).next_u32());
    }

    #[test]
    fn rng_bipolar_stays_in_range_and_centres() {
        let mut rng = Rng::new(7);
        let mut sum = 0.0f64;
        for _ in 0..20_000 {
            let v = rng.next_bipolar();
            assert!((-1.0..=1.0).contains(&v));
            sum += v as f64;
        }
        assert!((sum / 20_000.0).abs() < 0.02, "biased: {}", sum / 20_000.0);
    }
}
