// Chromium's band-limited tables for the four built-in oscillator shapes, as a
// Mac makes them: `PeriodicWaveImpl::GenerateBasicWaveform` and
// `CreateBandLimitedTables` (periodic_wave.cc, Chromium 151) with the inverse
// FFT of `fft_frame_mac.cc` (Accelerate's vDSP_fft_zrip). Run on a Mac:
//
//   cc -O1 -ffp-contract=off chromium_mac_waves.c -framework Accelerate -o w
//   ./w ../data/chromium_mac_waves_4096.bin
//
// The file: "CW4096\0\0", the number of distinct tables (u32), then for each
// shape (sine, square, sawtooth, triangle) and each of its 36 ranges the
// index of its table (u32), then the tables (4096 f32 each), little-endian.
#include <Accelerate/Accelerate.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define N 4096
#define HALF (N / 2)
#define LOG2N 12
#define RANGES 36

static float tables[4 * RANGES][N];
static unsigned index_of[4 * RANGES];
static unsigned distinct;
static float out[4 * RANGES][N];

static unsigned partials_for_range(unsigned range) {
  float cents_to_cull = range * (1200.0f / 3);
  float culling_scale = pow(2, -cents_to_cull / 1200);
  return (unsigned)(culling_scale * (float)HALF);
}

int main(int argc, char **argv) {
  FFTSetup setup = vDSP_create_fftsetup(LOG2N, FFT_RADIX2);
  static float re[HALF], im[HALF], real_data[HALF], imag_data[HALF];
  for (int shape = 0; shape < 4; shape++) {
    real_data[0] = 0; imag_data[0] = 0;
    for (unsigned n = 1; n < HALF; n++) {
      float pi_factor = 2 / (n * (float)M_PI);
      float b = 0;
      switch (shape) {
        case 0: b = (n == 1) ? 1 : 0; break;
        case 1: b = (n & 1) ? 2 * pi_factor : 0; break;
        case 2: b = pi_factor * ((n & 1) ? 1 : -1); break;
        case 3: b = (n & 1) ? 2 * (pi_factor * pi_factor) * ((((n - 1) >> 1) & 1) ? -1 : 1) : 0; break;
      }
      real_data[n] = 0; imag_data[n] = b;
    }
    float normalization_scale = 0.5f;
    unsigned components = HALF;
    for (unsigned range = 0; range < RANGES; range++) {
      float scale = N;
      vDSP_vsmul(real_data, 1, &scale, re, 1, components);
      scale = -scale;
      vDSP_vsmul(imag_data, 1, &scale, im, 1, components);
      unsigned partials = partials_for_range(range);
      for (unsigned i = (components < partials + 1 ? components : partials + 1); i < HALF; i++) { re[i] = 0; im[i] = 0; }
      re[0] = 0; im[0] = 0;
      DSPSplitComplex frame = { re, im };
      float *data = tables[shape * RANGES + range];
      vDSP_fft_zrip(setup, &frame, 1, LOG2N, FFT_INVERSE);
      vDSP_ztoc(&frame, 1, (DSPComplex *)data, 2, HALF);
      float s = 1.0f / N;
      vDSP_vsmul(data, 1, &s, data, 1, N);
      if (!range) {
        float max_value;
        vDSP_maxmgv(data, 1, &max_value, N);
        if (max_value) normalization_scale = 1.0f / max_value;
      }
      vDSP_vsmul(data, 1, &normalization_scale, data, 1, N);
    }
  }
  for (unsigned t = 0; t < 4 * RANGES; t++) {
    unsigned k;
    for (k = 0; k < distinct; k++) if (!memcmp(out[k], tables[t], sizeof(float) * N)) break;
    if (k == distinct) memcpy(out[distinct++], tables[t], sizeof(float) * N);
    index_of[t] = k;
  }
  FILE *f = fopen(argv[1], "wb");
  fwrite("CW4096\0\0", 1, 8, f);
  fwrite(&distinct, 4, 1, f);
  fwrite(index_of, 4, 4 * RANGES, f);
  fwrite(out, sizeof(float) * N, distinct, f);
  fclose(f);
  printf("%u distinct tables\n", distinct);
  return 0;
}
