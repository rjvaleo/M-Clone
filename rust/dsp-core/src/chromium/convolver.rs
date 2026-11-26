//! A `ConvolverNode`'s engine: Chromium's `Reverb`, `ReverbConvolver`,
//! `ReverbConvolverStage`, `FFTConvolver`, `DirectConvolver` and
//! `ReverbAccumulationBuffer` (`platform/audio/`), as an offline context runs
//! them: no background threads, every stage on the render thread, FFTs up to
//! 32768 points.
//!
//! The arithmetic is vDSP's on Apple's systems ([`super::vdsp`]), so there it
//! is the page's to the bit; elsewhere the FFTs agree to rounding.
//!
//! Everything is allocated when the impulse response is set; processing
//! allocates nothing.

use super::vdsp::{self, Fft};

/// `kMaxFftSize` of a `ConvolverNode`.
const MAX_FFT_SIZE: usize = 32768;
/// `kMinFFTSize`.
const MIN_FFT_SIZE: usize = 128;

/// `ReverbAccumulationBuffer`.
struct Accumulation {
    buffer: Vec<f32>,
    read_index: usize,
}

impl Accumulation {
    fn new(length: usize) -> Self {
        Accumulation { buffer: vec![0.0; length], read_index: 0 }
    }

    fn read_and_clear(&mut self, dest: &mut [f32]) {
        let len = self.buffer.len();
        let n = dest.len();
        let available = len - self.read_index;
        let n1 = n.min(available);
        let n2 = n - n1;
        dest[..n1].copy_from_slice(&self.buffer[self.read_index..self.read_index + n1]);
        self.buffer[self.read_index..self.read_index + n1].iter_mut().for_each(|v| *v = 0.0);
        if n2 > 0 {
            dest[n1..].copy_from_slice(&self.buffer[..n2]);
            self.buffer[..n2].iter_mut().for_each(|v| *v = 0.0);
        }
        self.read_index = (self.read_index + n) % len;
    }

    fn update_read_index(&self, read_index: &mut usize, n: usize) {
        *read_index = (*read_index + n) % self.buffer.len();
    }

    fn accumulate(&mut self, source: &[f32], read_index: &mut usize, delay: usize) {
        let len = self.buffer.len();
        let n = source.len();
        let write = (*read_index + delay) % len;
        *read_index = (*read_index + n) % len;
        let available = len - write;
        let n1 = n.min(available);
        let n2 = n - n1;
        vdsp::vadd_into(&source[..n1], &mut self.buffer[write..write + n1]);
        if n2 > 0 {
            vdsp::vadd_into(&source[n1..], &mut self.buffer[..n2]);
        }
    }
}

/// `FFTConvolver`.
struct FftConvolver {
    frame: Fft,
    read_write_index: usize,
    input: Vec<f32>,
    output: Vec<f32>,
    last_overlap: Vec<f32>,
}

impl FftConvolver {
    fn new(fft_size: usize) -> Self {
        FftConvolver {
            frame: Fft::new(fft_size),
            read_write_index: 0,
            input: vec![0.0; fft_size],
            output: vec![0.0; fft_size],
            last_overlap: vec![0.0; fft_size / 2],
        }
    }

    fn process(&mut self, kernel: &Fft, source: &[f32], dest: &mut [f32]) {
        let n = source.len();
        let half = self.frame.size / 2;
        let divisions = if half <= n { n / half } else { 1 };
        let division = if divisions == 1 { n } else { half };
        for i in 0..divisions {
            let src = &source[i * division..(i + 1) * division];
            let dst = &mut dest[i * division..(i + 1) * division];
            let at = self.read_write_index;
            self.input[at..at + division].copy_from_slice(src);
            dst.copy_from_slice(&self.output[at..at + division]);
            self.read_write_index += division;
            if self.read_write_index == half {
                self.frame.forward(&self.input);
                self.frame.multiply(kernel);
                self.frame.inverse(&mut self.output);
                vdsp::vadd_into(&self.last_overlap, &mut self.output[..half]);
                let (a, b) = self.output.split_at(half);
                let _ = a;
                self.last_overlap.copy_from_slice(&b[..half]);
                self.read_write_index = 0;
            }
        }
    }
}

/// `DirectConvolver`.
struct DirectConvolver {
    kernel: Vec<f32>,
    buffer: Vec<f32>,
}

impl DirectConvolver {
    fn new(block: usize, kernel: Vec<f32>) -> Self {
        let buffer = vec![0.0; kernel.len() - 1 + block];
        DirectConvolver { kernel, buffer }
    }

    fn process(&mut self, source: &[f32], dest: &mut [f32]) {
        let n = dest.len();
        let history = self.kernel.len() - 1;
        self.buffer[history..history + n].copy_from_slice(&source[..n]);
        vdsp::conv(&self.buffer[..history + n], &self.kernel, dest);
        self.buffer.copy_within(n..n + history, 0);
    }
}

enum Engine {
    Fft { kernel: Fft, conv: FftConvolver },
    Direct(DirectConvolver),
}

/// `ReverbConvolverStage`.
struct Stage {
    engine: Engine,
    accumulation_read_index: usize,
    pre_delay_length: usize,
    post_delay_length: usize,
    pre_read_write_index: usize,
    frames_processed: usize,
    temporary: Vec<f32>,
    pre_delay: Vec<f32>,
}

impl Stage {
    #[allow(clippy::too_many_arguments)]
    fn new(
        ir: &[f32],
        total_latency: usize,
        offset: usize,
        length: usize,
        fft_size: usize,
        render_phase: usize,
        slice: usize,
        scale: f32,
        direct: bool,
    ) -> Self {
        let engine = if !direct {
            let mut kernel = Fft::new(fft_size);
            let mut padded = vec![0.0f32; fft_size];
            padded[..length].copy_from_slice(&ir[offset..offset + length]);
            kernel.forward(&padded);
            if scale != 1.0 {
                kernel.scale(scale);
            }
            Engine::Fft { kernel, conv: FftConvolver::new(fft_size) }
        } else {
            let mut k = vec![0.0f32; fft_size / 2];
            k[..length].copy_from_slice(&ir[..length]);
            if scale != 1.0 {
                let src = k.clone();
                vdsp::vsmul(&src[..length], scale, &mut k[..length]);
            }
            Engine::Direct(DirectConvolver::new(slice, k))
        };
        let mut total_delay = offset + total_latency;
        let half = fft_size / 2;
        if !direct && total_delay >= half {
            total_delay -= half;
        }
        let max_pre = half.min(total_delay);
        let mut pre = if total_delay > 0 { render_phase % max_pre } else { 0 };
        if pre > total_delay {
            pre = 0;
        }
        let post = total_delay - pre;
        let mut buf = if pre < fft_size { fft_size } else { pre };
        if buf < slice {
            buf = slice;
        }
        Stage {
            engine,
            accumulation_read_index: 0,
            pre_delay_length: pre,
            post_delay_length: post,
            pre_read_write_index: 0,
            frames_processed: 0,
            temporary: vec![0.0; slice],
            pre_delay: vec![0.0; buf],
        }
    }

    fn process(&mut self, source: &[f32], acc: &mut Accumulation) {
        let n = source.len();
        let pre = self.pre_delay_length > 0;
        if pre {
            if self.pre_read_write_index + n > self.pre_delay.len() || n > self.temporary.len() {
                return;
            }
        } else if n > self.pre_delay.len() {
            return;
        }
        if self.frames_processed < self.pre_delay_length {
            acc.update_read_index(&mut self.accumulation_read_index, n);
        } else {
            // With a pre-delay the delayed input is in its buffer and the
            // result goes to the temporary buffer; without one, the input is
            // the source and the pre-delay buffer serves as the temporary.
            let at = self.pre_read_write_index;
            let (src, tmp): (&[f32], &mut [f32]) = if pre {
                (&self.pre_delay[at..at + n], &mut self.temporary[..n])
            } else {
                (source, &mut self.pre_delay[..n])
            };
            match &mut self.engine {
                Engine::Direct(d) => d.process(src, tmp),
                Engine::Fft { kernel, conv } => conv.process(kernel, src, tmp),
            }
            acc.accumulate(tmp, &mut self.accumulation_read_index, self.post_delay_length);
        }
        if pre {
            let at = self.pre_read_write_index;
            self.pre_delay[at..at + n].copy_from_slice(source);
            self.pre_read_write_index += n;
            if self.pre_read_write_index >= self.pre_delay_length {
                self.pre_read_write_index = 0;
            }
        }
        self.frames_processed += n;
    }
}

/// `ReverbConvolver`: one channel of the response.
struct ReverbConvolver {
    stages: Vec<Stage>,
    acc: Accumulation,
}

impl ReverbConvolver {
    fn new(ir: &[f32], slice: usize, max_fft: usize, render_phase: usize, scale: f32) -> Self {
        let total = ir.len();
        let mut stages = Vec::new();
        let mut offset = 0;
        let mut i = 0;
        let mut fft_size = MIN_FFT_SIZE;
        while offset < total {
            let mut size = fft_size / 2;
            if size + offset > total {
                size = total - offset;
            }
            let phase = render_phase + i * slice;
            let direct = offset == 0;
            stages.push(Stage::new(ir, 0, offset, size, fft_size, phase, slice, scale, direct));
            offset += size;
            i += 1;
            if !direct {
                fft_size *= 2;
            }
            if fft_size > max_fft {
                fft_size = max_fft;
            }
        }
        ReverbConvolver { stages, acc: Accumulation::new(total + slice) }
    }

    fn process(&mut self, source: &[f32], dest: &mut [f32]) {
        for s in self.stages.iter_mut() {
            s.process(source, &mut self.acc);
        }
        self.acc.read_and_clear(dest);
    }
}

/// `Reverb` with `normalize` false (Space's), or with Chromium's
/// normalisation.
pub struct Reverb {
    convolvers: Vec<ReverbConvolver>,
    response_channels: usize,
    length: usize,
}

impl Reverb {
    /// `new Reverb(response, renderQuantum, kMaxFftSize, false, normalize)`.
    /// Allocates: off the audio thread.
    pub fn new(channels: &[&[f32]], sample_rate: f32, slice: usize, normalize: bool) -> Self {
        let scale = if normalize { normalization_scale(channels, sample_rate) } else { 1.0 };
        let n = channels.len();
        let mut convolvers = Vec::new();
        let mut phase = 0;
        for i in 0..n.max(2) {
            let ch = channels[i.min(n - 1)];
            convolvers.push(ReverbConvolver::new(ch, slice, MAX_FFT_SIZE, phase, scale));
            phase += slice;
        }
        Reverb { convolvers, response_channels: n, length: channels.first().map_or(0, |c| c.len()) }
    }

    /// The response's length in frames (`ImpulseResponseLength`).
    pub fn length(&self) -> usize {
        self.length
    }

    /// The output's channels for `input` channels (`ComputeNumberOfOutputChannels`).
    pub fn output_channels(&self, input: usize) -> usize {
        if input == 1 && self.response_channels == 1 {
            1
        } else {
            2
        }
    }

    /// `Reverb::Process` for one or two input channels and as many outputs
    /// as [`Reverb::output_channels`] gives. True stereo (4) is not ported.
    pub fn process(&mut self, input: &[&[f32]], out: &mut [&mut [f32]]) {
        let (ni, no, nr) = (input.len(), out.len(), self.response_channels);
        if ni == 2 && (nr == 1 || nr == 2) && no == 2 {
            let (l, r) = out.split_at_mut(1);
            self.convolvers[0].process(input[0], l[0]);
            self.convolvers[1].process(input[1], r[0]);
        } else if ni == 1 && no == 2 && nr == 2 {
            for (i, o) in out.iter_mut().enumerate() {
                self.convolvers[i].process(input[0], o);
            }
        } else if ni == 1 && nr == 1 && no == 1 {
            self.convolvers[0].process(input[0], out[0]);
        } else {
            for o in out.iter_mut() {
                o.iter_mut().for_each(|v| *v = 0.0);
            }
        }
    }
}

/// `CalculateNormalizationScale`.
fn normalization_scale(channels: &[&[f32]], sample_rate: f32) -> f32 {
    const GAIN_CALIBRATION: f32 = -58.0;
    const GAIN_CALIBRATION_SAMPLE_RATE: f32 = 44100.0;
    const MIN_POWER: f32 = 0.000125;
    let n = channels.len();
    let length = channels.first().map_or(0, |c| c.len());
    let mut power = 0.0f32;
    for c in channels {
        power += vdsp::svesq(c);
    }
    power = (power / (n * length) as f32).sqrt();
    if !power.is_finite() || power < MIN_POWER {
        power = MIN_POWER;
    }
    let mut scale = 1.0 / power;
    scale *= super::fdlibm::pow(10.0, (GAIN_CALIBRATION * 0.05) as f64) as f32;
    if sample_rate != 0.0 {
        scale *= GAIN_CALIBRATION_SAMPLE_RATE / sample_rate;
    }
    if n == 4 {
        scale *= 0.5;
    }
    scale
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A convolution by a known response, against the sums done plainly.
    #[test]
    fn it_convolves() {
        let mut ir = vec![0.0f32; 3000];
        let mut s = 1u32;
        for v in ir.iter_mut() {
            s = s.wrapping_mul(1664525).wrapping_add(1013904223);
            *v = (s as f32 / 4294967296.0 - 0.5) * 0.1;
        }
        let mut r = Reverb::new(&[&ir], 48000.0, 128, false);
        let mut x = vec![0.0f32; 128 * 40];
        x[5] = 1.0;
        x[700] = -0.5;
        let mut y = vec![0.0f32; x.len()];
        for q in 0..40 {
            let (src, dst) = (&x[q * 128..(q + 1) * 128], &mut y[q * 128..(q + 1) * 128]);
            r.process(&[src], &mut [dst]);
        }
        for t in 0..x.len() {
            let mut want = 0.0f64;
            for (k, h) in ir.iter().enumerate() {
                if t >= k {
                    want += x[t - k] as f64 * *h as f64;
                }
            }
            assert!((y[t] as f64 - want).abs() < 1e-5, "frame {t}: {} against {want}", y[t]);
        }
    }
}
