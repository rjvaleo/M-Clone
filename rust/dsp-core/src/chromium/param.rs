//! An `AudioParam`: its value, its automation timeline, and how a render
//! quantum reads it — Chromium's `AudioParamHandler` (`audio_param_handler.cc`),
//! ported function for function on the paths an arm64 Mac takes (the scalar
//! loops: the SSE ones are for x86).
//!
//! What the graph adds is the sum of whatever is connected to the parameter;
//! see `graph.rs`. Value curves (`setValueCurveAtTime`) are held in two
//! curve slots a parameter owns: a curve is copied in when it is set (that
//! allocates, once per slot), and a cancelled curve keeps its slot while the
//! next one fills the other.

use super::fdlibm;
use super::QUANTUM;

/// `kTimeConstantsToConverge` and `kSetTargetThreshold`.
const TIME_CONSTANTS_TO_CONVERGE: f32 = 10.0;
const SET_TARGET_THRESHOLD: f32 = 4.539992976248485e-05;

/// The most events one parameter holds. When full, the oldest goes.
pub const MAX_EVENTS: usize = 32;

/// `audio_utilities::DiscreteTimeConstantForSampleRate`.
#[inline]
pub fn discrete_time_constant(time_constant: f64, sample_rate: f64) -> f64 {
    1.0 - fdlibm::exp(-1.0 / (sample_rate * time_constant))
}

/// `HasSetTargetConverged`.
fn set_target_converged(value: f32, target: f32, current_time: f64, start_time: f64, time_constant: f64) -> bool {
    if current_time > start_time + TIME_CONSTANTS_TO_CONVERGE as f64 * time_constant {
        return true;
    }
    if target == 0.0 && value.abs() < SET_TARGET_THRESHOLD {
        return true;
    }
    target != 0.0 && (target - value).abs() < SET_TARGET_THRESHOLD * value.abs()
}

fn linear_ramp_at_time(t: f64, value1: f32, time1: f64, value2: f32, time2: f64) -> f32 {
    (value1 as f64 + (value2 - value1) as f64 * (t - time1) / (time2 - time1)) as f32
}

fn exponential_ramp_at_time(t: f64, value1: f32, time1: f64, value2: f32, time2: f64) -> f32 {
    if value1 == 0.0 || value1.is_sign_negative() != value2.is_sign_negative() {
        value1
    } else {
        (value1 as f64 * fdlibm::pow((value2 / value1) as f64, (t - time1) / (time2 - time1))) as f32
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    SetValue,
    Linear,
    Exponential,
    SetTarget,
    Cancel,
    /// `kSetValueCurve`.
    Curve,
    /// `kSetValueCurveEnd`.
    CurveEnd,
    /// "No next event" (`kLastType`).
    Last,
}

/// What a `CancelValues` event remembers of the ramp it cut.
#[derive(Clone, Copy, Debug)]
struct Saved {
    kind: Kind,
    value: f32,
    time: f64,
}

#[derive(Clone, Copy, Debug)]
struct Event {
    kind: Kind,
    value: f32,
    time: f64,
    time_constant: f64,
    initial_value: f32,
    saved: Option<Saved>,
    has_default_cancelled_value: bool,
    /// In Chromium's `new_events_`: not yet clamped to the current time.
    new: bool,
    /// A curve's length in seconds, its slot, `(N - 1) / duration`, and its
    /// last value.
    duration: f64,
    curve: u8,
    curve_points_per_second: f64,
    curve_end_value: f32,
}

impl Event {
    const fn new(kind: Kind, value: f32, time: f64) -> Self {
        Self {
            kind,
            value,
            time,
            time_constant: 0.0,
            initial_value: 0.0,
            saved: None,
            has_default_cancelled_value: false,
            new: true,
            duration: 0.0,
            curve: 0,
            curve_points_per_second: 0.0,
            curve_end_value: 0.0,
        }
    }
}

/// Whether an `AudioParam` is a-rate or k-rate.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rate {
    Audio,
    Control,
}

/// Where the context is, as an `AudioParam` asks its destination.
#[derive(Clone, Copy, Debug)]
pub struct Clock {
    /// The first frame of the quantum being rendered (`CurrentSampleFrame`).
    pub frame: u64,
    pub sample_rate: f64,
}

impl Clock {
    pub fn time(&self) -> f64 {
        self.frame as f64 / self.sample_rate
    }
}

/// An `AudioParam`.
#[derive(Clone, Debug)]
pub struct Param {
    events: [Event; MAX_EVENTS],
    len: usize,
    intrinsic: f32,
    default: f32,
    min: f32,
    max: f32,
    rate: Rate,
    /// The curves of `setValueCurveAtTime`, by slot.
    curves: [Vec<f32>; 2],
}

/// `ValueCurveAtTime`.
fn value_curve_at_time(t: f64, time1: f64, duration: f64, curve: &[f32]) -> f32 {
    let curve_index = (curve.len() - 1) as f64 / duration * (t - time1);
    let k = (curve_index as usize).min(curve.len() - 1);
    let k1 = (k + 1).min(curve.len() - 1);
    let c0 = curve[k];
    let c1 = curve[k1];
    let delta = (curve_index - k as f64).min(1.0);
    (c0 as f64 + (c1 - c0) as f64 * delta) as f32
}

impl Param {
    pub fn new(default: f32, min: f32, max: f32, rate: Rate) -> Self {
        Self {
            events: [Event::new(Kind::SetValue, 0.0, 0.0); MAX_EVENTS],
            len: 0,
            intrinsic: default,
            default,
            min,
            max,
            rate,
            curves: [Vec::new(), Vec::new()],
        }
    }

    /// Back to as built, every event gone.
    pub fn reset(&mut self) {
        self.len = 0;
        self.intrinsic = self.default;
    }

    pub fn rate(&self) -> Rate {
        self.rate
    }

    pub fn default_value(&self) -> f32 {
        self.default
    }

    pub fn min_value(&self) -> f32 {
        self.min
    }

    pub fn max_value(&self) -> f32 {
        self.max
    }

    pub fn is_audio_rate(&self) -> bool {
        self.rate == Rate::Audio
    }

    /// The intrinsic value (`IntrinsicValue`).
    pub fn intrinsic(&self) -> f32 {
        self.intrinsic
    }

    /// `AudioParamHandler::SetValue`: the intrinsic value, clamped.
    fn set_intrinsic(&mut self, value: f32) {
        self.intrinsic = value.clamp_nan(self.min, self.max);
    }

    // ── The page's calls ────────────────────────────────────────────────────

    /// `param.value = v`: the intrinsic value, and a `setValueAtTime` at the
    /// current time.
    pub fn set_value(&mut self, value: f32, now: Clock) {
        self.set_intrinsic(value);
        self.set_value_at_time(self.intrinsic, now.time(), now);
    }

    pub fn set_value_at_time(&mut self, value: f32, time: f64, now: Clock) {
        if !(time >= 0.0) || !value.is_finite() {
            return;
        }
        let time = time.max(now.time());
        self.insert(Event::new(Kind::SetValue, value, time), now);
    }

    pub fn linear_ramp_to_value_at_time(&mut self, value: f32, time: f64, now: Clock) {
        if !(time >= 0.0) || !value.is_finite() {
            return;
        }
        let time = time.max(now.time());
        let mut e = Event::new(Kind::Linear, value, time);
        e.initial_value = self.intrinsic;
        self.insert(e, now);
    }

    pub fn exponential_ramp_to_value_at_time(&mut self, value: f32, time: f64, now: Clock) {
        if !(time >= 0.0) || !value.is_finite() || value == 0.0 {
            return;
        }
        let time = time.max(now.time());
        let mut e = Event::new(Kind::Exponential, value, time);
        e.initial_value = self.intrinsic;
        self.insert(e, now);
    }

    pub fn set_target_at_time(&mut self, target: f32, time: f64, time_constant: f64, now: Clock) {
        if !(time >= 0.0) || !(time_constant >= 0.0) || !target.is_finite() {
            return;
        }
        let time = time.max(now.time());
        if time_constant == 0.0 {
            self.insert(Event::new(Kind::SetValue, target, time), now);
        } else {
            let mut e = Event::new(Kind::SetTarget, target, time);
            e.time_constant = time_constant;
            self.insert(e, now);
        }
    }

    /// `setValueCurveAtTime`: the curve, and a `kSetValueCurveEnd` at its end
    /// so what follows starts from its last value. Copies the curve into a
    /// slot no live event holds.
    pub fn set_value_curve_at_time(&mut self, curve: &[f32], start_time: f64, duration: f64, now: Clock) {
        if !(start_time >= 0.0) || !(duration > 0.0) || curve.len() < 2 {
            return;
        }
        let start_time = start_time.max(now.time());
        let held = |slot: u8, events: &[Event]| events.iter().any(|e| e.kind == Kind::Curve && e.curve == slot);
        let slot: u8 = if held(0, &self.events[..self.len]) { 1 } else { 0 };
        let c = &mut self.curves[slot as usize];
        c.clear();
        c.extend_from_slice(curve);
        let mut e = Event::new(Kind::Curve, 0.0, start_time);
        e.duration = duration;
        e.curve = slot;
        e.curve_points_per_second = (curve.len() - 1) as f64 / duration;
        e.curve_end_value = curve[curve.len() - 1];
        self.insert(e, now);
        self.insert(Event::new(Kind::CurveEnd, curve[curve.len() - 1], start_time + duration), now);
    }

    pub fn cancel_scheduled_values(&mut self, time: f64, now: Clock) {
        if !(time >= 0.0) {
            return;
        }
        let time = time.max(now.time());
        if let Some(i) = self.events[..self.len].iter().position(|e| e.time >= time) {
            self.len = i;
        }
    }

    pub fn cancel_and_hold_at_time(&mut self, time: f64, now: Clock) {
        if !(time >= 0.0) {
            return;
        }
        let cancel_time = time.max(now.time());
        let mut i = 0;
        while i < self.len && self.events[i].time <= cancel_time {
            i += 1;
        }
        let mut cancelled = i;
        if i > 0 && self.events[i - 1].kind == Kind::SetTarget {
            cancelled = i - 1;
        } else if i >= self.len {
            return;
        }
        let event = self.events[cancelled];
        let mut new_event = None;
        let mut new_set_value = None;
        match event.kind {
            Kind::Linear | Kind::Exponential => {
                let mut e = Event::new(Kind::Cancel, 0.0, cancel_time);
                e.saved = Some(Saved { kind: event.kind, value: event.value, time: event.time });
                new_event = Some(e);
            }
            Kind::SetTarget => {
                if event.time < cancel_time {
                    cancelled += 1;
                    new_event = Some(Event::new(Kind::Cancel, 0.0, cancel_time));
                }
            }
            Kind::Curve => {
                if event.time < cancel_time {
                    if cancel_time > event.time + event.duration {
                        cancelled += 1;
                    } else {
                        let new_duration = cancel_time - event.time;
                        let end_value = value_curve_at_time(cancel_time, event.time, event.duration, &self.curves[event.curve as usize]);
                        let mut e = event;
                        e.duration = new_duration;
                        e.curve_end_value = end_value;
                        e.saved = None;
                        new_event = Some(e);
                        new_set_value = Some(Event::new(Kind::SetValue, end_value, event.time + new_duration));
                    }
                }
            }
            _ => {}
        }
        if cancelled < self.len {
            self.len = cancelled;
        }
        if let Some(e) = new_event {
            self.insert(e, now);
            if let Some(s) = new_set_value {
                self.insert(s, now);
            }
        }
    }

    /// `InsertEvent`.
    fn insert(&mut self, event: Event, now: Clock) {
        // Prune what is already past, as the main thread does.
        if self.len > 0 {
            let mut skipped = 0;
            for i in 0..self.len {
                let next = if i + 1 < self.len { Some(i + 1) } else { None };
                if self.is_current(i, next, now.frame as f64, now.sample_rate) {
                    break;
                }
                skipped += 1;
            }
            if skipped > 0 {
                self.remove_old(skipped);
            }
        }
        if self.len == 0 && matches!(event.kind, Kind::Linear | Kind::Exponential) {
            self.push_at(0, Event::new(Kind::SetValue, event.initial_value, now.time()));
        }
        if self.len == 0 {
            self.push_at(0, event);
            return;
        }
        let mut at = self.len;
        if self.events[self.len - 1].time > event.time {
            at = self.events[..self.len].iter().position(|e| event.time < e.time).unwrap_or(self.len);
        }
        self.push_at(at, event);
    }

    fn push_at(&mut self, at: usize, event: Event) {
        let mut at = at;
        if self.len == MAX_EVENTS {
            self.events.copy_within(1..MAX_EVENTS, 0);
            self.len -= 1;
            at = at.saturating_sub(1);
        }
        self.events.copy_within(at..self.len, at + 1);
        self.events[at] = event;
        self.len += 1;
    }

    /// `RemoveOldEvents`: never the last one.
    fn remove_old(&mut self, count: usize) {
        if self.len > 1 {
            let n = count.min(self.len - 1);
            self.events.copy_within(n..self.len, 0);
            self.len -= n;
        }
    }

    /// `IsEventCurrent`.
    fn is_current(&self, i: usize, next: Option<usize>, current_frame: f64, sample_rate: f64) -> bool {
        let Some(n) = next else { return true };
        if self.events[n].time * sample_rate >= current_frame {
            return true;
        }
        let event = &self.events[i];
        let event_frame = event.time * sample_rate;
        matches!(event.kind, Kind::SetValue | Kind::CurveEnd) && event_frame <= current_frame && current_frame < event_frame + 1.0
    }

    // ── The audio thread's calls ────────────────────────────────────────────

    /// `HasSampleAccurateValues`, given whether anything is connected.
    pub fn has_sample_accurate_values(&self, connected: bool, now: Clock) -> bool {
        if connected {
            return true;
        }
        if self.len == 0 {
            return false;
        }
        let current_frame = now.frame;
        let sr = now.sample_rate;
        let end = (current_frame + QUANTUM as u64) as f64 / sr;
        let first = &self.events[0];
        if first.time > end && matches!(first.kind, Kind::SetTarget | Kind::SetValue | Kind::Curve) {
            return false;
        }
        if self.len >= 2 {
            return true;
        }
        match first.kind {
            Kind::SetTarget => first.time <= end,
            _ => !(first.time < current_frame as f64 / sr),
        }
    }

    /// `ValueForContextTime`: the k-rate value for this quantum, if the
    /// timeline gives one.
    fn value_for_context_time(&mut self, default: f32, now: Clock) -> Option<f32> {
        if self.len == 0 || now.time() < self.events[0].time {
            return None;
        }
        let mut value = [0.0f32];
        let control_rate = now.sample_rate / QUANTUM as f64;
        Some(self.values_for_frame_range(now.frame, now.frame + 1, default, &mut value, now.sample_rate, control_rate))
    }

    /// `Value()`, as a node reads it on the audio thread.
    pub fn value(&mut self, now: Clock) -> f32 {
        let mut v = self.intrinsic;
        if let Some(t) = self.value_for_context_time(v, now) {
            v = t;
        }
        self.set_intrinsic(v);
        v
    }

    /// The timeline's part of `CalculateFinalValues`: `values` filled at audio
    /// rate (`sample_accurate`) or with the one k-rate value. The graph then
    /// adds what is connected and calls [`Param::finish_connected`].
    pub fn timeline_values(&mut self, values: &mut [f32], sample_accurate: bool, now: Clock) {
        if sample_accurate {
            let end = now.frame + values.len() as u64;
            let v = self.values_for_frame_range(now.frame, end, self.intrinsic, values, now.sample_rate, now.sample_rate);
            self.set_intrinsic(v);
        } else {
            let mut value = self.intrinsic;
            if let Some(t) = self.value_for_context_time(value, now) {
                value = t;
            }
            values.iter_mut().for_each(|v| *v = value);
            self.set_intrinsic(value);
        }
    }

    /// After the connected inputs are summed in: NaN to the default, then
    /// clamped to the nominal range (only when something is connected).
    pub fn finish_connected(&self, values: &mut [f32]) {
        for v in values.iter_mut() {
            if v.is_nan() {
                *v = self.default;
            }
            *v = v.clamp_nan(self.min, self.max);
        }
    }

    /// `FinalValue()` with nothing connected: the k-rate value.
    pub fn final_value(&mut self, now: Clock) -> f32 {
        let mut v = [0.0f32];
        self.timeline_values(&mut v, false, now);
        v[0]
    }

    /// `ValuesForFrameRange`: the timeline, then clamped.
    fn values_for_frame_range(
        &mut self,
        start_frame: u64,
        end_frame: u64,
        default: f32,
        values: &mut [f32],
        sample_rate: f64,
        control_rate: f64,
    ) -> f32 {
        let last = self.values_impl(start_frame, end_frame, default, values, sample_rate, control_rate);
        for v in values.iter_mut() {
            *v = v.clamp_nan(self.min, self.max);
        }
        last
    }

    /// `ValuesForFrameRangeImpl`.
    fn values_impl(
        &mut self,
        start_frame: u64,
        end_frame: u64,
        default: f32,
        values: &mut [f32],
        sample_rate: f64,
        control_rate: f64,
    ) -> f32 {
        let mut default = default;
        if self.len == 0 || end_frame as f64 / sample_rate <= self.events[0].time {
            values.iter_mut().for_each(|v| *v = default);
            return default;
        }
        let number_of_events = self.len;
        if self.events[..self.len].iter().any(|e| e.new) {
            self.clamp_new_events(start_frame as f64 / sample_rate);
        }
        {
            let current_time = start_frame as f64 / sample_rate;
            if self.all_events_in_the_past(current_time, sample_rate, &mut default, values) {
                return default;
            }
        }
        let size = values.len();
        // HandleFirstEvent.
        let mut current_frame = start_frame;
        let mut write_index = 0usize;
        let first_time = self.events[0].time;
        if first_time > start_frame as f64 / sample_rate {
            let mut fill_to_end = end_frame;
            let first_frame = (first_time * sample_rate).ceil();
            if (end_frame as f64) > first_frame {
                fill_to_end = first_frame as u64;
            }
            let fill_to = ((fill_to_end - start_frame) as usize).min(size);
            values[write_index..fill_to].iter_mut().for_each(|v| *v = default);
            write_index = fill_to;
            current_frame += fill_to as u64;
        }

        let mut value = default;
        let mut skipped = 0;
        let mut i = 0;
        while i < number_of_events && write_index < size {
            let next = if i + 1 < number_of_events { Some(i + 1) } else { None };
            if !self.is_current(i, next, current_frame as f64, sample_rate) {
                skipped += 1;
                i += 1;
                continue;
            }
            let next_kind = next.map(|n| self.events[n].kind).unwrap_or(Kind::Last);
            self.set_target_followed_by_ramp(i, next_kind, current_frame, sample_rate, control_rate, &mut value);

            let event = self.events[i];
            let value1 = event.value;
            let time1 = event.time;
            let (value2, time2, next_kind) = match next {
                Some(n) => {
                    let (v2, t2) = (self.events[n].value, self.events[n].time);
                    self.handle_cancel_values(i, n, v2, t2)
                }
                None => (value1, end_frame as f64 / sample_rate + 1.0, Kind::Last),
            };

            let fill_to_end = if (end_frame as f64) > time2 * sample_rate {
                (time2 * sample_rate).ceil() as u64
            } else {
                end_frame
            };
            let fill_to = ((fill_to_end - start_frame) as usize).min(size);

            if next_kind == Kind::Linear {
                // ProcessLinearRamp.
                let delta_time = time2 - time1;
                let k: f32 = if delta_time <= f32::MIN_POSITIVE as f64 { 0.0 } else { (1.0 / delta_time) as f32 };
                let value_delta = value2 - value1;
                for slot in values[write_index..fill_to].iter_mut() {
                    let x = ((current_frame as f64 / sample_rate - time1) * k as f64) as f32;
                    value = value1 + x * value_delta;
                    current_frame += 1;
                    *slot = value;
                }
                write_index = fill_to;
            } else if next_kind == Kind::Exponential {
                // ProcessExponentialRamp.
                if value1 * value2 <= 0.0 || time1 >= time2 {
                    value = value1;
                    values[write_index..fill_to].iter_mut().for_each(|v| *v = value);
                    write_index = fill_to;
                } else {
                    let delta_time = time2 - time1;
                    let frames = delta_time * sample_rate;
                    let multiplier = fdlibm::pow((value2 / value1) as f64, 1.0 / frames);
                    value = (value1 as f64
                        * fdlibm::pow(value2 as f64 / value1 as f64, (current_frame as f64 / sample_rate - time1) / delta_time))
                        as f32;
                    let mut accumulator = value as f64;
                    for slot in values[write_index..fill_to].iter_mut() {
                        value = accumulator as f32;
                        accumulator *= multiplier;
                        current_frame += 1;
                        *slot = value;
                    }
                    write_index = fill_to;
                    if current_frame as f64 > time2 * sample_rate - 0.5 {
                        value = value2;
                    }
                }
            } else {
                match event.kind {
                    Kind::SetValue | Kind::CurveEnd | Kind::Linear | Kind::Exponential => {
                        current_frame = fill_to_end;
                        value = event.value;
                        values[write_index..fill_to].iter_mut().for_each(|v| *v = value);
                        write_index = fill_to;
                    }
                    Kind::Cancel => {
                        // ProcessCancelValues.
                        if event.has_default_cancelled_value {
                            value = event.value;
                        } else {
                            let cancel_frame = time1 * sample_rate;
                            let cf = current_frame as f64;
                            if i >= 1 && cancel_frame <= cf && cf < cancel_frame + 1.0 {
                                let last = self.events[i - 1];
                                if last.kind == Kind::SetTarget {
                                    let tc = last.time_constant as f32;
                                    let dtc = discrete_time_constant(tc as f64, control_rate) as f32;
                                    value += (last.value - value) * dtc;
                                }
                            }
                        }
                        values[write_index..fill_to].iter_mut().for_each(|v| *v = value);
                        write_index = fill_to;
                        current_frame = fill_to_end;
                    }
                    Kind::SetTarget => {
                        // ProcessSetTarget.
                        let target = value1;
                        let time_constant = event.time_constant as f32;
                        let dtc = discrete_time_constant(time_constant as f64, control_rate) as f32;
                        let ramp_start = time1 * sample_rate;
                        let cf = current_frame as f64;
                        if ramp_start <= cf && cf < ramp_start + 1.0 {
                            value = (target as f64
                                + (value - target) as f64 * fdlibm::exp(-(cf / sample_rate - time1) / time_constant as f64))
                                as f32;
                        } else {
                            value += (target - value) * dtc;
                        }
                        if set_target_converged(value, target, cf / sample_rate, time1, time_constant as f64) {
                            current_frame += (fill_to - write_index) as u64;
                            values[write_index..fill_to].iter_mut().for_each(|v| *v = target);
                            write_index = fill_to;
                        } else {
                            for slot in values[write_index..fill_to].iter_mut() {
                                let v = value;
                                value += (target - value) * dtc;
                                *slot = v;
                            }
                            write_index = fill_to;
                            if write_index >= 1 {
                                value = values[write_index - 1];
                            }
                            current_frame = fill_to_end;
                        }
                    }
                    Kind::Curve => {
                        // ProcessSetValueCurve, the scalar loop (arm64).
                        let curve = &self.curves[event.curve as usize];
                        let duration = event.duration;
                        let points_per_frame = event.curve_points_per_second / sample_rate;
                        if curve.is_empty() || duration <= 0.0 || sample_rate <= 0.0 {
                            current_frame = fill_to_end;
                            values[write_index..fill_to].iter_mut().for_each(|v| *v = value);
                            write_index = fill_to;
                        } else {
                            let next_event_fill_to = fill_to;
                            let curve_end_frame = (sample_rate * (time1 + duration)).ceil();
                            let fill_to_end_c = if (end_frame as f64) > curve_end_frame { curve_end_frame as u64 } else { end_frame };
                            let mut fill_to_c = if fill_to_end_c < start_frame { 0 } else { (fill_to_end_c - start_frame) as usize };
                            fill_to_c = fill_to_c.min(size);
                            let mut virtual_index = 0.0f64;
                            if time1 < current_frame as f64 / sample_rate {
                                let frame_offset = current_frame as f64 - time1 * sample_rate;
                                virtual_index = points_per_frame * frame_offset;
                            }
                            value = event.curve_end_value;
                            let mut k = 0usize;
                            if fill_to_c > write_index {
                                for slot in values[write_index..fill_to_c].iter_mut() {
                                    let current = virtual_index + k as f64 * points_per_frame;
                                    let i0 = if current < curve.len() as f64 { current as usize } else { curve.len() - 1 };
                                    let i1 = (i0 + 1).min(curve.len() - 1);
                                    let c0 = curve[i0];
                                    let c1 = curve[i1];
                                    let delta = (current - i0 as f64).min(1.0);
                                    k += 1;
                                    value = (c0 as f64 + (c1 - c0) as f64 * delta) as f32;
                                    *slot = value;
                                }
                                write_index = fill_to_c;
                            }
                            if write_index < next_event_fill_to {
                                value = event.curve_end_value;
                                values[write_index..next_event_fill_to].iter_mut().for_each(|v| *v = value);
                                write_index = next_event_fill_to;
                            }
                            current_frame += next_event_fill_to as u64;
                        }
                    }
                    Kind::Last => {}
                }
            }
            i += 1;
        }
        if skipped > 0 {
            self.remove_old(skipped);
        }
        values[write_index..].iter_mut().for_each(|v| *v = value);
        values[size - 1]
    }

    /// `ClampNewEventsToCurrentTime`.
    fn clamp_new_events(&mut self, current_time: f64) {
        let mut clamped = false;
        for e in self.events[..self.len].iter_mut() {
            if e.new && e.time < current_time {
                e.time = current_time;
                clamped = true;
            }
        }
        if clamped {
            // A stable insertion sort by time.
            for i in 1..self.len {
                let mut j = i;
                while j > 0 && self.events[j].time < self.events[j - 1].time {
                    self.events.swap(j, j - 1);
                    j -= 1;
                }
            }
        }
        for e in self.events[..self.len].iter_mut() {
            e.new = false;
        }
    }

    /// `HandleAllEventsInThePast`.
    fn all_events_in_the_past(&mut self, current_time: f64, sample_rate: f64, default: &mut f32, values: &mut [f32]) -> bool {
        let last = self.events[self.len - 1];
        if last.time + 1.5 * QUANTUM as f64 / sample_rate < current_time {
            if last.kind == Kind::SetTarget {
                if set_target_converged(*default, last.value, current_time, last.time, last.time_constant) {
                    *default = last.value;
                } else {
                    return false;
                }
            }
            values.iter_mut().for_each(|v| *v = *default);
            self.remove_old(self.len);
            return true;
        }
        false
    }

    /// `ProcessSetTargetFollowedByRamp`.
    fn set_target_followed_by_ramp(
        &mut self,
        i: usize,
        next_kind: Kind,
        current_frame: u64,
        sample_rate: f64,
        control_rate: f64,
        value: &mut f32,
    ) {
        let event = self.events[i];
        if event.kind == Kind::SetTarget && matches!(next_kind, Kind::Linear | Kind::Exponential) {
            let cf = current_frame as f64;
            if (2.0 * sample_rate * event.time - 2.0 * cf + 1.0).abs() <= 1.0 {
                *value = (event.value as f64
                    + (*value - event.value) as f64 * fdlibm::exp(-(cf / sample_rate - event.time) / event.time_constant))
                    as f32;
            } else {
                let dtc = discrete_time_constant(event.time_constant, control_rate) as f32;
                *value += (event.value - *value) * dtc;
            }
            let mut set = Event::new(Kind::SetValue, *value, cf / sample_rate);
            set.new = false;
            self.events[i] = set;
        }
    }

    /// `HandleCancelValues`.
    fn handle_cancel_values(&mut self, i: usize, n: usize, value2: f32, time2: f64) -> (f32, f64, Kind) {
        let next = self.events[n];
        let mut next_kind = next.kind;
        let (mut value2, mut time2) = (value2, time2);
        if next.kind == Kind::Cancel {
            if let Some(saved) = next.saved {
                let current = self.events[i];
                match current.kind {
                    Kind::Cancel | Kind::Linear | Kind::Exponential | Kind::SetValue | Kind::CurveEnd => {
                        time2 = next.time;
                        next_kind = saved.kind;
                        if next.has_default_cancelled_value {
                            value2 = next.value;
                        } else {
                            value2 = match saved.kind {
                                Kind::Linear => linear_ramp_at_time(next.time, current.value, current.time, saved.value, saved.time),
                                _ => exponential_ramp_at_time(next.time, current.value, current.time, saved.value, saved.time),
                            };
                            self.events[n].value = value2;
                            self.events[n].has_default_cancelled_value = true;
                        }
                    }
                    _ => {}
                }
            }
        }
        (value2, time2, next_kind)
    }
}

/// `ClampTo`, with NaN to the lower bound as `std::clamp` would not.
trait ClampNan {
    fn clamp_nan(self, lo: f32, hi: f32) -> f32;
}

impl ClampNan for f32 {
    #[inline]
    fn clamp_nan(self, lo: f32, hi: f32) -> f32 {
        // vector_math::Vclip: max(lo, min(x, hi)) on NEON.
        let v = if self < hi { self } else { hi };
        if v > lo { v } else { lo }
    }
}
