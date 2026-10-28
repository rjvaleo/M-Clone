//! The scale sequencer's ping-pong delay and its tape transport.
//!
//! `scale-sequencer/app.js` builds one feedback loop of two delay lines, a
//! hi-cut in each leg, the two outputs panned apart — and treats the delay
//! time as the *speed* of a tape: retiming glides the speed, re-pitching what
//! is already circulating, and never resets the loop. This is that, sample by
//! sample, and `src/modular/audio/synthLaws.ts` is its twin on the Web Audio
//! side; the constants and the tests here pin the same numbers.
//!
//! # The tape
//!
//! Delay is head gap over tape speed, `d = L / v`, and the capstan changes
//! speed at a fixed acceleration, so a glide from `d0` to `d1` takes
//! `|L/d1 − L/d0| / 12` seconds — four times longer at 30 IPS than at 7.5 for
//! the same musical change — and never less than keeps the read behind the
//! write. The browser plays the glide as a `setValueCurveAtTime` curve with a
//! point every half millisecond, interpolated linearly between points; the
//! line here reads exactly that curve.

use crate::delay::DelayLine;
use crate::webaudio::WebLowpass;
use crate::clamp;

/// The delay's note values in beats, in the original's menu order — the wire
/// value is the index. `1.33333` is labelled "1/4T" there, and kept.
pub const DELAY_BEATS: [f32; 11] = [0.125, 0.25, 0.33333, 0.5, 0.75, 1.0, 1.33333, 1.5, 2.0, 3.0, 4.0];

/// The tape speeds in inches per second, in the original's menu order.
pub const TAPE_IPS: [f32; 6] = [30.0, 15.0, 7.5, 3.75, 1.875, 0.9375];

/// Capstan acceleration, in/s².
pub const TAPE_ACCEL: f64 = 12.0;
/// Head gap, sized so the nominal speed is half a second of delay.
pub const TAPE_HEADGAP_S: f64 = 0.5;
pub const MAX_DELAY_S: f32 = 4.0;
pub const MIN_DELAY_S: f32 = 0.005;
/// A tempo change waits this long before the tape follows.
pub const TEMPO_GLIDE_DELAY_S: f64 = 0.12;
/// The hi-cut is a Web Audio lowpass at this Q, in decibels.
pub const HICUT_Q_DB: f32 = 0.5;

/// `(60 / bpm) · beats`, held to the line's range.
pub fn delay_seconds(bpm: f32, beats: f32) -> f32 {
    let bpm = if bpm.is_finite() && bpm > 0.0 { bpm } else { 120.0 };
    clamp(60.0 / bpm * beats, MIN_DELAY_S, MAX_DELAY_S)
}

/// One varispeed move, as `tapeGlideDelayTime` plans it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TapeGlide {
    pub v0: f64,
    pub v1: f64,
    /// Head gap, inches.
    pub l: f64,
    pub start: f64,
    pub duration: f64,
    pub d_end: f64,
    /// Where the delay is held until the glide starts.
    pub hold: f64,
    /// Points in the browser's curve.
    pub points: usize,
}

impl TapeGlide {
    /// `None` for a change under half a millisecond, which the original ignores.
    pub fn plan(now: f64, start_delay: f64, d_now: f64, d_target: f64, ips: f64) -> Option<Self> {
        if (d_target - d_now).abs() < 0.0005 {
            return None;
        }
        let l = ips * TAPE_HEADGAP_S;
        let v0 = l / d_now;
        let v1 = l / d_target;
        let mut duration = ((v1 - v0).abs() / TAPE_ACCEL).clamp(0.02, 10.0);
        // The tape cannot stop or reverse through the head.
        duration = duration.max((d_target - d_now).abs() / 0.85);
        let points = ((duration * 2000.0).ceil() as usize).clamp(16, 48_000);
        Some(Self { v0, v1, l, start: now + start_delay, duration, d_end: d_target, hold: d_now, points })
    }

    /// The analytic position, `L / v(t)` — what a retime starts from.
    pub fn value_at(&self, t: f64) -> f64 {
        if t >= self.start + self.duration {
            return self.d_end;
        }
        if t <= self.start {
            return self.l / self.v0;
        }
        let f = (t - self.start) / self.duration;
        self.l / (self.v0 + (self.v1 - self.v0) * f)
    }

    fn point(&self, index: usize) -> f64 {
        self.l / (self.v0 + (self.v1 - self.v0) * index as f64 / (self.points - 1) as f64)
    }

    /// What the line reads: held, then the curve point to point, then its end.
    pub fn curve_at(&self, t: f64) -> f64 {
        if t < self.start {
            return self.hold;
        }
        if t >= self.start + self.duration {
            return self.point(self.points - 1);
        }
        let position = (t - self.start) / self.duration * (self.points - 1) as f64;
        let k = position.floor() as usize;
        let a = self.point(k);
        a + (self.point(k + 1) - a) * (position - k as f64)
    }
}

/// The ping-pong loop: two lines, a hi-cut and a feedback gain in each leg,
/// each line's output panned to its side.
pub struct TapeDelay {
    sample_rate: f32,
    left: DelayLine,
    right: DelayLine,
    hicut_lr: WebLowpass,
    hicut_rl: WebLowpass,
    hicut_hz: f32,
    glide: Option<TapeGlide>,
    /// The time while no glide has happened.
    resting: f64,
}

impl TapeDelay {
    pub fn new(sample_rate: f32) -> Self {
        let rate = if sample_rate > 0.0 { sample_rate } else { 48_000.0 };
        // A little over four seconds, so the longest delay reads inside it.
        let mut delay = Self {
            sample_rate: rate,
            left: DelayLine::new(MAX_DELAY_S + 0.01, rate),
            right: DelayLine::new(MAX_DELAY_S + 0.01, rate),
            hicut_lr: WebLowpass::new(),
            hicut_rl: WebLowpass::new(),
            hicut_hz: f32::NAN,
            glide: None,
            resting: 0.25,
        };
        delay.set_hicut(200.0 * 100f32.powf(0.75));
        delay
    }

    /// Where the delay is at `t`: on a glide, or at rest.
    pub fn time_at(&self, t: f64) -> f64 {
        self.glide.map_or(self.resting, |glide| glide.curve_at(t))
    }

    /// Put the delay at a time without gliding — how the original builds it.
    pub fn set_time(&mut self, seconds: f32) {
        self.glide = None;
        self.resting = seconds as f64;
    }

    /// Glide on tape to `target` seconds, starting `start_delay` after `now`.
    pub fn retime(&mut self, now: f64, start_delay: f64, target: f32, ips: f32) {
        let d_now = self.glide.map_or(self.resting, |glide| glide.value_at(now));
        if let Some(glide) = TapeGlide::plan(now, start_delay, d_now, target as f64, ips as f64) {
            self.glide = Some(glide);
        }
    }

    pub fn glide(&self) -> Option<TapeGlide> {
        self.glide
    }

    pub fn set_hicut(&mut self, hz: f32) {
        if hz == self.hicut_hz {
            return;
        }
        self.hicut_hz = hz;
        self.hicut_lr.set(hz, HICUT_Q_DB, self.sample_rate);
        self.hicut_rl.set(hz, HICUT_Q_DB, self.sample_rate);
    }

    /// One sample in, the wet pair out — before the wet level.
    #[inline]
    pub fn process(&mut self, input: f32, t: f64, feedback: f32, spread: f32) -> [f32; 2] {
        // The delay in frames in double, as Chromium's `Delay` computes it.
        let d = self.time_at(t) * self.sample_rate as f64;
        let out_l = self.left.read_web(d);
        let out_r = self.right.read_web(d);
        let fb_lr = feedback * self.hicut_lr.process(out_l);
        let fb_rl = feedback * self.hicut_rl.process(out_r);
        self.left.push(input + fb_rl);
        self.right.push(fb_lr);
        let (ll, lr) = pan(out_l, -spread);
        let (rl, rr) = pan(out_r, spread);
        [ll + rl, lr + rr]
    }

    /// Empty the loop, and land any glide where it was going.
    pub fn clear(&mut self) {
        self.left.clear();
        self.right.clear();
        self.hicut_lr.clear();
        self.hicut_rl.clear();
        if let Some(glide) = self.glide.take() {
            self.resting = glide.d_end;
        }
    }
}

/// A `StereoPannerNode` on a mono signal: equal power.
fn pan(mono: f32, pan: f32) -> (f32, f32) {
    let angle = (clamp(pan, -1.0, 1.0) + 1.0) * 0.25 * core::f32::consts::PI;
    (mono * angle.cos(), mono * angle.sin())
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: f32 = 48_000.0;

    #[test]
    fn each_note_value_is_its_beats_at_the_tempo() {
        let at120: Vec<f32> = DELAY_BEATS.iter().map(|beats| delay_seconds(120.0, *beats)).collect();
        let expected = [0.0625, 0.125, 0.166665, 0.25, 0.375, 0.5, 0.666665, 0.75, 1.0, 1.5, 2.0];
        for (got, want) in at120.iter().zip(expected) {
            assert!((got - want).abs() < 1e-6, "{got} vs {want}");
        }
        assert_eq!(delay_seconds(30.0, 4.0), 4.0);
        assert_eq!(delay_seconds(1e6, 0.125), 0.005);
        assert_eq!(delay_seconds(f32::NAN, 1.0), 0.5);
    }

    #[test]
    fn a_glide_takes_the_speed_change_over_the_capstans_acceleration() {
        let glide = TapeGlide::plan(1.0, 0.0, 0.25, 0.5, 7.5).expect("a glide");
        assert_eq!(glide.l, 3.75);
        assert_eq!((glide.v0, glide.v1), (15.0, 7.5));
        assert!((glide.duration - 0.625).abs() < 1e-12);
        assert_eq!(glide.points, 1250);
        let fast = TapeGlide::plan(0.0, 0.0, 0.25, 0.5, 30.0).expect("a glide");
        assert!((fast.duration / glide.duration - 4.0).abs() < 1e-12);
    }

    #[test]
    fn a_glide_never_overruns_and_stays_within_its_bounds() {
        let cassette = TapeGlide::plan(0.0, 0.0, 0.25, 0.5, 1.875).expect("a glide");
        assert!((cassette.duration - 0.25 / 0.85).abs() < 1e-12);
        assert_eq!(TapeGlide::plan(0.0, 0.0, 0.005, 4.0, 30.0).expect("a glide").duration, 10.0);
        let short = TapeGlide::plan(0.0, 0.0, 0.25, 0.2505, 30.0).expect("a glide");
        assert_eq!(short.duration, 0.02);
        assert_eq!(short.points, 40);
        assert!(TapeGlide::plan(0.0, 0.0, 0.25, 0.2504, 7.5).is_none());
    }

    #[test]
    fn the_line_reads_the_browsers_curve() {
        let glide = TapeGlide::plan(2.0, 0.12, 0.25, 0.5, 7.5).expect("a glide");
        assert!((glide.start - 2.12).abs() < 1e-12);
        assert_eq!(glide.curve_at(2.05), 0.25);
        let step = glide.duration / (glide.points - 1) as f64;
        let p10 = 3.75 / (15.0 - 7.5 * 10.0 / 1249.0);
        let p11 = 3.75 / (15.0 - 7.5 * 11.0 / 1249.0);
        assert!((glide.curve_at(glide.start + step * 10.0) - p10).abs() < 1e-9);
        assert!((glide.curve_at(glide.start + step * 10.25) - (p10 + (p11 - p10) * 0.25)).abs() < 1e-9);
        assert!((glide.curve_at(glide.start + glide.duration + 1.0) - 0.5).abs() < 1e-12);
        // The analytic path agrees with the curve to well under a sample.
        let t = glide.start + step * 10.25;
        assert!((glide.value_at(t) - glide.curve_at(t)).abs() < 1e-6);
        assert_eq!(glide.value_at(1.0), 0.25);
        assert_eq!(glide.value_at(9.0), 0.5);
    }

    #[test]
    fn an_impulse_comes_back_left_then_right_after_one_delay_each() {
        let mut delay = TapeDelay::new(RATE);
        delay.set_time(0.01);
        delay.set_hicut(20_000.0);
        let mut out = Vec::new();
        for n in 0..2_000 {
            let t = n as f64 / RATE as f64;
            out.push(delay.process(if n == 0 { 1.0 } else { 0.0 }, t, 0.5, 1.0));
        }
        // Spread 1 is hard left for the first line and hard right for the second.
        let first = out.iter().position(|s| s[0].abs() > 0.1).expect("a left echo");
        let second = out.iter().position(|s| s[1].abs() > 0.1).expect("a right echo");
        assert_eq!(first, 480);
        assert!((second as i64 - 960).abs() <= 2, "right echo at {second}");
        assert!(out[480][1].abs() < 1e-6, "the first echo leaked right");
        // The second echo is the first through the hi-cut, whose gain at DC is
        // one, and the feedback: half of it, spread over a few samples.
        let echo: f32 = out[950..1_100].iter().map(|s| s[1]).sum();
        assert!((echo - 0.5).abs() < 0.01, "{echo}");
    }

    #[test]
    fn a_retime_glides_from_where_the_tape_has_got_to() {
        let mut delay = TapeDelay::new(RATE);
        delay.set_time(0.25);
        delay.retime(0.0, 0.0, 2.0, 7.5);
        let first = delay.glide().expect("a glide");
        delay.retime(0.5, 0.0, 0.125, 7.5);
        let second = delay.glide().expect("another");
        assert!((second.hold - first.value_at(0.5)).abs() < 1e-12);
        assert_eq!(delay.time_at(100.0), second.curve_at(100.0));
        // Asking for where it already is leaves the glide alone.
        delay.retime(100.0, 0.0, 0.125, 7.5);
        assert_eq!(delay.glide(), Some(second));
        delay.clear();
        assert!(delay.glide().is_none());
        assert!((delay.time_at(0.0) - 0.125).abs() < 1e-9);
        delay.clear();
        assert!((delay.time_at(0.0) - 0.125).abs() < 1e-9);
        assert_eq!(TapeDelay::new(0.0).time_at(0.0), 0.25);
    }
}
