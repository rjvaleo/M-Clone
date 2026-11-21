//! A `PeriodicWave`: band-limited tables, three per octave, and how a
//! frequency picks the two it reads (`periodic_wave.cc`).
//!
//! On a Mac Chromium makes the tables with Accelerate's FFT
//! (`vDSP_fft_zrip`), whose rounding cannot be followed off a Mac. The four
//! built-in shapes are therefore Chromium's own tables, made once by
//! `tools/chromium_mac_waves.c` with that FFT and kept in
//! `data/chromium_mac_waves_4096.bin` (sample rates above 24 kHz and up to
//! 88.2 kHz, where a table has 4096 entries). A custom wave
//! (`createPeriodicWave`) is made here with a double-precision inverse FFT:
//! its entries agree with Chromium's to about one part in ten million.

use super::apple::log2f;
use crate::webaudio::{partials_for_range, Ifft};

const MAC_TABLES: &[u8] = include_bytes!("../../data/chromium_mac_waves_4096.bin");

/// The built-in shapes, in Chromium's `OscillatorType` order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shape {
    Sine = 0,
    Square = 1,
    Sawtooth = 2,
    Triangle = 3,
}

/// `PeriodicWaveImpl`.
pub struct Wave {
    size: usize,
    ranges: usize,
    /// `ranges` tables of `size` entries, one after another; or, for a wave
    /// made on demand, its slots.
    tables: Vec<f32>,
    rate_scale: f32,
    lowest: f32,
    inv_lowest: f32,
    lazy: Option<Lazy>,
}

/// A custom wave whose tables are made when a note first needs them, into a
/// few slots, so a wave can be given new coefficients while playing.
struct Lazy {
    re: Vec<f32>,
    im: Vec<f32>,
    components: usize,
    scale: f32,
    slot_range: Vec<usize>,
    slot_used: Vec<u64>,
    tick: u64,
    fft: Ifft,
}

const EMPTY: usize = usize::MAX;

/// `PeriodicWaveSize`.
pub fn wave_size(sample_rate: f32) -> usize {
    if sample_rate <= 24000.0 {
        2048
    } else if sample_rate <= 88200.0 {
        4096
    } else {
        16384
    }
}

impl Wave {
    fn empty(sample_rate: f32) -> Self {
        let size = wave_size(sample_rate);
        let nyquist = (0.5 * sample_rate as f64) as f32;
        let lowest = nyquist / (size / 2) as f32;
        Wave {
            size,
            ranges: (0.5 + 3.0 * log2f(size as f32)) as usize,
            tables: Vec::new(),
            rate_scale: size as f32 / sample_rate,
            lowest,
            inv_lowest: 1.0 / lowest,
            lazy: None,
        }
    }

    /// A custom wave of up to `components` coefficients whose tables are made
    /// on demand into `slots` slots. Allocates; give it coefficients with
    /// [`Wave::set_custom`], which does not. Silent until then.
    pub fn lazy(sample_rate: f32, components: usize, slots: usize) -> Self {
        let mut wave = Self::empty(sample_rate);
        let slots = slots.clamp(2, wave.ranges);
        wave.tables = vec![0.0; slots * wave.size];
        wave.lazy = Some(Lazy {
            re: vec![0.0; components.max(2)],
            im: vec![0.0; components.max(2)],
            components: 0,
            scale: 0.5,
            slot_range: vec![EMPTY; slots],
            slot_used: vec![0; slots],
            tick: 0,
            fft: Ifft::new(wave.size),
        });
        wave
    }

    /// New coefficients for a lazy wave (`createPeriodicWave(real, imag)`):
    /// its normalisation is taken from its fullest table, as Chromium takes
    /// it, and every table is made again when next needed. No allocation.
    pub fn set_custom(&mut self, real: &[f32], imag: &[f32]) {
        let size = self.size;
        let Some(l) = self.lazy.as_mut() else { return };
        let n = real.len().min(imag.len()).min(l.re.len()).min(size / 2);
        l.re[..n].copy_from_slice(&real[..n]);
        l.im[..n].copy_from_slice(&imag[..n]);
        if n > 0 {
            l.re[0] = 0.0;
            l.im[0] = 0.0;
        }
        l.components = n;
        l.slot_range.iter_mut().for_each(|r| *r = EMPTY);
        // The fullest table, in the first slot, for its peak.
        let end = n.min(partials_for_range(0, size) + 1);
        let table = &mut self.tables[..size];
        l.fft.table(&l.re[..n.max(1)], &l.im[..n.max(1)], end.max(1), None, table);
        let max = table.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        l.scale = if max != 0.0 { 1.0 / max } else { 0.5 };
    }

    /// Whether the tables are made on demand.
    pub fn is_lazy(&self) -> bool {
        self.lazy.is_some()
    }

    /// Make sure `range`'s table is in a slot (a lazy wave), never into a
    /// slot holding one of `keep`.
    pub fn ensure(&mut self, range: usize, keep: &[usize]) {
        let size = self.size;
        let Some(l) = self.lazy.as_mut() else { return };
        let range = range.min(self.ranges - 1);
        l.tick += 1;
        if let Some(slot) = l.slot_range.iter().position(|&r| r == range) {
            l.slot_used[slot] = l.tick;
            return;
        }
        let slot = (0..l.slot_range.len())
            .filter(|&s| !keep.contains(&l.slot_range[s]))
            .min_by_key(|&s| if l.slot_range[s] == EMPTY { 0 } else { l.slot_used[s] })
            .unwrap_or(0);
        let end = l.components.min(partials_for_range(range, size) + 1);
        let table = &mut self.tables[slot * size..(slot + 1) * size];
        if l.components == 0 {
            table.iter_mut().for_each(|v| *v = 0.0);
        } else {
            l.fft.table(&l.re[..l.components], &l.im[..l.components], end.max(1), None, table);
            let scale = l.scale;
            table.iter_mut().for_each(|v| *v *= scale);
        }
        l.slot_range[slot] = range;
        l.slot_used[slot] = l.tick;
    }

    /// A built-in shape: Chromium's Mac tables where they apply, else made
    /// here as a custom wave is.
    pub fn basic(shape: Shape, sample_rate: f32) -> Self {
        let mut wave = Self::empty(sample_rate);
        if wave.size == 4096 && MAC_TABLES.len() >= 8 + 4 + 4 * 4 * 36 && &MAC_TABLES[..6] == b"CW4096" && wave.ranges == 36 {
            let word = |at: usize| u32::from_le_bytes([MAC_TABLES[at], MAC_TABLES[at + 1], MAC_TABLES[at + 2], MAC_TABLES[at + 3]]);
            let index_at = 12;
            let data_at = index_at + 4 * 4 * 36;
            wave.tables = Vec::with_capacity(36 * 4096);
            for range in 0..36 {
                let t = word(index_at + 4 * (shape as usize * 36 + range)) as usize;
                let start = data_at + t * 4096 * 4;
                for k in 0..4096 {
                    let at = start + 4 * k;
                    wave.tables.push(f32::from_bits(word(at)));
                }
            }
            return wave;
        }
        let half = wave.size / 2;
        let mut imag = vec![0.0f32; half];
        for (n, b) in imag.iter_mut().enumerate().skip(1) {
            *b = crate::webaudio::basic_coefficient(
                match shape {
                    Shape::Sine => crate::webaudio::BasicShape::Sine,
                    Shape::Square => crate::webaudio::BasicShape::Square,
                    Shape::Sawtooth => crate::webaudio::BasicShape::Sawtooth,
                    Shape::Triangle => crate::webaudio::BasicShape::Triangle,
                },
                n,
            );
        }
        let real = vec![0.0f32; half];
        wave.build(&real, &imag);
        wave
    }

    /// `createPeriodicWave(real, imag)`, normalised.
    pub fn custom(real: &[f32], imag: &[f32], sample_rate: f32) -> Self {
        let mut wave = Self::empty(sample_rate);
        wave.build(real, imag);
        wave
    }

    /// `CreateBandLimitedTables`, with a double-precision inverse FFT.
    fn build(&mut self, real: &[f32], imag: &[f32]) {
        let size = self.size;
        let half = size / 2;
        let components = real.len().min(imag.len()).min(half);
        let mut re = vec![0.0f32; half];
        let mut im = vec![0.0f32; half];
        re[..components].copy_from_slice(&real[..components]);
        im[..components].copy_from_slice(&imag[..components]);
        re[0] = 0.0;
        im[0] = 0.0;
        let mut fft = Ifft::new(size);
        self.tables = vec![0.0; self.ranges * size];
        let mut scale = 0.5f32;
        for range in 0..self.ranges {
            let end = components.min(partials_for_range(range, size) + 1);
            let table = &mut self.tables[range * size..(range + 1) * size];
            fft.table(&re, &im, end.max(1), None, table);
            if range == 0 {
                let max = table.iter().fold(0.0f32, |m, v| m.max(v.abs()));
                if max != 0.0 {
                    scale = 1.0 / max;
                }
            }
            table.iter_mut().for_each(|v| *v *= scale);
        }
    }

    pub fn size(&self) -> usize {
        self.size
    }

    pub fn ranges(&self) -> usize {
        self.ranges
    }

    /// `RateScale`: table entries per sample per hertz.
    pub fn rate_scale(&self) -> f32 {
        self.rate_scale
    }

    pub fn table(&self, range: usize) -> &[f32] {
        let slot = match &self.lazy {
            None => range,
            // Made by `ensure` before the quantum is read.
            Some(l) => l.slot_range.iter().position(|&r| r == range).unwrap_or(0),
        };
        &self.tables[slot * self.size..(slot + 1) * self.size]
    }

    /// The scalar `WaveDataForFundamentalFrequency`: (fuller table, sparser
    /// table, factor between them).
    pub fn select(&self, frequency: f32) -> (usize, usize, f32) {
        let f = frequency.abs();
        let ratio = if f > 0.0 { f / self.lowest } else { 0.5 };
        let cents = log2f(ratio) * 1200.0;
        let mut pitch = 1.0 + cents / 400.0f32;
        pitch = pitch.max(0.0);
        pitch = pitch.min((self.ranges - 1) as f32);
        let r1 = pitch as usize;
        let r2 = if r1 < self.ranges - 1 { r1 + 1 } else { r1 };
        (r1, r2, pitch - r1 as f32)
    }

    /// The NEON `WaveDataForFundamentalFrequency`, four at a time: it
    /// multiplies by reciprocals where the scalar one divides.
    pub fn select4(&self, frequency: [f32; 4]) -> [(usize, usize, f32); 4] {
        let mut out = [(0, 0, 0.0); 4];
        for (k, f) in frequency.iter().enumerate() {
            let f = f.abs();
            let ratio = if f > 0.0 { f * self.inv_lowest } else { 0.5 };
            let cents = log2f(ratio) * 1200.0;
            let mut pitch = 1.0 + cents * (1.0f32 / 400.0);
            pitch = if pitch > 0.0 { pitch } else { 0.0 };
            let top = (self.ranges - 1) as f32;
            pitch = if pitch < top { pitch } else { top };
            let r1 = pitch as u32 as usize;
            let r2 = (r1 + 1).min(self.ranges - 1);
            out[k] = (r1, r2, pitch - r1 as f32);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_mac_tables_are_chromiums_shapes() {
        for shape in [Shape::Sine, Shape::Square, Shape::Sawtooth, Shape::Triangle] {
            let mac = Wave::basic(shape, 48000.0);
            let mut ours = Wave::empty(48000.0);
            let half = ours.size / 2;
            let mut imag = vec![0.0f32; half];
            for (n, b) in imag.iter_mut().enumerate().skip(1) {
                *b = crate::webaudio::basic_coefficient(
                    [
                        crate::webaudio::BasicShape::Sine,
                        crate::webaudio::BasicShape::Square,
                        crate::webaudio::BasicShape::Sawtooth,
                        crate::webaudio::BasicShape::Triangle,
                    ][shape as usize],
                    n,
                );
            }
            ours.build(&vec![0.0; half], &imag);
            assert_eq!(mac.tables.len(), ours.tables.len());
            let worst = mac.tables.iter().zip(&ours.tables).fold(0.0f32, |m, (a, b)| m.max((a - b).abs()));
            assert!(worst < 2e-6, "{shape:?}: the computed tables are {worst} from Chromium's");
        }
    }
}
