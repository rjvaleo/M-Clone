//! A Web Audio graph, rendered as Chromium renders one: a quantum at a time,
//! each node pulled once per quantum from what reads it, its input the sum
//! of its sources in the order they were connected (silent ones skipped), its
//! output silent once its inputs have been silent for longer than its tail.
//!
//! Nodes, their parameters and their connections live in pools sized when the
//! graph is made, so nodes can be made and freed while it plays without
//! allocating. A node is freed by its owner once it is silent for good.
//!
//! The nodes are Chromium's handlers, each ported on the path a Mac takes:
//! `GainHandler`, `OscillatorHandler` (with `oscillator_kernel_neon.cc`),
//! `BiquadFilterHandler` with `Biquad` (and Accelerate's `vDSP_deq22D`),
//! `StereoPannerHandler`, `ConstantSourceHandler` and
//! `AudioBufferSourceHandler`.

use super::apple::{deq22d, exp2f};
use super::fdlibm;
use super::param::{Clock, Param, Rate};
use super::wave::{Shape, Wave};
use super::QUANTUM;

const Q: usize = QUANTUM;
const NONE: u32 = u32::MAX;
const MAX_PARAMS: usize = 4;
/// `kMaxTailTime` of a biquad.
const MAX_TAIL_TIME: f64 = 30.0;

/// A node in a [`Graph`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct NodeId(pub u32);

/// A periodic wave the graph holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WaveId(pub u32);

/// An audio buffer the graph holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BufferId(pub u32);

/// A filter type.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FilterType {
    Lowpass,
    Highpass,
    Bandpass,
}

/// The parameters of each node, by number.
pub mod params {
    pub const GAIN: u8 = 0;
    pub const FREQUENCY: u8 = 0;
    pub const DETUNE_OSC: u8 = 1;
    pub const Q: u8 = 1;
    pub const FILTER_GAIN: u8 = 2;
    pub const DETUNE_FILTER: u8 = 3;
    pub const PAN: u8 = 0;
    pub const OFFSET: u8 = 0;
    pub const DELAY_TIME: u8 = 0;
    pub const PLAYBACK_RATE: u8 = 0;
    pub const DETUNE_BUFFER: u8 = 1;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    Max,
    ClampedMax,
    Explicit,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Play {
    Unscheduled,
    Scheduled,
    Playing,
    Finished,
}

/// `AudioScheduledSourceHandler`'s timing.
#[derive(Clone, Copy, Debug)]
struct Schedule {
    state: Play,
    start: f64,
    end: Option<f64>,
}

impl Schedule {
    const fn new() -> Self {
        Self { state: Play::Unscheduled, start: 0.0, end: None }
    }
}

/// One channel of a biquad (`Biquad`).
#[derive(Clone, Copy, Debug, Default)]
struct BiquadChannel {
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
}

#[derive(Clone, Debug)]
struct BiquadState {
    kind: FilterType,
    ch: [BiquadChannel; 2],
    b0: [f64; Q],
    b1: [f64; Q],
    b2: [f64; Q],
    a1: [f64; Q],
    a2: [f64; Q],
    sample_accurate: bool,
    just_reset: bool,
    previous: [f32; 4],
    tail_time: f64,
}

impl BiquadState {
    fn new(kind: FilterType) -> Self {
        BiquadState {
            kind,
            ch: [BiquadChannel::default(); 2],
            b0: [1.0; Q],
            b1: [0.0; Q],
            b2: [0.0; Q],
            a1: [0.0; Q],
            a2: [0.0; Q],
            sample_accurate: false,
            just_reset: true,
            previous: [f32::NAN; 4],
            tail_time: f64::INFINITY,
        }
    }
}

#[derive(Clone, Debug)]
enum Kind {
    Free,
    Gain,
    Osc { wave: u32, index: f64, schedule: Schedule },
    Biquad(u32),
    Delay(u32),
    Shaper(u32),
    /// Audio the host hands in, a quantum at a time.
    Input,
    Panner,
    Constant { schedule: Schedule },
    Buffer { buffer: u32, index: f64, schedule: Schedule, looping: bool, loop_start: f64, loop_end: f64 },
}

#[derive(Clone, Copy, Debug)]
struct Junction {
    head: u32,
    tail: u32,
    count: u32,
}

impl Junction {
    const EMPTY: Junction = Junction { head: NONE, tail: NONE, count: 0 };
}

#[derive(Clone, Copy, Debug)]
struct Edge {
    from: u32,
    /// The next edge into the same junction, in the order they were made.
    next: u32,
    to: u32,
    /// 0 for the node's input, k + 1 for its parameter k.
    slot: u8,
    /// For an input: whether the source's output is enabled there (in the
    /// input's `outputs_` rather than its `disabled_outputs_`).
    enabled: bool,
    /// The next edge leaving the same node.
    next_out: u32,
}

#[derive(Clone, Debug)]
struct Node {
    kind: Kind,
    params: [u32; MAX_PARAMS],
    input: Junction,
    param_inputs: [Junction; MAX_PARAMS],
    /// How many connections leave it.
    fan_out: u32,
    stamp: u64,
    last_non_silent: f64,
    mode: Mode,
    channel_count: usize,
    /// The channels its input has, as its connections make it.
    in_channels: usize,
    /// `connection_ref_count_`: connections into its input, and one while a
    /// source is playing.
    conn_count: i32,
    /// `is_disabled_`, and whether its output is enabled.
    disabled: bool,
    out_enabled: bool,
    /// In the tail-processing list.
    in_tail: bool,
    /// Its first outgoing edge.
    out_head: u32,
}

/// A bus: up to two channels of one quantum, each silent or not.
#[derive(Clone, Copy, Debug)]
pub struct Bus {
    pub data: [[f32; Q]; 2],
    pub channels: usize,
    pub silent: [bool; 2],
}

impl Bus {
    const EMPTY: Bus = Bus { data: [[0.0; Q]; 2], channels: 1, silent: [true; 2] };

    pub fn is_silent(&self) -> bool {
        self.silent[..self.channels].iter().all(|s| *s)
    }

    fn zero(&mut self) {
        for c in 0..self.channels {
            self.data[c] = [0.0; Q];
            self.silent[c] = true;
        }
    }

    fn clear_silent(&mut self) {
        self.silent = [false; 2];
    }

    /// `AudioChannel::SumFrom` of channel `from_c` of `from` into channel `c`.
    fn sum_channel(&mut self, c: usize, from: &Bus, from_c: usize) {
        if from.silent[from_c] {
            return;
        }
        if self.silent[c] {
            self.data[c] = from.data[from_c];
            self.silent[c] = false;
        } else {
            for k in 0..Q {
                self.data[c][k] += from.data[from_c][k];
            }
        }
    }

    /// `AudioBus::SumFrom`, speakers interpretation, for one and two channels.
    fn sum_from(&mut self, from: &Bus) {
        if from.channels == self.channels {
            for c in 0..self.channels {
                self.sum_channel(c, from, c);
            }
        } else if from.channels == 1 {
            self.sum_channel(0, from, 0);
            self.sum_channel(1, from, 0);
        } else {
            // Down-mixing, 2 -> 1: Vsma twice, which leaves the flag as it was.
            for k in 0..Q {
                self.data[0][k] += 0.5 * from.data[0][k];
            }
            for k in 0..Q {
                self.data[0][k] += 0.5 * from.data[1][k];
            }
        }
    }
}

/// An `AudioBuffer`: its channels and rate.
#[derive(Clone, Debug)]
pub struct Buffer {
    pub channels: Vec<Vec<f32>>,
    pub sample_rate: f32,
}

/// A Web Audio graph.
pub struct Graph {
    sample_rate: f32,
    frame: u64,
    nodes: Vec<Node>,
    buses: Vec<Bus>,
    free_nodes: Vec<u32>,
    params: Vec<Param>,
    free_params: Vec<u32>,
    edges: Vec<Edge>,
    free_edges: Vec<u32>,
    waves: Vec<Wave>,
    buffers: Vec<Buffer>,
    // Scratch for one node at a time.
    input: Bus,
    values: [[f32; Q]; MAX_PARAMS],
    sum: Bus,
    phase: [f32; Q],
    detune: [f32; Q],
    /// `tail_processing_handlers_`, and those whose tail is over, to be
    /// disabled (on the main thread, in Chromium).
    tail_list: Vec<u32>,
    tail_done: Vec<u32>,
    /// Sources that finished in this quantum (`finished_source_handlers_`).
    finished_srcs: Vec<u32>,
    work: Vec<u32>,
    delays: Vec<DelayState>,
    shapers: Vec<ShaperState>,
    /// What the host hands an input node, per input node.
    inputs: Vec<Bus>,
    /// Biquad kernels, one per biquad node, from a pool.
    biquads: Vec<BiquadState>,
    free_biquads: Vec<u32>,
}

impl Graph {
    /// A graph for `nodes` nodes and `edges` connections, with the four
    /// built-in waves as waves 0 to 3 (sine, square, sawtooth, triangle).
    pub fn new(sample_rate: f32, nodes: usize, edges: usize) -> Self {
        let blank = Node {
            kind: Kind::Free,
            params: [NONE; MAX_PARAMS],
            input: Junction::EMPTY,
            param_inputs: [Junction::EMPTY; MAX_PARAMS],
            fan_out: 0,
            stamp: 0,
            last_non_silent: 0.0,
            mode: Mode::Max,
            channel_count: 2,
            in_channels: 1,
            conn_count: 0,
            disabled: false,
            out_enabled: true,
            in_tail: false,
            out_head: NONE,
        };
        let params = nodes * 2;
        let mut g = Graph {
            sample_rate,
            frame: 0,
            nodes: vec![blank; nodes],
            buses: vec![Bus::EMPTY; nodes],
            free_nodes: (0..nodes as u32).rev().collect(),
            params: vec![Param::new(0.0, 0.0, 0.0, Rate::Audio); params],
            free_params: (0..params as u32).rev().collect(),
            edges: vec![Edge { from: NONE, next: NONE, to: NONE, slot: 0, enabled: true, next_out: NONE }; edges],
            free_edges: (0..edges as u32).rev().collect(),
            waves: Vec::new(),
            buffers: Vec::new(),
            input: Bus::EMPTY,
            values: [[0.0; Q]; MAX_PARAMS],
            sum: Bus::EMPTY,
            phase: [0.0; Q],
            detune: [0.0; Q],
            biquads: Vec::new(),
            free_biquads: Vec::new(),
            delays: Vec::new(),
            shapers: Vec::new(),
            inputs: Vec::new(),
            tail_list: Vec::with_capacity(nodes),
            tail_done: Vec::with_capacity(nodes),
            finished_srcs: Vec::with_capacity(nodes),
            work: Vec::with_capacity(nodes),
        };
        for shape in [Shape::Sine, Shape::Square, Shape::Sawtooth, Shape::Triangle] {
            g.waves.push(Wave::basic(shape, sample_rate));
        }
        let filters = (nodes / 4).max(1);
        g.biquads = vec![BiquadState::new(FilterType::Lowpass); filters];
        g.free_biquads = (0..filters as u32).rev().collect();
        g
    }

    pub fn sample_rate(&self) -> f32 {
        self.sample_rate
    }

    /// The context's clock: the first frame of the next quantum.
    pub fn now(&self) -> Clock {
        Clock { frame: self.frame, sample_rate: self.sample_rate as f64 }
    }

    /// `currentTime`.
    pub fn current_time(&self) -> f64 {
        self.frame as f64 / self.sample_rate as f64
    }

    /// Hold a wave (made off the audio thread). Allocates.
    pub fn add_wave(&mut self, wave: Wave) -> WaveId {
        self.waves.push(wave);
        WaveId(self.waves.len() as u32 - 1)
    }

    /// Replace a wave the graph holds. No allocation beyond the wave's own.
    pub fn set_wave(&mut self, id: WaveId, wave: Wave) {
        self.waves[id.0 as usize] = wave;
    }

    /// New coefficients for a lazy wave the graph holds ([`Wave::lazy`]).
    /// No allocation.
    pub fn set_custom_wave(&mut self, id: WaveId, real: &[f32], imag: &[f32]) {
        self.waves[id.0 as usize].set_custom(real, imag);
    }

    /// Hold a buffer (made off the audio thread). Allocates.
    pub fn add_buffer(&mut self, buffer: Buffer) -> BufferId {
        self.buffers.push(buffer);
        BufferId(self.buffers.len() as u32 - 1)
    }

    /// How many more nodes can be made.
    pub fn nodes_free(&self) -> usize {
        self.free_nodes.len()
    }

    // ── Making nodes ────────────────────────────────────────────────────────

    fn make(&mut self, kind: Kind, params: &[(f32, f32, f32, Rate)], mode: Mode, channel_count: usize) -> Option<NodeId> {
        if self.free_params.len() < params.len() {
            return None;
        }
        let i = self.free_nodes.pop()?;
        let node = &mut self.nodes[i as usize];
        node.kind = kind;
        node.params = [NONE; MAX_PARAMS];
        for (k, (default, min, max, rate)) in params.iter().enumerate() {
            let p = self.free_params.pop().unwrap_or(NONE);
            self.params[p as usize] = Param::new(*default, *min, *max, *rate);
            node.params[k] = p;
        }
        node.input = Junction::EMPTY;
        node.param_inputs = [Junction::EMPTY; MAX_PARAMS];
        node.fan_out = 0;
        node.stamp = 0;
        node.last_non_silent = 0.0;
        node.mode = mode;
        node.channel_count = channel_count;
        node.in_channels = 1;
        node.conn_count = 0;
        node.disabled = false;
        node.out_enabled = true;
        node.in_tail = false;
        node.out_head = NONE;
        let channels = self.out_channels_of(i as usize);
        let bus = &mut self.buses[i as usize];
        bus.channels = channels;
        bus.zero();
        Some(NodeId(i))
    }

    pub fn gain(&mut self) -> Option<NodeId> {
        self.make(Kind::Gain, &[(1.0, -f32::MAX, f32::MAX, Rate::Audio)], Mode::Max, 2)
    }

    pub fn oscillator(&mut self, wave: WaveId) -> Option<NodeId> {
        let nyquist = self.sample_rate / 2.0;
        let detune_max = 1200.0 * (f32::MAX.log2());
        self.make(
            Kind::Osc { wave: wave.0, index: 0.0, schedule: Schedule::new() },
            &[(440.0, -nyquist, nyquist, Rate::Audio), (0.0, -detune_max, detune_max, Rate::Audio)],
            Mode::Max,
            2,
        )
    }

    pub fn biquad(&mut self, kind: FilterType) -> Option<NodeId> {
        let nyquist = self.sample_rate / 2.0;
        let detune_max = 1200.0 * (f32::MAX.log2());
        let b = *self.free_biquads.last()?;
        let node = self.make(
            Kind::Biquad(b),
            &[
                (350.0, 0.0, nyquist, Rate::Audio),
                (1.0, -f32::MAX, f32::MAX, Rate::Audio),
                (0.0, -f32::MAX, 40.0 * f32::MAX.log10(), Rate::Audio),
                (0.0, -detune_max, detune_max, Rate::Audio),
            ],
            Mode::Max,
            2,
        )?;
        self.free_biquads.pop();
        self.biquads[b as usize] = BiquadState::new(kind);
        Some(node)
    }

    pub fn panner(&mut self) -> Option<NodeId> {
        self.make(Kind::Panner, &[(0.0, -1.0, 1.0, Rate::Audio)], Mode::ClampedMax, 2)
    }

    pub fn constant(&mut self) -> Option<NodeId> {
        self.make(Kind::Constant { schedule: Schedule::new() }, &[(1.0, -f32::MAX, f32::MAX, Rate::Audio)], Mode::Max, 2)
    }

    pub fn buffer_source(&mut self, buffer: BufferId) -> Option<NodeId> {
        self.make(
            Kind::Buffer { buffer: buffer.0, index: 0.0, schedule: Schedule::new(), looping: false, loop_start: 0.0, loop_end: 0.0 },
            &[(1.0, -f32::MAX, f32::MAX, Rate::Control), (0.0, -f32::MAX, f32::MAX, Rate::Control)],
            Mode::Max,
            2,
        )
    }

    /// A gain with its channels fixed (`channelCountMode = 'explicit'`).
    pub fn explicit_gain(&mut self, channels: usize) -> Option<NodeId> {
        self.make(Kind::Gain, &[(1.0, -f32::MAX, f32::MAX, Rate::Audio)], Mode::Explicit, channels.clamp(1, 2))
    }

    /// `createDelay(max_delay_time)`. Allocates its buffers: make delays off
    /// the audio thread.
    pub fn delay(&mut self, max_delay_time: f64) -> Option<NodeId> {
        let d = self.delays.len() as u32;
        let node = self.make(Kind::Delay(d), &[(0.0, 0.0, max_delay_time as f32, Rate::Audio)], Mode::Max, 2)?;
        self.delays.push(DelayState::new(max_delay_time, self.sample_rate));
        Some(node)
    }

    /// `createWaveShaper()` with its curve and oversampling (0 for none, 2
    /// for 2x). Allocates: make shapers off the audio thread.
    pub fn wave_shaper(&mut self, curve: &[f32], oversample: u8) -> Option<NodeId> {
        let w = self.shapers.len() as u32;
        let node = self.make(Kind::Shaper(w), &[], Mode::Max, 2)?;
        let mut st = ShaperState::new(oversample, self.sample_rate);
        st.set_curve(curve);
        self.shapers.push(st);
        Some(node)
    }

    /// A shaper's curve (`shaper.curve = …`). No allocation if no longer
    /// than the curve it was made with.
    pub fn set_curve(&mut self, node: NodeId, curve: &[f32]) {
        if let Kind::Shaper(w) = self.nodes[node.0 as usize].kind {
            self.shapers[w as usize].set_curve(curve);
        }
    }

    /// A node the host feeds two channels of audio into, a quantum at a time
    /// ([`Graph::set_input`]). Allocates: make it off the audio thread.
    pub fn input(&mut self) -> Option<NodeId> {
        let k = self.inputs.len() as u32;
        let node = self.make(Kind::Input, &[], Mode::Explicit, 2)?;
        self.nodes[node.0 as usize].params[0] = k;
        let mut b = Bus::EMPTY;
        b.channels = 2;
        self.inputs.push(b);
        Some(node)
    }

    /// The next quantum an input node gives, or silence (`None`).
    pub fn set_input(&mut self, node: NodeId, audio: Option<(&[f32], &[f32])>) {
        if let Kind::Input = self.nodes[node.0 as usize].kind {
            let k = self.nodes[node.0 as usize].params[0] as usize;
            let b = &mut self.inputs[k];
            match audio {
                Some((l, r)) => {
                    let n = l.len().min(r.len()).min(Q);
                    b.data[0][..n].copy_from_slice(&l[..n]);
                    b.data[1][..n].copy_from_slice(&r[..n]);
                    b.data[0][n..].iter_mut().for_each(|v| *v = 0.0);
                    b.data[1][n..].iter_mut().for_each(|v| *v = 0.0);
                    b.silent = [false; 2];
                }
                None => b.zero(),
            }
        }
    }

    /// `loop`, `loopStart` and `loopEnd` of a buffer source.
    pub fn set_loop(&mut self, node: NodeId, looping: bool, loop_start: f64, loop_end: f64) {
        if let Kind::Buffer { looping: l, loop_start: s, loop_end: e, .. } = &mut self.nodes[node.0 as usize].kind {
            *l = looping;
            *s = loop_start;
            *e = loop_end;
        }
    }

    fn schedule(&mut self, node: NodeId) -> Option<&mut Schedule> {
        match &mut self.nodes[node.0 as usize].kind {
            Kind::Osc { schedule, .. } | Kind::Constant { schedule } | Kind::Buffer { schedule, .. } => Some(schedule),
            _ => None,
        }
    }

    /// `start(when)`.
    pub fn start(&mut self, node: NodeId, when: f64) {
        let now = self.current_time();
        let mut started = false;
        if let Some(s) = self.schedule(node) {
            if s.state == Play::Unscheduled && when >= 0.0 {
                s.start = when.max(now);
                s.state = Play::Scheduled;
                started = true;
            }
        }
        if started {
            // NotifySourceNodeStartedProcessing: the source holds a connection.
            self.make_connection(node.0 as usize);
        }
    }

    /// `stop(when)`.
    pub fn stop(&mut self, node: NodeId, when: f64) {
        let now = self.current_time();
        if let Some(s) = self.schedule(node) {
            if s.state != Play::Unscheduled && s.state != Play::Finished && when >= 0.0 {
                s.end = Some(when.max(now));
            }
        }
    }

    /// Whether a source has played to its end (`HasFinished`).
    pub fn finished(&self, node: NodeId) -> bool {
        match &self.nodes[node.0 as usize].kind {
            Kind::Osc { schedule, .. } | Kind::Constant { schedule } | Kind::Buffer { schedule, .. } => schedule.state == Play::Finished,
            _ => false,
        }
    }

    /// Whether a node's output was silent in the last quantum.
    pub fn silent(&self, node: NodeId) -> bool {
        self.buses[node.0 as usize].is_silent()
    }

    /// A node's parameter, to automate.
    pub fn param(&mut self, node: NodeId, k: u8) -> &mut Param {
        let p = self.nodes[node.0 as usize].params[k as usize];
        &mut self.params[p as usize]
    }

    /// `param.value = v`.
    pub fn set(&mut self, node: NodeId, k: u8, v: f32) {
        let now = self.now();
        self.param(node, k).set_value(v, now);
    }

    pub fn set_value_at_time(&mut self, node: NodeId, k: u8, v: f32, t: f64) {
        let now = self.now();
        self.param(node, k).set_value_at_time(v, t, now);
    }

    pub fn set_target_at_time(&mut self, node: NodeId, k: u8, v: f32, t: f64, tc: f64) {
        let now = self.now();
        self.param(node, k).set_target_at_time(v, t, tc, now);
    }

    pub fn linear_ramp_to_value_at_time(&mut self, node: NodeId, k: u8, v: f32, t: f64) {
        let now = self.now();
        self.param(node, k).linear_ramp_to_value_at_time(v, t, now);
    }

    pub fn exponential_ramp_to_value_at_time(&mut self, node: NodeId, k: u8, v: f32, t: f64) {
        let now = self.now();
        self.param(node, k).exponential_ramp_to_value_at_time(v, t, now);
    }

    pub fn cancel_scheduled_values(&mut self, node: NodeId, k: u8, t: f64) {
        let now = self.now();
        self.param(node, k).cancel_scheduled_values(t, now);
    }

    pub fn cancel_and_hold_at_time(&mut self, node: NodeId, k: u8, t: f64) {
        let now = self.now();
        self.param(node, k).cancel_and_hold_at_time(t, now);
    }

    // ── Connections ─────────────────────────────────────────────────────────

    fn link(&mut self, from: NodeId, to: NodeId, slot: u8) -> bool {
        if from.0 as usize >= self.nodes.len() || to.0 as usize >= self.nodes.len() {
            return false;
        }
        // Already joined: Web Audio ignores the second connect.
        {
            let j = if slot == 0 { self.nodes[to.0 as usize].input } else { self.nodes[to.0 as usize].param_inputs[slot as usize - 1] };
            let mut e = j.head;
            while e != NONE {
                if self.edges[e as usize].from == from.0 {
                    return true;
                }
                e = self.edges[e as usize].next;
            }
        }
        let Some(e) = self.free_edges.pop() else { return false };
        let enabled = slot != 0 || self.nodes[from.0 as usize].out_enabled;
        let out_head = self.nodes[from.0 as usize].out_head;
        self.edges[e as usize] = Edge { from: from.0, next: NONE, to: to.0, slot, enabled, next_out: out_head };
        self.nodes[from.0 as usize].out_head = e;
        let node = &mut self.nodes[to.0 as usize];
        let j = if slot == 0 { &mut node.input } else { &mut node.param_inputs[slot as usize - 1] };
        if j.tail == NONE {
            j.head = e;
        } else {
            self.edges[j.tail as usize].next = e;
        }
        j.tail = e;
        j.count += 1;
        self.nodes[from.0 as usize].fan_out += 1;
        if slot == 0 {
            if enabled {
                self.update_channels(to.0 as usize);
            }
            self.make_connection(to.0 as usize);
        }
        true
    }

    /// `from.connect(to)`.
    pub fn connect(&mut self, from: NodeId, to: NodeId) -> bool {
        self.link(from, to, 0)
    }

    /// `from.connect(to.param)`.
    pub fn connect_param(&mut self, from: NodeId, to: NodeId, k: u8) -> bool {
        self.link(from, to, k + 1)
    }

    /// `from.disconnect(to.param)` (or `to`'s input, for `k = None`).
    pub fn disconnect(&mut self, from: NodeId, to: NodeId, k: Option<u8>) {
        let slot = k.map(|k| k + 1).unwrap_or(0);
        self.unlink(from, to, slot, true);
    }

    /// Take one edge out of its junction and its source's outgoing list. With
    /// `live`, as `AudioNodeWiring::Disconnect` does (the target's count and
    /// channels follow); without, as a collected node leaves no trace.
    fn unlink(&mut self, from: NodeId, to: NodeId, slot: u8, live: bool) {
        let node = &mut self.nodes[to.0 as usize];
        let j = if slot == 0 { &mut node.input } else { &mut node.param_inputs[slot as usize - 1] };
        let mut prev = NONE;
        let mut e = j.head;
        let mut removed = None;
        while e != NONE {
            let next = self.edges[e as usize].next;
            if self.edges[e as usize].from == from.0 {
                if prev == NONE {
                    j.head = next;
                } else {
                    self.edges[prev as usize].next = next;
                }
                if j.tail == e {
                    j.tail = prev;
                }
                j.count -= 1;
                removed = Some(e);
                break;
            }
            prev = e;
            e = next;
        }
        let Some(e) = removed else { return };
        // Out of the source's outgoing list.
        let f = from.0 as usize;
        let mut o = self.nodes[f].out_head;
        let mut po = NONE;
        while o != NONE {
            if o == e {
                let n = self.edges[o as usize].next_out;
                if po == NONE {
                    self.nodes[f].out_head = n;
                } else {
                    self.edges[po as usize].next_out = n;
                }
                break;
            }
            po = o;
            o = self.edges[o as usize].next_out;
        }
        let was_enabled = self.edges[e as usize].enabled;
        self.free_edges.push(e);
        self.nodes[f].fan_out -= 1;
        if slot == 0 && live {
            if was_enabled {
                self.update_channels(to.0 as usize);
            }
            self.break_connection(to.0 as usize);
        }
    }

    /// Free a node: every connection to and from it goes, and its slot is
    /// ready for another.
    pub fn free(&mut self, node: NodeId) {
        self.free_with(node, true);
    }

    /// Free a node as a finished one leaves Chromium's graph when it is
    /// collected: what it fed keeps its counts and channels.
    pub fn free_quiet(&mut self, node: NodeId) {
        self.free_with(node, false);
    }

    fn free_with(&mut self, node: NodeId, live: bool) {
        let i = node.0 as usize;
        if matches!(self.nodes[i].kind, Kind::Free) {
            return;
        }
        // Its own inputs.
        for slot in 0..=MAX_PARAMS as u8 {
            loop {
                let j = if slot == 0 { self.nodes[i].input } else { self.nodes[i].param_inputs[slot as usize - 1] };
                if j.head == NONE {
                    break;
                }
                let from = self.edges[j.head as usize].from;
                self.unlink(NodeId(from), node, slot, false);
            }
        }
        // What it feeds.
        while self.nodes[i].out_head != NONE {
            let e = self.nodes[i].out_head;
            let (to, slot) = (self.edges[e as usize].to, self.edges[e as usize].slot);
            self.unlink(node, NodeId(to), slot, live);
        }
        for p in self.nodes[i].params {
            if p != NONE {
                self.free_params.push(p);
            }
        }
        self.nodes[i].params = [NONE; MAX_PARAMS];
        if let Kind::Biquad(b) = self.nodes[i].kind {
            self.free_biquads.push(b);
        }
        if let Kind::Input = self.nodes[i].kind {
            // Its slot in `inputs` is kept: an input node is made once.
            self.nodes[i].params = [NONE; MAX_PARAMS];
        }
        self.tail_list.retain(|&t| t as usize != i);
        self.tail_done.retain(|&t| t as usize != i);
        self.finished_srcs.retain(|&t| t as usize != i);
        self.nodes[i].in_tail = false;
        self.nodes[i].kind = Kind::Free;
        self.free_nodes.push(node.0);
    }

    // ── A node's life (audio_handler.cc, deferred_task_handler.cc) ──────────

    fn requires_tail(&self, i: usize) -> bool {
        matches!(self.nodes[i].kind, Kind::Biquad(_) | Kind::Delay(_) | Kind::Shaper(_))
    }

    /// `TailTime() + LatencyTime()`.
    fn tail_and_latency(&self, i: usize) -> f64 {
        match self.nodes[i].kind {
            Kind::Biquad(b) => self.biquads[b as usize].tail_time,
            Kind::Delay(d) => self.delays[d as usize].max_time,
            Kind::Shaper(w) => self.shapers[w as usize].tail_time + self.shapers[w as usize].latency,
            _ => 0.0,
        }
    }

    /// `MakeConnection`.
    fn make_connection(&mut self, i: usize) {
        self.nodes[i].conn_count += 1;
        // EnableOutputsIfNecessary.
        self.remove_tail(i, false);
        if self.nodes[i].disabled && self.nodes[i].conn_count > 0 {
            self.enable_outputs(i);
        }
    }

    /// `BreakConnectionWithLock`.
    fn break_connection(&mut self, i: usize) {
        self.nodes[i].conn_count -= 1;
        if self.nodes[i].conn_count == 0 {
            self.disable_outputs_if_necessary(i);
        }
    }

    /// `DisableOutputsIfNecessary`.
    fn disable_outputs_if_necessary(&mut self, i: usize) {
        if self.nodes[i].conn_count <= 1 && !self.nodes[i].disabled {
            if self.requires_tail(i) {
                self.add_tail(i);
            } else {
                self.disable_outputs(i);
            }
        }
    }

    fn add_tail(&mut self, i: usize) {
        if !self.nodes[i].in_tail {
            self.nodes[i].in_tail = true;
            self.tail_list.push(i as u32);
        }
    }

    /// `RemoveTailProcessingHandler`.
    fn remove_tail(&mut self, i: usize, disable_outputs: bool) {
        if self.nodes[i].in_tail {
            self.nodes[i].in_tail = false;
            if let Some(k) = self.tail_list.iter().position(|&t| t as usize == i) {
                self.tail_list.remove(k);
            }
            if disable_outputs {
                self.tail_done.push(i as u32);
            }
            return;
        }
        if let Some(k) = self.tail_done.iter().position(|&t| t as usize == i) {
            self.tail_done.remove(k);
        }
    }

    /// The node's output disabled at every input it feeds (`DisableAndEnqueue`):
    /// the targets whose input changed, onto the work list.
    fn disable_and_enqueue(&mut self, i: usize) {
        if !self.nodes[i].out_enabled {
            return;
        }
        self.nodes[i].out_enabled = false;
        let mut e = self.nodes[i].out_head;
        while e != NONE {
            let edge = self.edges[e as usize];
            if edge.slot == 0 && edge.enabled {
                self.edges[e as usize].enabled = false;
                self.update_channels(edge.to as usize);
                self.work.push(edge.to);
            }
            e = edge.next_out;
        }
    }

    fn enable_and_enqueue(&mut self, i: usize) {
        if self.nodes[i].out_enabled {
            return;
        }
        self.nodes[i].out_enabled = true;
        let mut e = self.nodes[i].out_head;
        while e != NONE {
            let edge = self.edges[e as usize];
            if edge.slot == 0 && !edge.enabled {
                self.edges[e as usize].enabled = true;
                self.update_channels(edge.to as usize);
                self.work.push(edge.to);
            }
            e = edge.next_out;
        }
    }

    /// `DisableOutputs`.
    fn disable_outputs(&mut self, i: usize) {
        self.work.clear();
        self.nodes[i].disabled = true;
        self.disable_and_enqueue(i);
        while let Some(h) = self.work.pop() {
            let h = h as usize;
            if !self.nodes[h].disabled && self.nodes[h].conn_count <= 1 {
                if self.requires_tail(h) {
                    self.add_tail(h);
                } else {
                    self.nodes[h].disabled = true;
                    self.disable_and_enqueue(h);
                }
            }
        }
    }

    /// `EnableOutputs`.
    fn enable_outputs(&mut self, i: usize) {
        self.work.clear();
        self.nodes[i].disabled = false;
        self.enable_and_enqueue(i);
        while let Some(h) = self.work.pop() {
            let h = h as usize;
            self.remove_tail(h, false);
            if self.nodes[h].disabled && self.nodes[h].conn_count > 0 {
                self.nodes[h].disabled = false;
                self.enable_and_enqueue(h);
            }
        }
    }

    /// `UpdateTailProcessingHandlers`, at `now`.
    fn update_tail_handlers(&mut self) {
        let mut k = self.tail_list.len();
        while k > 0 {
            k -= 1;
            let h = self.tail_list[k] as usize;
            if self.propagates_silence(h) {
                self.remove_tail(h, true);
            }
        }
    }

    /// `DisableOutputsForTailProcessing`: what the main thread does with the
    /// nodes whose tails are over.
    fn finish_tails(&mut self) {
        while let Some(h) = self.tail_done.pop() {
            if !matches!(self.nodes[h as usize].kind, Kind::Free) {
                self.disable_outputs(h as usize);
            }
        }
    }

    /// `BreakConnections`: each source that finished lets go of its own
    /// connection.
    fn break_finished_sources(&mut self) {
        while let Some(s) = self.finished_srcs.pop() {
            self.break_connection(s as usize);
        }
    }

    /// The channels a node's output has.
    fn out_channels_of(&self, i: usize) -> usize {
        let n = &self.nodes[i];
        match n.kind {
            Kind::Osc { .. } | Kind::Constant { .. } => 1,
            Kind::Buffer { buffer, .. } => self.buffers.get(buffer as usize).map(|b| b.channels.len().clamp(1, 2)).unwrap_or(1),
            Kind::Panner => 2,
            Kind::Input => 2,
            _ => n.in_channels,
        }
    }

    /// `AudioNodeInput::NumberOfChannels` (over its enabled connections) for
    /// `i`, and its output's channels after it, passed on to what it feeds
    /// when they change (`CheckNumberOfChannelsForInput`).
    fn update_channels(&mut self, i: usize) {
        let mut max = 1;
        let mut e = self.nodes[i].input.head;
        while e != NONE {
            let edge = self.edges[e as usize];
            if edge.enabled {
                max = max.max(self.buses[edge.from as usize].channels);
            }
            e = edge.next;
        }
        let n = &self.nodes[i];
        let ch = match n.mode {
            Mode::Max => max,
            Mode::ClampedMax => max.min(n.channel_count),
            Mode::Explicit => n.channel_count,
        };
        let old_out = self.buses[i].channels;
        self.nodes[i].in_channels = ch;
        let out = self.out_channels_of(i);
        if out != old_out {
            // Re-initialised with the new channel count: fresh kernels.
            match self.nodes[i].kind {
                Kind::Biquad(b) => {
                    let b = &mut self.biquads[b as usize];
                    b.ch = [BiquadChannel::default(); 2];
                    b.just_reset = true;
                }
                Kind::Delay(d) => self.delays[d as usize].reset(),
                Kind::Shaper(w) => self.shapers[w as usize].reset(),
                _ => {}
            }
            self.buses[i].channels = out;
            self.buses[i].zero();
            // Whatever reads this node.
            let mut e = self.nodes[i].out_head;
            while e != NONE {
                let edge = self.edges[e as usize];
                if edge.slot == 0 {
                    self.update_channels(edge.to as usize);
                }
                e = edge.next_out;
            }
        }
    }

    // ── Rendering ───────────────────────────────────────────────────────────

    /// Render one quantum, pulled from `outputs` in order, and move the clock
    /// on. Read each output's bus with [`Graph::bus`].
    pub fn render(&mut self, outputs: &[NodeId]) {
        // HandlePreRenderTasks (and what the main thread did meanwhile).
        self.finish_tails();
        self.update_tail_handlers();
        for o in outputs {
            self.pull(o.0 as usize);
        }
        // HandlePostRenderTasks, before the clock moves on.
        self.break_finished_sources();
        self.update_tail_handlers();
        self.frame += Q as u64;
    }

    /// `PropagatesSilence` at the current time.
    fn propagates_silence(&self, i: usize) -> bool {
        match &self.nodes[i].kind {
            Kind::Osc { schedule, .. } | Kind::Constant { schedule } => matches!(schedule.state, Play::Unscheduled | Play::Finished),
            Kind::Buffer { schedule, .. } => !matches!(schedule.state, Play::Scheduled | Play::Playing),
            Kind::Input => false,
            _ => self.nodes[i].last_non_silent + self.tail_and_latency(i) < self.current_time(),
        }
    }

    /// A node's output from the last quantum rendered.
    pub fn bus(&self, node: NodeId) -> &Bus {
        &self.buses[node.0 as usize]
    }

    /// Process `root` and everything it reads, once each this quantum:
    /// depth first, every source before the node that reads it.
    fn pull(&mut self, root: usize) {
        let stamp = self.frame + 1;
        self.visit(root, stamp);
    }

    fn visit(&mut self, i: usize, stamp: u64) {
        if self.nodes[i].stamp == stamp {
            return;
        }
        self.nodes[i].stamp = stamp;
        for slot in 0..=MAX_PARAMS {
            let j = if slot == 0 { self.nodes[i].input } else { self.nodes[i].param_inputs[slot - 1] };
            let mut e = j.head;
            while e != NONE {
                let edge = self.edges[e as usize];
                if edge.enabled {
                    self.visit(edge.from as usize, stamp);
                }
                e = edge.next;
            }
        }
        self.process_if_necessary(i);
    }

    /// `AudioHandler::ProcessIfNecessary`, once its sources are processed.
    fn process_if_necessary(&mut self, i: usize) {
        let now = self.now();
        let current_time = now.time();
        // Its input: the sum of its sources.
        let _ = current_time;
        let mut input_connected = false;
        self.input.channels = self.nodes[i].in_channels;
        self.input.zero();
        let mut e = self.nodes[i].input.head;
        while e != NONE {
            let edge = self.edges[e as usize];
            if edge.enabled {
                input_connected = true;
                let src = self.buses[edge.from as usize];
                self.input.sum_from(&src);
            }
            e = edge.next;
        }
        let has_inputs = !matches!(self.nodes[i].kind, Kind::Osc { .. } | Kind::Constant { .. } | Kind::Buffer { .. } | Kind::Input);
        let silent_inputs = !has_inputs || self.input.is_silent();
        let was_finished = self.finished(NodeId(i as u32));
        if silent_inputs && self.propagates_silence(i) {
            if self.nodes[i].fan_out > 0 {
                self.buses[i].zero();
            }
            self.process_only_params(i);
        } else {
            self.buses[i].clear_silent();
            self.process(i, input_connected);
        }
        if !was_finished && self.finished(NodeId(i as u32)) {
            // FinishWithoutOnEnded: let go at the end of this quantum.
            self.finished_srcs.push(i as u32);
        }
        if has_inputs && !silent_inputs {
            self.nodes[i].last_non_silent = (now.frame + Q as u64) as f64 / now.sample_rate;
        }
    }

    /// `CalculateFinalValues` for parameter `k` of node `i` into
    /// `self.values[k]` (all of it, or just the first value at k-rate).
    fn final_values(&mut self, i: usize, k: usize, sample_accurate: bool) {
        let now = self.now();
        let p = self.nodes[i].params[k] as usize;
        let j = self.nodes[i].param_inputs[k];
        let mut values = self.values[k];
        self.params[p].timeline_values(&mut values, sample_accurate, now);
        if j.count > 0 {
            // The connections, summed in their order, then added to the
            // parameter's own value: v + ((a + b) + c).
            let len = if sample_accurate { Q } else { 1 };
            self.sum.channels = 1;
            self.sum.zero();
            let mut e = j.head;
            let mut single = None;
            if j.count == 1 {
                single = Some(self.edges[e as usize].from as usize);
            } else {
                while e != NONE {
                    let from = self.edges[e as usize].from as usize;
                    let src = self.buses[from];
                    self.sum.sum_from(&src);
                    e = self.edges[e as usize].next;
                }
            }
            let src = match single {
                Some(from) => self.buses[from],
                None => self.sum,
            };
            // The summing bus over `values`: one channel, not silent.
            if !src.is_silent() {
                if src.channels == 1 {
                    for n in 0..len {
                        values[n] += src.data[0][n];
                    }
                } else {
                    for n in 0..len {
                        values[n] += 0.5 * src.data[0][n];
                    }
                    for n in 0..len {
                        values[n] += 0.5 * src.data[1][n];
                    }
                }
            }
            if !sample_accurate {
                let v0 = values[0];
                values.iter_mut().for_each(|v| *v = v0);
            }
            self.params[p].finish_connected(&mut values);
        }
        self.values[k] = values;
    }

    fn param_connected(&self, i: usize, k: usize) -> bool {
        self.nodes[i].param_inputs[k].count > 0
    }

    fn has_sa(&self, i: usize, k: usize) -> bool {
        let p = self.nodes[i].params[k] as usize;
        self.params[p].has_sample_accurate_values(self.param_connected(i, k), self.now())
    }

    fn is_audio_rate(&self, i: usize, k: usize) -> bool {
        self.params[self.nodes[i].params[k] as usize].is_audio_rate()
    }

    /// `CalculateSampleAccurateValues`.
    fn sample_accurate_values(&mut self, i: usize, k: usize) {
        let a = self.is_audio_rate(i, k);
        self.final_values(i, k, a);
    }

    /// `FinalValue()`.
    fn final_value(&mut self, i: usize, k: usize) -> f32 {
        self.final_values(i, k, false);
        self.values[k][0]
    }

    /// `Value()` on the audio thread.
    fn value(&mut self, i: usize, k: usize) -> f32 {
        let now = self.now();
        let p = self.nodes[i].params[k] as usize;
        self.params[p].value(now)
    }

    fn process_only_params(&mut self, i: usize) {
        match self.nodes[i].kind {
            Kind::Delay(_) => self.sample_accurate_values(i, 0),
            Kind::Gain | Kind::Panner => self.sample_accurate_values(i, 0),
            Kind::Biquad(_) => {
                for k in 0..4 {
                    self.sample_accurate_values(i, k);
                }
            }
            _ => {}
        }
    }

    fn process(&mut self, i: usize, input_connected: bool) {
        match self.nodes[i].kind {
            Kind::Free => {}
            Kind::Gain => self.process_gain(i, input_connected),
            Kind::Panner => self.process_panner(i, input_connected),
            Kind::Osc { .. } => self.process_osc(i),
            Kind::Biquad(_) => self.process_biquad(i, input_connected),
            Kind::Delay(_) => self.process_delay(i, input_connected),
            Kind::Shaper(_) => self.process_shaper(i, input_connected),
            Kind::Input => {
                let k = self.nodes[i].params[0] as usize;
                self.buses[i] = self.inputs[k];
            }
            Kind::Constant { .. } => self.process_constant(i),
            Kind::Buffer { .. } => self.process_buffer(i),
        }
    }

    fn process_gain(&mut self, i: usize, input_connected: bool) {
        if !input_connected {
            self.buses[i].zero();
            return;
        }
        let sa = self.has_sa(i, 0);
        if sa && self.is_audio_rate(i, 0) {
            self.sample_accurate_values(i, 0);
            let input = &self.input;
            let out = &mut self.buses[i];
            if input.is_silent() {
                out.zero();
                return;
            }
            for c in 0..out.channels {
                let src = if input.channels == out.channels { c } else { 0 };
                for n in 0..Q {
                    out.data[c][n] = input.data[src][n] * self.values[0][n];
                }
            }
            return;
        }
        let gain = if sa { self.final_value(i, 0) } else { self.value(i, 0) };
        let input = &self.input;
        let out = &mut self.buses[i];
        if gain == 0.0 || input.is_silent() {
            out.zero();
            return;
        }
        for c in 0..out.channels {
            if gain == 1.0 {
                out.data[c] = input.data[c];
            } else {
                for n in 0..Q {
                    out.data[c][n] = input.data[c][n] * gain;
                }
            }
        }
    }

    fn process_panner(&mut self, i: usize, input_connected: bool) {
        if !input_connected {
            self.buses[i].zero();
            return;
        }
        let sa = self.has_sa(i, 0);
        const PI_OVER_TWO: f64 = core::f64::consts::FRAC_PI_2;
        let mono = self.input.channels == 1;
        if sa && self.is_audio_rate(i, 0) {
            self.sample_accurate_values(i, 0);
            let input = &self.input;
            let out = &mut self.buses[i];
            for n in 0..Q {
                let pan = (self.values[0][n] as f64).clamp(-1.0, 1.0);
                if mono {
                    let x = input.data[0][n];
                    let radian = (pan * 0.5 + 0.5) * PI_OVER_TWO;
                    let gl = fdlibm::cos(radian);
                    let gr = fdlibm::sin(radian);
                    out.data[0][n] = (x as f64 * gl) as f32;
                    out.data[1][n] = (x as f64 * gr) as f32;
                } else {
                    let (l, r) = (input.data[0][n], input.data[1][n]);
                    let radian = (if pan <= 0.0 { pan + 1.0 } else { pan }) * PI_OVER_TWO;
                    let gl = fdlibm::cos(radian);
                    let gr = fdlibm::sin(radian);
                    if pan <= 0.0 {
                        out.data[0][n] = (l as f64 + r as f64 * gl) as f32;
                        out.data[1][n] = (r as f64 * gr) as f32;
                    } else {
                        out.data[0][n] = (l as f64 * gl) as f32;
                        out.data[1][n] = (r as f64 + l as f64 * gr) as f32;
                    }
                }
            }
            return;
        }
        let pan = if sa { self.final_value(i, 0) } else { self.value(i, 0) };
        let target = pan.clamp(-1.0, 1.0);
        let input = &self.input;
        let out = &mut self.buses[i];
        if mono {
            let radian = (target as f64 * 0.5 + 0.5) * PI_OVER_TWO;
            let gl = fdlibm::cos(radian);
            let gr = fdlibm::sin(radian);
            for n in 0..Q {
                let x = input.data[0][n];
                out.data[0][n] = (x as f64 * gl) as f32;
                out.data[1][n] = (x as f64 * gr) as f32;
            }
        } else {
            let radian = (if target <= 0.0 { target + 1.0 } else { target }) as f64 * PI_OVER_TWO;
            let gl = fdlibm::cos(radian);
            let gr = fdlibm::sin(radian);
            for n in 0..Q {
                let (l, r) = (input.data[0][n], input.data[1][n]);
                if target <= 0.0 {
                    out.data[0][n] = (l as f64 + r as f64 * gl) as f32;
                    out.data[1][n] = (r as f64 * gr) as f32;
                } else {
                    out.data[0][n] = (l as f64 * gl) as f32;
                    out.data[1][n] = (r as f64 + l as f64 * gr) as f32;
                }
            }
        }
    }

    /// `UpdateSchedulingInfo`: (frame offset, frames to render, start
    /// offset), the bus zeroed where nothing plays.
    fn scheduling(schedule: &mut Schedule, frame: u64, sample_rate: f64, bus: &mut Bus) -> (usize, usize, f64) {
        let quantum_end = frame + Q as u64;
        let to_frame = |t: f64| ((t * sample_rate * 1024.0).round() / 1024.0).ceil() as u64;
        let start_frame = to_frame(schedule.start);
        let end_frame = schedule.end.map(to_frame);
        if let Some(end) = end_frame {
            if end <= frame {
                schedule.state = Play::Finished;
            }
        }
        if matches!(schedule.state, Play::Unscheduled | Play::Finished) || start_frame >= quantum_end {
            bus.zero();
            return (0, 0, 0.0);
        }
        let mut start_offset = 0.0;
        if schedule.state == Play::Scheduled {
            schedule.state = Play::Playing;
            start_offset = schedule.start * sample_rate - start_frame as f64;
        }
        let offset = if start_frame > frame { (start_frame - frame) as usize } else { 0 }.min(Q);
        let mut frames = Q - offset;
        if frames == 0 {
            bus.zero();
            return (offset, 0, start_offset);
        }
        if offset > 0 {
            for c in 0..bus.channels {
                bus.data[c][..offset].iter_mut().for_each(|v| *v = 0.0);
            }
        }
        if let Some(end) = end_frame {
            if end >= frame && end < quantum_end {
                let zero_start = (end - frame) as usize;
                let zeros = Q - zero_start;
                frames = frames.saturating_sub(zeros);
                for c in 0..bus.channels {
                    bus.data[c][zero_start..].iter_mut().for_each(|v| *v = 0.0);
                }
                schedule.state = Play::Finished;
            }
        }
        (offset, frames, start_offset)
    }

    fn process_constant(&mut self, i: usize) {
        let frame = self.frame;
        let sr = self.sample_rate as f64;
        let Kind::Constant { mut schedule } = self.nodes[i].kind else { return };
        let (offset, frames, _) = Self::scheduling(&mut schedule, frame, sr, &mut self.buses[i]);
        if let Kind::Constant { schedule: s } = &mut self.nodes[i].kind {
            *s = schedule;
        }
        if frames == 0 {
            self.buses[i].zero();
            return;
        }
        let sa = self.has_sa(i, 0);
        if sa && self.is_audio_rate(i, 0) {
            self.sample_accurate_values(i, 0);
            let out = &mut self.buses[i];
            out.data[0][offset..offset + frames].copy_from_slice(&self.values[0][offset..offset + frames]);
            out.clear_silent();
            return;
        }
        let value = if sa { self.final_value(i, 0) } else { self.value(i, 0) };
        let out = &mut self.buses[i];
        if value == 0.0 {
            out.zero();
        } else {
            out.data[0][offset..offset + frames].iter_mut().for_each(|v| *v = value);
            out.clear_silent();
        }
    }

    // ── The oscillator ──────────────────────────────────────────────────────

    /// `CalculateSampleAccuratePhaseIncrements`: whether the increments are
    /// per frame (then in `self.phase`), and the k-rate scale otherwise.
    fn phase_increments(&mut self, i: usize, rate_scale: f32) -> bool {
        let mut has_sa = false;
        let mut has_frequency_changes = false;
        let mut final_scale = rate_scale;
        if self.has_sa(i, 0) && self.is_audio_rate(i, 0) {
            has_sa = true;
            has_frequency_changes = true;
            self.sample_accurate_values(i, 0);
            self.phase = self.values[0];
        } else {
            let f = self.final_value(i, 0);
            final_scale *= f;
        }
        if self.has_sa(i, 1) && self.is_audio_rate(i, 1) {
            has_sa = true;
            self.sample_accurate_values(i, 1);
            let k: f32 = (1.0f64 / 1200.0) as f32;
            let mut d = self.values[1];
            for v in d.iter_mut() {
                *v = exp2f(*v * k);
            }
            if has_frequency_changes {
                for n in 0..Q {
                    self.phase[n] = d[n] * self.phase[n];
                }
            } else {
                self.phase = d;
            }
            self.detune = d;
        } else {
            let detune = self.final_value(i, 1);
            final_scale *= exp2f(detune / 1200.0);
        }
        if has_sa {
            let nyquist = self.sample_rate / 2.0;
            for v in self.phase.iter_mut() {
                *v = if v.is_nan() { nyquist } else { v.clamp(-nyquist, nyquist) };
                *v *= final_scale;
            }
        }
        has_sa
    }

    fn process_osc(&mut self, i: usize) {
        let frame = self.frame;
        let sr = self.sample_rate as f64;
        let Kind::Osc { wave, index, mut schedule } = self.nodes[i].kind else { return };
        let (offset, frames, start_offset) = Self::scheduling(&mut schedule, frame, sr, &mut self.buses[i]);
        if let Kind::Osc { schedule: s, .. } = &mut self.nodes[i].kind {
            *s = schedule;
        }
        if frames == 0 {
            self.buses[i].zero();
            return;
        }
        let w = wave as usize;
        let rate_scale = self.waves[w].rate_scale();
        let has_sa = self.phase_increments(i, rate_scale);
        let lazy = self.waves[w].is_lazy();
        let mut frequency = 0.0f32;
        let mut tables = (0, 0, 0.0);
        if !has_sa {
            frequency = self.final_value(i, 0);
            let detune = self.final_value(i, 1);
            frequency *= exp2f(detune / 1200.0);
            let nyquist = self.sample_rate / 2.0;
            frequency = if frequency.is_nan() { nyquist } else { frequency.clamp(-nyquist, nyquist) };
            tables = self.waves[w].select(frequency);
        }
        let _ = tables;
        let mut dest = offset;
        let mut n = frames;
        let mut vri = index;
        let size = self.waves[w].size() as f64;
        if start_offset > 0.0 {
            dest += 1;
            n -= 1;
            vri += (1.0 - start_offset) * frequency as f64 * rate_scale as f64;
        } else if start_offset < 0.0 {
            vri = -start_offset * frequency as f64 * rate_scale as f64;
        }
        // ProcessKRate asks for both values once more.
        let k = if has_sa { (0.0, 0.0) } else { (self.final_value(i, 0), self.final_value(i, 1)) };
        if lazy {
            // The tables this quantum reads, made now if they are not there.
            let mut need = [usize::MAX; 8];
            let mut count = 0;
            let add = |r: usize, need: &mut [usize; 8], count: &mut usize| {
                if !need[..*count].contains(&r) && *count < 8 {
                    need[*count] = r;
                    *count += 1;
                }
            };
            let wv = &self.waves[w];
            if has_sa {
                let inv = 1.0 / rate_scale;
                let loops = n / 4;
                for q in 0..loops {
                    let f = [inv * self.phase[4 * q], inv * self.phase[4 * q + 1], inv * self.phase[4 * q + 2], inv * self.phase[4 * q + 3]];
                    for (a, b, _) in wv.select4(f) {
                        add(a, &mut need, &mut count);
                        add(b, &mut need, &mut count);
                    }
                }
                for m in loops * 4..n {
                    let (a, b, _) = wv.select(inv * self.phase[m]);
                    add(a, &mut need, &mut count);
                    add(b, &mut need, &mut count);
                }
            } else {
                let mut f = k.0 * exp2f(k.1 / 1200.0);
                let nyquist = self.sample_rate / 2.0;
                f = if f.is_nan() { nyquist } else { f.clamp(-nyquist, nyquist) };
                let (a, b, _) = wv.select(f);
                add(a, &mut need, &mut count);
                add(b, &mut need, &mut count);
            }
            for r in &need[..count] {
                self.waves[w].ensure(*r, &need[..count]);
            }
        }
        let wave = &self.waves[w];
        let out = &mut self.buses[i].data[0][dest..dest + n];
        vri = if has_sa { arate(wave, out, vri, &self.phase[..n]) } else { krate(wave, out, vri, k.0, k.1, self.sample_rate) };
        let _ = size;
        if let Kind::Osc { index, .. } = &mut self.nodes[i].kind {
            *index = vri;
        }
        self.buses[i].clear_silent();
    }

    // ── The biquad ──────────────────────────────────────────────────────────

    fn process_biquad(&mut self, i: usize, input_connected: bool) {
        let Kind::Biquad(bi) = self.nodes[i].kind else { return };
        let bi = bi as usize;
        if !input_connected {
            self.input.zero();
        }
        let sa_any = (0..4).any(|k| self.has_sa(i, k));
        let mut dirty = false;
        let mut is_audio_rate = false;
        if sa_any {
            dirty = true;
            is_audio_rate = (0..4).any(|k| self.is_audio_rate(i, k));
        } else {
            if self.biquads[bi].just_reset {
                let b = &mut self.biquads[bi];
                b.previous = [f32::NAN; 4];
                b.just_reset = false;
                dirty = true;
            } else {
                let finals = [self.final_value(i, 0), self.final_value(i, 1), self.final_value(i, 2), self.final_value(i, 3)];
                let b = &mut self.biquads[bi];
                if b.previous.iter().zip(&finals).any(|(p, f)| p != f) {
                    dirty = true;
                    b.previous = finals;
                }
            }
        }
        let nyquist = 0.5 * self.sample_rate as f64;
        let sr = self.sample_rate as f64;
        if dirty {
            if sa_any && is_audio_rate {
                for k in 0..4 {
                    self.sample_accurate_values(i, k);
                }
                let constant = (0..4).all(|k| self.values[k].iter().all(|v| *v == self.values[k][0]));
                let needed = if constant { 1 } else { Q };
                let values = &self.values;
                let b = &mut self.biquads[bi];
                b.sample_accurate = needed > 1;
                for n in 0..needed {
                    let f = normalize_frequency(values[0][n], nyquist, values[3][n]);
                    set_params(b, n, f, values[1][n] as f64);
                }
                let tail = tail_frame(b, needed - 1, MAX_TAIL_TIME * sr) / sr;
                b.tail_time = tail.clamp(0.0, MAX_TAIL_TIME);
            } else {
                let v = [self.final_value(i, 0), self.final_value(i, 1), self.final_value(i, 2), self.final_value(i, 3)];
                let b = &mut self.biquads[bi];
                b.sample_accurate = false;
                let f = normalize_frequency(v[0], nyquist, v[3]);
                set_params(b, 0, f, v[1] as f64);
                let tail = tail_frame(b, 0, MAX_TAIL_TIME * sr) / sr;
                b.tail_time = tail.clamp(0.0, MAX_TAIL_TIME);
            }
        }
        let channels = self.buses[i].channels;
        let input = &self.input;
        let out = &mut self.buses[i];
        let b = &mut self.biquads[bi];
        for c in 0..channels {
            let src = if input.channels == channels { c } else { 0 };
            biquad_run(b, c, &input.data[src], &mut out.data[c]);
        }
    }

    // ── The buffer source ───────────────────────────────────────────────────

    fn process_buffer(&mut self, i: usize) {
        let frame = self.frame;
        let sr = self.sample_rate as f64;
        let Kind::Buffer { buffer, index, mut schedule, looping, loop_start, loop_end } = self.nodes[i].kind else { return };
        let (offset, frames, start_offset) = Self::scheduling(&mut schedule, frame, sr, &mut self.buses[i]);
        if let Kind::Buffer { schedule: s, .. } = &mut self.nodes[i].kind {
            *s = schedule;
        }
        if frames == 0 {
            self.buses[i].zero();
            return;
        }
        // ComputePlaybackRate (k-rate parameters).
        let buf_rate = self.buffers[buffer as usize].sample_rate as f64;
        let rate_factor = buf_rate / sr;
        let base = self.final_value(i, 0) as f64;
        let detune = self.final_value(i, 1);
        let mut rate = rate_factor * base;
        rate *= fdlibm::pow(2.0, (detune / 1200.0) as f64);
        let rate = if rate.is_finite() { rate.clamp(-1024.0, 1024.0) } else { 0.0 };
        let buf = &self.buffers[buffer as usize];
        let len = buf.channels[0].len();
        let (mut vend, mut vdelta) = (len as f64, len as f64);
        if looping && (loop_start != 0.0 || loop_end != 0.0) && loop_start >= 0.0 && loop_end > 0.0 && loop_start < loop_end {
            let s = loop_start * buf_rate;
            let e = loop_end * buf_rate;
            vend = e.min(vend);
            vdelta = vend - s;
        }
        if rate.abs() > vdelta {
            self.buses[i].zero();
            return;
        }
        let mut vri = index;
        if rate >= 0.0 {
            if looping && vri >= vend {
                vri = if loop_start < 0.0 { 0.0 } else { loop_start * buf_rate };
                vri = vri.min((len - 1) as f64);
            }
            if start_offset < 0.0 && rate != 0.0 {
                vri += (start_offset * rate).abs();
            }
        }
        let out = &mut self.buses[i];
        let mut write = offset;
        let mut to_process = frames as i64;
        let chans = buf.channels.len().min(out.channels);
        let mut finished = false;
        if rate == 1.0 && vri == vri.floor() && vdelta == vdelta.floor() && vend == vend.floor() {
            // ProcessFastPath.
            let mut read = vri as usize;
            let end = vend as usize;
            let delta = vdelta as usize;
            while to_process > 0 {
                let to_end = end as i64 - read as i64;
                let this = to_process.min(to_end).max(0) as usize;
                for c in 0..chans {
                    out.data[c][write..write + this].copy_from_slice(&buf.channels[c][read..read + this]);
                }
                write += this;
                read += this;
                to_process -= this as i64;
                // HandleLoopWrapping with start 0, the whole loop.
                if read as f64 >= end as f64 {
                    let overflow = read as f64 - end as f64;
                    if !looping {
                        for c in 0..chans {
                            out.data[c][write..write + to_process.max(0) as usize].iter_mut().for_each(|v| *v = 0.0);
                        }
                        finished = true;
                        break;
                    }
                    read = (end as f64 - delta as f64 + overflow % delta as f64) as usize;
                }
            }
            vri = read as f64;
        } else {
            // ProcessInterpolatedPath.
            for k in 0..to_process {
                let remaining = to_process - k - 1;
                let read = vri as usize;
                let factor = vri - read as f64;
                let mut read2 = read + 1;
                if looping && (read as f64) < vend && read2 as f64 >= vend {
                    let next = vri + 1.0 - vdelta;
                    read2 = if next >= 0.0 { next as usize } else { 0 };
                } else if read2 >= len {
                    read2 = read;
                }
                if read >= len || read2 >= len {
                    break;
                }
                for c in 0..chans {
                    let s = &buf.channels[c];
                    let sample = if read == read2 && read >= 1 {
                        let s1 = s[read - 1] as f64;
                        let s2 = s[read] as f64;
                        s2 + (s2 - s1) * factor
                    } else {
                        (1.0 - factor) * s[read] as f64 + factor * s[read2] as f64
                    };
                    out.data[c][write] = sample.clamp(-f32::MAX as f64, f32::MAX as f64) as f32;
                }
                write += 1;
                vri += rate;
                if vdelta <= 0.0 {
                    finished = true;
                    break;
                }
                if rate >= 0.0 && vri >= vend {
                    let overflow = vri - vend;
                    if !looping {
                        for c in 0..chans {
                            out.data[c][write..write + remaining as usize].iter_mut().for_each(|v| *v = 0.0);
                        }
                        finished = true;
                        break;
                    }
                    vri = vend - vdelta + overflow % vdelta;
                }
            }
        }
        out.clear_silent();
        if let Kind::Buffer { index, schedule, .. } = &mut self.nodes[i].kind {
            *index = vri;
            if finished {
                schedule.state = Play::Finished;
            }
        }
    }
}

// ── Oscillator kernels ──────────────────────────────────────────────────────

const INTERPOLATE_2_POINT: f32 = 0.3;
const INTERPOLATE_3_POINT: f32 = 0.16;

/// `DoInterpolation`.
fn do_interpolation(vri: f64, incr: f32, mask: usize, factor: f32, lower: &[f32], higher: &[f32]) -> f32 {
    let mut sample_lower = 0.0f64;
    let mut sample_higher = 0.0f64;
    let read0 = vri as u32 as usize;
    if incr >= INTERPOLATE_2_POINT {
        let r2 = (read0 + 1) & mask;
        let r0 = read0 & mask;
        let (s1l, s2l, s1h, s2h) = (lower[r0], lower[r2], higher[r0], higher[r2]);
        let f = ((vri as f32) - r0 as f32) as f64;
        sample_higher = (1.0 - f) * s1h as f64 + f * s2h as f64;
        sample_lower = (1.0 - f) * s1l as f64 + f * s2l as f64;
    } else if incr >= INTERPOLATE_3_POINT {
        let t = vri - read0 as f64;
        let a = [0.5 * t * (t - 1.0), 1.0 - t * t, 0.5 * t * (t + 1.0)];
        for k in 0..3 {
            let r = (read0.wrapping_add(k).wrapping_sub(1)) & mask;
            sample_lower += a[k] * lower[r] as f64;
            sample_higher += a[k] * higher[r] as f64;
        }
    } else {
        let t = vri - read0 as f64;
        let t2 = t * t;
        let a = [
            t * (t2 - 1.0) * (t - 2.0) / 24.0,
            -t * (t - 1.0) * (t2 - 4.0) / 6.0,
            (t2 - 1.0) * (t2 - 4.0) / 4.0,
            -t * (t + 1.0) * (t2 - 4.0) / 6.0,
            t * (t2 - 1.0) * (t + 2.0) / 24.0,
        ];
        for k in 0..5 {
            let r = (read0.wrapping_add(k).wrapping_sub(2)) & mask;
            sample_lower += a[k] * lower[r] as f64;
            sample_higher += a[k] * higher[r] as f64;
        }
    }
    ((1.0 - factor) as f64 * sample_higher + factor as f64 * sample_lower) as f32
}

#[inline]
fn wrap(v: f64, size: f64, inv: f64) -> f64 {
    v - (v * inv).floor() * size
}

/// `WrapVirtualIndexVector`, one lane.
#[inline]
fn wrap_f32(x: f32, size: f32, inv: f32) -> f32 {
    let r = x * inv;
    let mut f = r as i32;
    if r < f as f32 {
        f -= 1;
    }
    x - f as f32 * size
}

/// `ProcessKRate` with the NEON `ProcessKRateVector`.
fn krate(wave: &Wave, dest: &mut [f32], vri: f64, frequency: f32, detune: f32, sample_rate: f32) -> f64 {
    let size = wave.size();
    let inv = 1.0 / size as f64;
    let mask = size - 1;
    let mut frequency = frequency * exp2f(detune / 1200.0);
    let nyquist = sample_rate / 2.0;
    frequency = if frequency.is_nan() { nyquist } else { frequency.clamp(-nyquist, nyquist) };
    let (hi, lo, factor) = wave.select(frequency);
    let higher = wave.table(hi);
    let lower = wave.table(lo);
    let rate_scale = wave.rate_scale();
    let incr = frequency * rate_scale;
    let n = dest.len();
    let mut vri = vri;
    if incr >= INTERPOLATE_2_POINT {
        // The vector part: a float index, four lanes.
        let size_f = size as f32;
        let inv_f = 1.0f32 / size as f32;
        let vf = vri as f32;
        let mut lanes = [vf + 0.0 * incr, vf + 1.0 * incr, vf + 2.0 * incr, vf + 3.0 * incr];
        for l in lanes.iter_mut() {
            *l = wrap_f32(*l, size_f, inv_f);
        }
        let step = 4.0 * incr;
        let loops = n / 4;
        let mut k = 0;
        for _ in 0..loops {
            for m in 0..4 {
                let r0 = (lanes[m] as u32 as usize) & mask;
                let r1 = (r0 + 1) & mask;
                let f = lanes[m] - r0 as u32 as f32;
                let sh = higher[r0] + f * (higher[r1] - higher[r0]);
                let sl = lower[r0] + f * (lower[r1] - lower[r0]);
                dest[k + m] = sh + factor * (sl - sh);
            }
            for l in lanes.iter_mut() {
                *l = wrap_f32(*l + step, size_f, inv_f);
            }
            k += 4;
        }
        let mut v_index = vri + k as f64 * incr as f64;
        v_index = wrap(v_index, size as f64, inv);
        if k < n {
            // ProcessKRateScalar.
            for slot in dest[k..].iter_mut() {
                let r0 = (v_index as u32 as usize) & mask;
                let r1 = (r0 + 1) & mask;
                let f = (v_index as f32) - r0 as f32;
                let sh = higher[r0] + f * (higher[r1] - higher[r0]);
                let sl = lower[r0] + f * (lower[r1] - lower[r0]);
                *slot = sh + factor * (sl - sh);
                v_index += incr as f64;
                v_index = wrap(v_index, size as f64, inv);
            }
        }
        vri += n as f64 * incr as f64;
        vri = wrap(vri, size as f64, inv);
    } else {
        for slot in dest.iter_mut() {
            *slot = do_interpolation(vri, incr.abs(), mask, factor, lower, higher);
            vri += incr as f64;
            vri = wrap(vri, size as f64, inv);
        }
    }
    vri
}

/// `ProcessARate`: the NEON vector part, then the scalar rest.
fn arate(wave: &Wave, dest: &mut [f32], vri: f64, phase: &[f32]) -> f64 {
    let rate_scale = wave.rate_scale();
    let inv_rate_scale = 1.0 / rate_scale;
    let size = wave.size();
    let size_d = size as f64;
    let inv = 1.0 / size_d;
    let mask = size - 1;
    let n = dest.len();
    let mut vri = vri;
    let loops = n / 4;
    let mut k = 0;
    for _ in 0..loops {
        let mut big = true;
        let mut freq = [0.0f32; 4];
        for m in 0..4 {
            let p = phase[k + m];
            big = big && p.abs() >= INTERPOLATE_2_POINT;
            freq[m] = inv_rate_scale * p;
        }
        let sel = wave.select4(freq);
        if big {
            // ProcessARateVectorKernel (NEON).
            let mut sum = [0.0f64; 4];
            sum[0] = phase[k] as f64;
            for m in 1..4 {
                sum[m] = sum[m - 1] + phase[k + m] as f64;
            }
            let vi = [wrap(vri, size_d, inv), wrap(vri + sum[0], size_d, inv), wrap(vri + sum[1], size_d, inv), wrap(vri + sum[2], size_d, inv)];
            let size_f = size as f32;
            let inv_f = inv as f32;
            for m in 0..4 {
                let v = wrap_f32(vi[m] as f32, size_f, inv_f);
                let r0 = (v as u32 as usize) & mask;
                let r1 = (r0 + 1) & mask;
                let (hi, lo, factor) = sel[m];
                let higher = wave.table(hi);
                let lower = wave.table(lo);
                let f = v - r0 as u32 as f32;
                let sh = higher[r0] + f * (higher[r1] - higher[r0]);
                let sl = lower[r0] + f * (lower[r1] - lower[r0]);
                dest[k + m] = sh + factor * (sl - sh);
            }
            vri = wrap(vri + sum[3], size_d, inv);
        } else {
            for m in 0..4 {
                let (hi, lo, factor) = sel[m];
                dest[k + m] = do_interpolation(vri, phase[k + m].abs(), mask, factor, wave.table(lo), wave.table(hi));
                vri += phase[k + m] as f64;
                vri = wrap(vri, size_d, inv);
            }
        }
        k += 4;
    }
    for m in k..n {
        let incr = phase[m];
        let frequency = inv_rate_scale * incr;
        let (hi, lo, factor) = wave.select(frequency);
        dest[m] = do_interpolation(vri, incr.abs(), mask, factor, wave.table(lo), wave.table(hi));
        vri += incr as f64;
        vri = wrap(vri, size_d, inv);
    }
    vri
}

// ── Biquad ──────────────────────────────────────────────────────────────────

/// `NormalizeFrequency`.
fn normalize_frequency(frequency: f32, nyquist: f64, detune: f32) -> f64 {
    let normalized = frequency as f64 / nyquist;
    if detune != 0.0 {
        normalized * ((detune / 1200.0) as f64).exp2()
    } else {
        normalized
    }
}

/// `pow10` in `biquad.cc`: `fdlibm::expf` of a float.
fn pow10(x: f64) -> f64 {
    fdlibm::expf((x * 2.30258509299404568402) as f32) as f64
}

fn set_normalized(b: &mut BiquadState, n: usize, b0: f64, b1: f64, b2: f64, a0: f64, a1: f64, a2: f64) {
    let inv = 1.0 / a0;
    b.b0[n] = b0 * inv;
    b.b1[n] = b1 * inv;
    b.b2[n] = b2 * inv;
    b.a1[n] = a1 * inv;
    b.a2[n] = a2 * inv;
}

/// `SetBiquadParams` for the three types the instruments use.
fn set_params(b: &mut BiquadState, n: usize, frequency: f64, q: f64) {
    use core::f64::consts::PI;
    match b.kind {
        FilterType::Lowpass => {
            let cutoff = frequency.clamp(0.0, 1.0);
            if cutoff == 1.0 {
                set_normalized(b, n, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0);
            } else if cutoff > 0.0 {
                let resonance = pow10(q / 20.0);
                let theta = PI * cutoff;
                let alpha = fdlibm::sin(theta) / (2.0 * resonance);
                let cosw = fdlibm::cos(theta);
                let beta = (1.0 - cosw) / 2.0;
                set_normalized(b, n, beta, 2.0 * beta, beta, 1.0 + alpha, -2.0 * cosw, 1.0 - alpha);
            } else {
                set_normalized(b, n, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0);
            }
        }
        FilterType::Highpass => {
            let cutoff = frequency.clamp(0.0, 1.0);
            if cutoff == 1.0 {
                set_normalized(b, n, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0);
            } else if cutoff > 0.0 {
                let resonance = pow10(q / 20.0);
                let theta = PI * cutoff;
                let alpha = fdlibm::sin(theta) / (2.0 * resonance);
                let cosw = fdlibm::cos(theta);
                let beta = (1.0 + cosw) / 2.0;
                set_normalized(b, n, beta, -2.0 * beta, beta, 1.0 + alpha, -2.0 * cosw, 1.0 - alpha);
            } else {
                set_normalized(b, n, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0);
            }
        }
        FilterType::Bandpass => {
            let frequency = frequency.max(0.0);
            let q = q.max(0.0);
            if frequency > 0.0 && frequency < 1.0 {
                let w0 = PI * frequency;
                if q > 0.0 {
                    let alpha = fdlibm::sin(w0) / (2.0 * q);
                    let k = fdlibm::cos(w0);
                    set_normalized(b, n, alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * k, 1.0 - alpha);
                } else {
                    set_normalized(b, n, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0);
                }
            } else {
                set_normalized(b, n, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0);
            }
        }
    }
}

/// `Biquad::Process` on a Mac.
fn biquad_run(b: &mut BiquadState, c: usize, src: &[f32; Q], dest: &mut [f32; Q]) {
    let st = &mut b.ch[c];
    if b.sample_accurate {
        let (mut x1, mut x2, mut y1, mut y2) = (st.x1, st.x2, st.y1, st.y2);
        for k in 0..Q {
            let x = src[k];
            let y = (b.b0[k] * x as f64 + b.b1[k] * x1 + b.b2[k] * x2 - b.a1[k] * y1 - b.a2[k] * y2) as f32;
            dest[k] = y;
            x2 = x1;
            x1 = x as f64;
            y2 = y1;
            y1 = y as f64;
        }
        st.x1 = flush(x1);
        st.x2 = flush(x2);
        st.y1 = flush(y1);
        st.y2 = flush(y2);
    } else {
        // vDSP_deq22D over the quantum, the state kept in double.
        let c5 = [b.b0[0], b.b1[0], b.b2[0], b.a1[0], b.a2[0]];
        let (mut x1, mut x2, mut y1, mut y2) = (st.x1, st.x2, st.y1, st.y2);
        for k in 0..Q {
            let x = src[k] as f64;
            let y = deq22d(&c5, x, x1, x2, y1, y2);
            dest[k] = y as f32;
            x2 = x1;
            x1 = x;
            y2 = y1;
            y1 = y;
        }
        st.x1 = x1;
        st.x2 = x2;
        st.y1 = y1;
        st.y2 = y2;
    }
}

/// `DenormalDisabler::FlushDenormalFloatToZero` (of a double, as a float
/// would be).
#[inline]
fn flush(v: f64) -> f64 {
    if v.abs() < f32::MIN_POSITIVE as f64 {
        0.0
    } else {
        v
    }
}

/// `Biquad::TailFrame`.
fn tail_frame(b: &BiquadState, n: usize, max_frame: f64) -> f64 {
    const MAX_TAIL_AMPLITUDE: f64 = 1.0 / 32768.0;
    let (a1, a2, b0, b1, b2) = (b.a1[n], b.a2[n], b.b0[n], b.b1[n], b.b2[n]);
    let discrim = a1 * a1 - 4.0 * a2;
    if discrim > 0.0 {
        let rplus = (-a1 + discrim.sqrt()) / 2.0;
        let rminus = (-a1 - discrim.sqrt()) / 2.0;
        let r1 = if rplus.abs() >= rminus.abs() { rplus } else { rminus };
        let r2 = a2 / r1;
        let c1 = (b0 * r1 * r1 + b1 * r1 + b2) / (r2 - r1);
        let c2 = (b0 * r2 * r2 + b1 * r2 + b2) / (r2 - r1);
        let t = 1.0 + fdlibm::log(MAX_TAIL_AMPLITUDE / (c1.abs() + c2.abs())) / fdlibm::log(r1.abs());
        if t > 0.0 { t } else { 0.0 }
    } else if discrim < 0.0 {
        let x = -a1 / 2.0;
        let y = (-discrim).sqrt() / 2.0;
        let r = x.hypot(y);
        if r == 1.0 {
            return max_frame;
        }
        // |(b0 r1² + b1 r1 + b2) / (r2 - r1)| for r1 = x + iy, r2 = x - iy.
        let cabs = |sy: f64| {
            let (re, im) = (x, sy);
            let (re2, im2) = (re * re - im * im, 2.0 * re * im);
            let nr = b0 * re2 + b1 * re + b2;
            let ni = b0 * im2 + b1 * im;
            // r2 - r1 = -2iy for r1; 2iy for r2.
            let d = 2.0 * y;
            (nr * nr + ni * ni).sqrt() / d
        };
        let c1 = cabs(y);
        let c2 = cabs(-y);
        if c1 == 0.0 && c2 == 0.0 {
            0.0
        } else {
            1.0 + fdlibm::log(MAX_TAIL_AMPLITUDE / (c1 + c2)) / fdlibm::log(r)
        }
    } else {
        let r = -a1 / 2.0;
        if r == 0.0 {
            2.0
        } else if r.abs() >= 1.0 {
            f64::INFINITY
        } else {
            let c1 = (b0 * r * r + b1 * r + b2) / (r * r);
            let c2 = b1 * r + 2.0 * b2;
            if c1 == 0.0 && c2 == 0.0 {
                0.0
            } else {
                let low = (-(1.0 + fdlibm::log(r)) / fdlibm::log(r)).clamp(1.0, max_frame - 1.0);
                root_finder(low, max_frame, fdlibm::log(MAX_TAIL_AMPLITUDE), c1, c2, r)
            }
        }
    }
}

fn root_finder(mut low: f64, mut high: f64, log_eps: f64, c1: f64, c2: f64, r: f64) -> f64 {
    let response = |n: f64| (n - 2.0) * fdlibm::log(r) + fdlibm::log((c1 * (n + 1.0) * r * r + c2).abs()) - log_eps;
    let mut side = 0;
    let mut root = 0.0;
    let mut f_low = response(low);
    let mut f_high = response(high);
    for _ in 0..10 {
        root = (f_low * high - f_high * low) / (f_low - f_high);
        if (high - low).abs() < 0.5 * (high + low).abs() {
            break;
        }
        let fr = response(root);
        if fr * f_high > 0.0 {
            high = root;
            f_high = fr;
            side = -1;
        } else if f_low * fr > 0.0 {
            low = root;
            f_low = fr;
            if side == 1 {
                f_high /= 2.0;
            }
            side = 1;
        } else {
            break;
        }
    }
    root
}

// ── Delay (delay.cc, cpu/arm/delay_neon.cc) ─────────────────────────────────

#[derive(Clone, Debug)]
struct DelayState {
    max_time: f64,
    sample_rate: f32,
    buf: [Vec<f32>; 2],
    write: [usize; 2],
}

impl DelayState {
    fn new(max_time: f64, sample_rate: f32) -> Self {
        // BufferLengthForDelay: a quantum more than the longest delay.
        let frames = ((max_time * sample_rate as f64 * 1024.0).round() / 1024.0).ceil() as usize;
        let len = Q + frames;
        DelayState { max_time, sample_rate, buf: [vec![0.0; len], vec![0.0; len]], write: [0; 2] }
    }

    fn reset(&mut self) {
        for b in self.buf.iter_mut() {
            b.iter_mut().for_each(|v| *v = 0.0);
        }
        self.write = [0; 2];
    }

    /// `Delay::ProcessARate` for channel `c`, with the delay times (in
    /// seconds) of this quantum: all through the NEON kernel.
    fn process_arate(&mut self, c: usize, src: &[f32; Q], times: &mut [f32; Q], dest: &mut [f32; Q]) {
        let max_time = self.max_time as f32;
        for t in times.iter_mut() {
            if t.is_nan() {
                *t = max_time;
            }
        }
        let buf = &mut self.buf[c];
        let len = buf.len();
        // CopyToCircularBuffer.
        let w = self.write[c];
        let first = Q.min(len - w);
        buf[w..w + first].copy_from_slice(&src[..first]);
        if Q > first {
            buf[..Q - first].copy_from_slice(&src[first..]);
        }
        let sr = self.sample_rate;
        let len_f = len as f32;
        let len_i = len as i32;
        let wrap_i = |v: i32| if v >= len_i { v - len_i } else { v };
        let mut wi = [w as i32, w as i32 + 1, w as i32 + 2, w as i32 + 3].map(wrap_i);
        for k in (0..Q).step_by(4) {
            for m in 0..4 {
                let t = times[k + m].max(0.0);
                let frames = t * sr;
                let mut pos = wi[m] as f32 + (len_f - frames);
                if pos >= len_f {
                    pos -= len_f;
                }
                let r1 = wrap_i(pos as i32);
                let r2 = wrap_i(r1 + 1);
                let f = pos - r1 as f32;
                let s1 = buf[r1 as usize];
                let s2 = buf[r2 as usize];
                dest[k + m] = s1 + f * (s2 - s1);
            }
            for v in wi.iter_mut() {
                *v = wrap_i(*v + 4);
            }
        }
        let mut nw = w + Q;
        if nw >= len {
            nw -= len;
        }
        self.write[c] = nw;
    }
}

// ── Wave shaper (wave_shaper_handler.cc, up_sampler.cc, down_sampler.cc) ────

/// `kKernelSize` of the up-sampler, and of the down-sampler (whose kernel
/// keeps every other tap of it).
const KERNEL: usize = 128;
const DOWN_KERNEL: usize = 256;

#[derive(Clone, Debug)]
struct ShaperKernel {
    /// The up-sampler: its delayed input, and its direct convolver's history.
    up_input: [f32; KERNEL / 2 + Q],
    up_conv: [f32; KERNEL - 1 + Q],
    /// The down-sampler (a 256 kernel, reduced to 128 taps): its delayed
    /// input and its direct convolver's history.
    down_input: [f32; DOWN_KERNEL / 2 + 2 * Q],
    down_conv: [f32; KERNEL - 1 + Q],
}

impl ShaperKernel {
    const fn new() -> Self {
        ShaperKernel { up_input: [0.0; KERNEL / 2 + Q], up_conv: [0.0; KERNEL - 1 + Q], down_input: [0.0; DOWN_KERNEL / 2 + 2 * Q], down_conv: [0.0; KERNEL - 1 + Q] }
    }
}

#[derive(Clone, Debug)]
struct ShaperState {
    curve: Vec<f32>,
    oversample: u8,
    tail_time: f64,
    latency: f64,
    kernels: [ShaperKernel; 2],
    up_kernel: [f32; KERNEL],
    down_kernel: [f32; KERNEL],
}

impl ShaperState {
    fn new(oversample: u8, sample_rate: f32) -> Self {
        use core::f64::consts::PI;
        // UpSampler's MakeKernel.
        let mut up_kernel = [0.0f32; KERNEL];
        let (alpha, n) = (0.16f64, KERNEL as i32);
        let (a0, a1, a2) = (0.5 * (1.0 - alpha), 0.5, 0.5 * alpha);
        let half = n / 2;
        for i in 0..n {
            let s = PI * (i as f64 - half as f64 + 0.5);
            let sinc = if s == 0.0 { 1.0 } else { fdlibm::sin(s) / s };
            let x = (i as f64 + 0.5) / n as f64;
            let window = a0 - a1 * fdlibm::cos(2.0 * PI * x) + a2 * fdlibm::cos(2.0 * PI * 2.0 * x);
            up_kernel[i as usize] = (sinc * window) as f32;
        }
        // DownSampler's MakeReducedKernel, of 256.
        let mut down_kernel = [0.0f32; KERNEL];
        let n = DOWN_KERNEL as i32;
        let half = n / 2;
        let mut i = 1;
        while i < n {
            let s = 0.5 * PI * (i - half) as f64;
            let mut sinc = if s == 0.0 { 1.0 } else { fdlibm::sin(s) / s };
            sinc *= 0.5;
            let x = i as f64 / n as f64;
            let window = a0 - a1 * fdlibm::cos(2.0 * PI * x) + a2 * fdlibm::cos(2.0 * PI * 2.0 * x);
            down_kernel[((i - 1) / 2) as usize] = (sinc * window) as f32;
            i += 2;
        }
        let latency = if oversample == 2 { (KERNEL / 2 + KERNEL / 2) as f64 / sample_rate as f64 } else { 0.0 };
        ShaperState { curve: Vec::with_capacity(4096), oversample, tail_time: 0.0, latency, kernels: [ShaperKernel::new(), ShaperKernel::new()], up_kernel, down_kernel }
    }

    fn reset(&mut self) {
        self.kernels = [ShaperKernel::new(), ShaperKernel::new()];
    }

    /// `SetCurve`: and the tail, infinite unless the curve gives 0 for 0.
    fn set_curve(&mut self, curve: &[f32]) {
        self.curve.clear();
        self.curve.extend_from_slice(curve);
        if curve.is_empty() {
            self.tail_time = 0.0;
            return;
        }
        let out = curve_value(0.0, curve);
        self.tail_time = if out == 0.0 { 0.0 } else { f64::INFINITY };
    }

    fn process(&mut self, c: usize, src: &[f32; Q], dest: &mut [f32; Q]) {
        if self.curve.is_empty() {
            *dest = *src;
            return;
        }
        if self.oversample != 2 {
            curve_values(&mut dest[..], &src[..], &self.curve);
            return;
        }
        let mut up = [0.0f32; 2 * Q];
        let k = &mut self.kernels[c];
        // UpSampler::Process.
        k.up_input[KERNEL / 2..].copy_from_slice(src);
        for i in 0..Q {
            up[2 * i] = k.up_input[i];
        }
        let mut odd = [0.0f32; Q];
        k.up_conv[KERNEL - 1..].copy_from_slice(src);
        vdsp_conv_128(&k.up_conv, &self.up_kernel, &mut odd);
        k.up_conv.copy_within(Q..Q + KERNEL - 1, 0);
        for i in 0..Q {
            up[2 * i + 1] = odd[i];
        }
        k.up_input.copy_within(Q..Q + KERNEL / 2, 0);
        // The curve, at twice the rate.
        let copy = up;
        curve_values(&mut up[..], &copy[..], &self.curve);
        // DownSampler::Process.
        k.down_input[DOWN_KERNEL / 2..].copy_from_slice(&up);
        let mut odd = [0.0f32; Q];
        for i in 0..Q {
            odd[i] = k.down_input[DOWN_KERNEL / 2 - 1 + 2 * i];
        }
        k.down_conv[KERNEL - 1..].copy_from_slice(&odd);
        vdsp_conv_128(&k.down_conv, &self.down_kernel, dest);
        k.down_conv.copy_within(Q..Q + KERNEL - 1, 0);
        for i in 0..Q {
            dest[i] += 0.5 * k.down_input[2 * i];
        }
        k.down_input.copy_within(2 * Q..2 * Q + DOWN_KERNEL / 2, 0);
    }
}

/// `WaveShaperCurveValue`, in double.
fn curve_value(input: f32, curve: &[f32]) -> f64 {
    let n = curve.len();
    let vi = 0.5 * (input as f64 + 1.0) * (n - 1) as f64;
    if vi < 0.0 {
        curve[0] as f64
    } else if vi >= (n - 1) as f64 {
        curve[n - 1] as f64
    } else {
        let i1 = vi as usize;
        let f = vi - i1 as f64;
        (1.0 - f) * curve[i1] as f64 + f * curve[i1 + 1] as f64
    }
}

/// `WaveShaperCurveValues` (the NEON path; in float).
fn curve_values(dest: &mut [f32], src: &[f32], curve: &[f32]) {
    let n = curve.len();
    let max = (n - 1) as i32;
    let scale = (0.5 * (n - 1) as f64) as f32;
    let top = (n - 1) as f32;
    for k in 0..dest.len().min(src.len()) {
        let mut vi = (src[k] + 1.0) * scale;
        vi = if vi < 0.0 { 0.0 } else if vi > top { top } else { vi };
        let i1 = (vi as i32).clamp(0, max);
        let i2 = (i1 + 1).clamp(0, max);
        let v1 = curve[i1 as usize];
        let v2 = curve[i2 as usize];
        let f = vi - i1 as f32;
        dest[k] = f * (v2 - v1) + v1;
    }
}

/// `vDSP_conv` of 128 outputs and 128 taps, the filter reversed (as
/// `vector_math::Conv` calls it), in Accelerate's own order of operations.
fn vdsp_conv_128(signal: &[f32; KERNEL - 1 + Q], kernel: &[f32; KERNEL], out: &mut [f32; Q]) {
    use super::conv_order::*;
    let chain = |taps: &[u8], n: usize| {
        let p = taps[0] as usize;
        let mut acc = signal[n + p] * kernel[KERNEL - 1 - p];
        for &t in &taps[1..] {
            let p = t as usize;
            acc = signal[n + p].mul_add(kernel[KERNEL - 1 - p], acc);
        }
        acc
    };
    for n in 0..Q {
        let y = (4..8).contains(&(n % 16));
        let (b, c, a) = if y { (&B_Y[..], &C_Y[..], &A_Y[..]) } else { (&B_X[..], &C_X[..], &A_X[..]) };
        out[n] = (chain(b, n) + chain(c, n)) + chain(a, n);
    }
}

impl Graph {
    fn process_delay(&mut self, i: usize, input_connected: bool) {
        let Kind::Delay(d) = self.nodes[i].kind else { return };
        let d = d as usize;
        if !input_connected {
            self.input.zero();
        }
        let channels = self.buses[i].channels;
        for c in 0..channels {
            // Each kernel asks the parameter for this quantum's times.
            self.sample_accurate_values(i, 0);
            let mut times = self.values[0];
            let src = if self.input.channels == channels { c } else { 0 };
            let input = self.input.data[src];
            let mut out = [0.0f32; Q];
            self.delays[d].process_arate(c, &input, &mut times, &mut out);
            self.buses[i].data[c] = out;
        }
    }

    fn process_shaper(&mut self, i: usize, input_connected: bool) {
        let Kind::Shaper(w) = self.nodes[i].kind else { return };
        if !input_connected {
            self.input.zero();
        }
        let channels = self.buses[i].channels;
        for c in 0..channels {
            let src = if self.input.channels == channels { c } else { 0 };
            let input = self.input.data[src];
            let mut out = [0.0f32; Q];
            self.shapers[w as usize].process(c, &input, &mut out);
            self.buses[i].data[c] = out;
        }
    }
}
