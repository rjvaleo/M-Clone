//! The vDSP routines Chromium's Web Audio calls on a Mac (`vector_math_mac.h`,
//! `fft_frame_mac.cc`), done plainly here, and done by Accelerate itself
//! when the host installs it ([`install`]): on Apple's systems that gives
//! the page's last bits, which an FFT done any other way does not.
//!
//! This crate has no unsafe code, so the binding to Accelerate lives with
//! the host (`engine-mgl`'s `accelerate`), which hands its functions in.
//!
//! Every call is free of allocation and locks: an FFT's setup and scratch
//! are made when its [`Fft`] is, off the audio thread.

use std::sync::OnceLock;

/// Accelerate's routines, as the host binds them. Every slice is as long as
/// the call needs; a split complex array is its real and imaginary halves.
pub struct Backend {
    /// `vDSP_create_fftsetup(log2n, FFT_RADIX2)`, as an opaque handle.
    pub create_fft_setup: fn(log2n: usize) -> usize,
    pub destroy_fft_setup: fn(setup: usize),
    /// `vDSP_ctoz` (data, stride 2) then `vDSP_fft_zrip(.., FFT_FORWARD)`.
    pub forward: fn(setup: usize, log2n: usize, data: &[f32], real: &mut [f32], imag: &mut [f32]),
    /// `vDSP_fft_zrip(.., FFT_INVERSE)` then `vDSP_ztoc` (stride 2).
    pub inverse: fn(setup: usize, log2n: usize, real: &mut [f32], imag: &mut [f32], data: &mut [f32]),
    /// `vDSP_zvmul(a, b, a, n, 1)`.
    pub zvmul: fn(ar: &mut [f32], ai: &mut [f32], br: &[f32], bi: &[f32]),
    /// `vDSP_conv(source, 1, &filter.last, -1, dest, 1, n, filter.len)`.
    pub conv: fn(source: &[f32], filter: &[f32], dest: &mut [f32]),
    /// `vDSP_vsmul`.
    pub vsmul: fn(source: &[f32], scale: f32, dest: &mut [f32]),
    /// `vDSP_vadd(a, dest, dest)`.
    pub vadd_into: fn(a: &[f32], dest: &mut [f32]),
    /// `vDSP_svesq`.
    pub svesq: fn(a: &[f32]) -> f32,
}

static BACKEND: OnceLock<&'static Backend> = OnceLock::new();

/// Use Accelerate's routines from now on (once; later calls are ignored).
/// FFTs made before it keep their plain ones.
pub fn install(b: &'static Backend) {
    let _ = BACKEND.set(b);
}

fn backend() -> Option<&'static Backend> {
    BACKEND.get().copied()
}

/// `vector_math::Vsmul`: `dest[i] = source[i] * scale`.
pub fn vsmul(source: &[f32], scale: f32, dest: &mut [f32]) {
    match backend() {
        Some(b) => (b.vsmul)(source, scale, dest),
        None => {
            for (d, s) in dest.iter_mut().zip(source) {
                *d = *s * scale;
            }
        }
    }
}

/// `vector_math::Vsmul` in place: one rounded product an element, the same
/// whoever does it.
pub fn vsmul_in_place(data: &mut [f32], scale: f32) {
    data.iter_mut().for_each(|v| *v *= scale);
}

/// `vector_math::Vadd`: `dest[i] = a[i] + dest[i]`.
pub fn vadd_into(a: &[f32], dest: &mut [f32]) {
    match backend() {
        Some(b) => (b.vadd_into)(a, dest),
        None => {
            for (d, s) in dest.iter_mut().zip(a) {
                *d = *s + *d;
            }
        }
    }
}

/// `vector_math::Vsvesq`: the sum of squares.
pub fn svesq(a: &[f32]) -> f32 {
    match backend() {
        Some(b) => (b.svesq)(a),
        None => a.iter().map(|v| v * v).sum(),
    }
}

/// `vector_math::Conv` as Chromium calls it: `filter` reversed, a
/// convolution of `source` (`filter.len() - 1 + n` samples) into `dest` (n).
pub fn conv(source: &[f32], filter: &[f32], dest: &mut [f32]) {
    match backend() {
        Some(b) => (b.conv)(source, filter, dest),
        None => {
            let p = filter.len();
            for (i, d) in dest.iter_mut().enumerate() {
                let mut s = 0.0f32;
                for k in 0..p {
                    s += source[i + k] * filter[p - 1 - k];
                }
                *d = s;
            }
        }
    }
}

/// `vector_math::Zvmul`: complex multiply, split arrays, `a *= b`.
pub fn zvmul(ar: &mut [f32], ai: &mut [f32], br: &[f32], bi: &[f32]) {
    match backend() {
        Some(b) => (b.zvmul)(ar, ai, br, bi),
        None => {
            for i in 0..ar.len().min(ai.len()).min(br.len()).min(bi.len()) {
                let (r, im) = (ar[i] * br[i] - ai[i] * bi[i], ar[i] * bi[i] + ai[i] * br[i]);
                ar[i] = r;
                ai[i] = im;
            }
        }
    }
}

/// `FFTFrame` (`fft_frame_mac.cc`): a real FFT of `size` points, its result
/// packed as vDSP packs it (bin 0's real part in `real[0]`, the Nyquist
/// bin's in `imag[0]`), scaled as Chromium scales it.
pub struct Fft {
    pub size: usize,
    log2: usize,
    pub real: Vec<f32>,
    pub imag: Vec<f32>,
    /// Accelerate's setup, or the plain FFT's scratch.
    setup: Option<(usize, &'static Backend)>,
    scratch: (Vec<f64>, Vec<f64>),
}

impl Drop for Fft {
    fn drop(&mut self) {
        if let Some((s, b)) = self.setup {
            (b.destroy_fft_setup)(s);
        }
    }
}

impl Fft {
    /// Allocates: make it off the audio thread.
    pub fn new(size: usize) -> Self {
        let log2 = size.trailing_zeros() as usize;
        assert_eq!(1 << log2, size);
        let setup = backend().map(|b| ((b.create_fft_setup)(log2), b));
        let scratch = if setup.is_some() { (Vec::new(), Vec::new()) } else { (vec![0.0; size], vec![0.0; size]) };
        Fft { size, log2, real: vec![0.0; size / 2], imag: vec![0.0; size / 2], setup, scratch }
    }

    /// `PlatformDoFFT`: `data` (size samples) into the frame, then × 0.5.
    pub fn forward(&mut self, data: &[f32]) {
        let half = self.size / 2;
        match self.setup {
            Some((s, b)) => (b.forward)(s, self.log2, &data[..self.size], &mut self.real, &mut self.imag),
            None => plain::forward(&data[..self.size], &mut self.real, &mut self.imag, &mut self.scratch.0, &mut self.scratch.1),
        }
        vsmul_in_place(&mut self.real[..half], 0.5);
        vsmul_in_place(&mut self.imag[..half], 0.5);
    }

    /// `PlatformDoInverseFFT`: the frame into `data` (size samples), × 1/size.
    /// The frame is used up.
    pub fn inverse(&mut self, data: &mut [f32]) {
        match self.setup {
            Some((s, b)) => (b.inverse)(s, self.log2, &mut self.real, &mut self.imag, &mut data[..self.size]),
            None => plain::inverse(&self.real, &self.imag, &mut data[..self.size], &mut self.scratch.0, &mut self.scratch.1),
        }
        vsmul_in_place(&mut data[..self.size], 1.0 / self.size as f32);
    }

    /// `FFTFrame::Multiply`: by another frame, its packed DC and Nyquist apart.
    pub fn multiply(&mut self, other: &Fft) {
        let half = self.size / 2;
        let (r0, i0) = (self.real[0], self.imag[0]);
        zvmul(&mut self.real[..half], &mut self.imag[..half], &other.real[..half], &other.imag[..half]);
        self.real[0] = r0 * other.real[0];
        self.imag[0] = i0 * other.imag[0];
    }

    /// `FFTFrame::ScaleFFT`.
    pub fn scale(&mut self, factor: f32) {
        let half = self.size / 2;
        vsmul_in_place(&mut self.real[..half], factor);
        vsmul_in_place(&mut self.imag[..half], factor);
    }
}

/// vDSP's real FFT done here (its packing and its factor of 2): an in-place
/// radix-2 FFT in double, in the frame's own scratch.
mod plain {
    use core::f64::consts::PI;

    /// An n-point complex FFT in place (`sign` -1 forward, +1 inverse),
    /// unnormalised.
    fn fft(re: &mut [f64], im: &mut [f64], sign: f64) {
        let n = re.len();
        let mut j = 0;
        for i in 1..n {
            let mut bit = n >> 1;
            while j & bit != 0 {
                j ^= bit;
                bit >>= 1;
            }
            j |= bit;
            if i < j {
                re.swap(i, j);
                im.swap(i, j);
            }
        }
        let mut len = 2;
        while len <= n {
            let a = sign * 2.0 * PI / len as f64;
            let (wr, wi) = (a.cos(), a.sin());
            for start in (0..n).step_by(len) {
                let (mut cr, mut ci) = (1.0, 0.0);
                for k in 0..len / 2 {
                    let (ur, ui) = (re[start + k], im[start + k]);
                    let (xr, xi) = (re[start + k + len / 2], im[start + k + len / 2]);
                    let (vr, vi) = (xr * cr - xi * ci, xr * ci + xi * cr);
                    re[start + k] = ur + vr;
                    im[start + k] = ui + vi;
                    re[start + k + len / 2] = ur - vr;
                    im[start + k + len / 2] = ui - vi;
                    let t = cr * wr - ci * wi;
                    ci = cr * wi + ci * wr;
                    cr = t;
                }
            }
            len <<= 1;
        }
    }

    /// zrip forward: 2 × the DFT, packed.
    pub fn forward(data: &[f32], real: &mut [f32], imag: &mut [f32], re: &mut [f64], im: &mut [f64]) {
        let half = real.len();
        let n = half * 2;
        for t in 0..n {
            re[t] = data[t] as f64;
            im[t] = 0.0;
        }
        fft(&mut re[..n], &mut im[..n], -1.0);
        for k in 0..half {
            real[k] = (2.0 * re[k]) as f32;
            imag[k] = (2.0 * im[k]) as f32;
        }
        imag[0] = (2.0 * re[half]) as f32;
    }

    /// zrip inverse of a packed half spectrum: the unnormalised inverse DFT
    /// of the whole spectrum it stands for.
    pub fn inverse(real: &[f32], imag: &[f32], data: &mut [f32], re: &mut [f64], im: &mut [f64]) {
        let half = real.len();
        let n = half * 2;
        re[0] = real[0] as f64;
        im[0] = 0.0;
        re[half] = imag[0] as f64;
        im[half] = 0.0;
        for k in 1..half {
            re[k] = real[k] as f64;
            im[k] = imag[k] as f64;
            re[n - k] = real[k] as f64;
            im[n - k] = -(imag[k] as f64);
        }
        fft(&mut re[..n], &mut im[..n], 1.0);
        for t in 0..n {
            data[t] = re[t] as f32;
        }
    }
}
