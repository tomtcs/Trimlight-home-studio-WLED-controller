// tls_core.h — Trimlight Studio layer engine (portable C++, no WLED / Arduino dependencies).
//
// This is a line-for-line port of the layer + shape engine in the Studio app's builder.js
// (renderShape, wledMap, blendPx, modVal, effOf, renderStackInto), so the roof renders what the
// preview shows. It is compiled on a PC by test/parity to prove that: see test/README in the repo.
//
// Numeric policy: per-pixel math is float (ESP32 has a single-precision FPU); anything that grows
// with uptime (layer clocks, noise coordinates, scroll phase) is kept in double and reduced to a
// small float *before* the per-pixel loop, so long uptimes never lose precision.
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>

namespace tls {

enum { MAX_STOPS = 16, MAX_MODS = 4, MAX_SPOTS = 128 };

enum ShapeType : uint8_t { SH_NONE = 0, SH_FIELD, SH_WAVES, SH_COMETS, SH_GLINTS, SH_NOISE, SH_PULSE };
// Blend codes as sent in segment key "bm" (builder.js BLENDS[*].code). 0 behaves as cover.
enum BlendMode : uint8_t { BM_NONE = 0, BM_COVER, BM_ADD, BM_SCREEN, BM_LIGHTER, BM_REVEAL, BM_TINT, BM_DIM };
// Modulator targets / shapes as sent in "mod" (builder.js MOD_T / MOD_SHAPES order).
enum ModTarget : uint8_t { MT_OPACITY = 0, MT_HUE, MT_POS, MT_SPEED, MT_SIZE, MT_SX, MT_IX, MT_C1, MT_C2, MT_C3 };
enum ModShape : uint8_t { MS_SINE = 0, MS_TRI, MS_UP, MS_DOWN, MS_SQUARE, MS_WANDER };

struct Stop { uint8_t r, g, b, p; };                 // p = position 0..255 (builder.js: [r,g,b,round(pos*255)])
struct Stops { uint8_t n = 0; Stop s[MAX_STOPS]; };
struct Mod { uint8_t target = 0, shape = 0; int16_t depth = 0, phase = 0; uint32_t perMs = 1000; };

// ---------------------------------------------------------------- small helpers
static inline float clampf(float x, float a, float b) { return x < a ? a : (x > b ? b : x); }
static inline float lerpf(float a, float b, float f) { return a + (b - a) * f; }
static inline float fracf(float x) { return x - floorf(x); }
static inline double fracd(double x) { return x - floor(x); }
static inline float maxf(float a, float b) { return a > b ? a : b; }
static inline float minf(float a, float b) { return a < b ? a : b; }
static inline float pingpongf(float x) { x = fracf(x * 0.5f) * 2.0f; return x > 1.0f ? 2.0f - x : x; }
static inline float pingpongd(double x) { float f = (float)(fracd(x * 0.5) * 2.0); return f > 1.0f ? 2.0f - f : f; }

// ---------------------------------------------------------------- hashing / noise (bit-exact with builder.js h2 / vnoise / rng)
static inline float h2(int32_t x, int32_t y, int32_t s) {
  uint32_t h = (uint32_t)x * 374761393u + (uint32_t)y * 668265263u + (uint32_t)s * 2147483647u;
  h = (h ^ (h >> 13)) * 1274126177u;
  return (float)(h ^ (h >> 16)) * (1.0f / 4294967296.0f);
}
// value noise at (xi+fx, yi+fy): integer and fractional parts are passed separately so large time coordinates keep precision
static inline float vn(int32_t xi, float fx, int32_t yi, float fy, int32_t s) {
  float u = fx * fx * (3.0f - 2.0f * fx), v = fy * fy * (3.0f - 2.0f * fy);
  float a = lerpf(h2(xi, yi, s), h2(xi + 1, yi, s), u);
  float b = lerpf(h2(xi, yi + 1, s), h2(xi + 1, yi + 1, s), u);
  return lerpf(a, b, v);
}
static inline int32_t floori(double x) { return (int32_t)(int64_t)floor(x); }
static inline float vnD(double x, double y, int32_t s) {
  int32_t xi = floori(x), yi = floori(y);
  return vn(xi, (float)(x - xi), yi, (float)(y - yi), s);
}
// double-precision twin of vnD, used for modulators (their output scales clocks, so it must not lose bits)
static inline double h2d(int32_t x, int32_t y, int32_t s) {
  uint32_t h = (uint32_t)x * 374761393u + (uint32_t)y * 668265263u + (uint32_t)s * 2147483647u;
  h = (h ^ (h >> 13)) * 1274126177u;
  return (double)(h ^ (h >> 16)) * (1.0 / 4294967296.0);
}
static inline double vnDd(double x, double y, int32_t s) {
  int32_t xi = floori(x), yi = floori(y); double fx = x - xi, fy = y - yi, u = fx * fx * (3.0 - 2.0 * fx), v = fy * fy * (3.0 - 2.0 * fy);
  double a0 = h2d(xi, yi, s), a1 = h2d(xi + 1, yi, s), b0 = h2d(xi, yi + 1, s), b1 = h2d(xi + 1, yi + 1, s);
  double a = a0 + (a1 - a0) * u, b = b0 + (b1 - b0) * u;
  return a + (b - a) * v;
}
struct Rng {   // mulberry32, same as builder.js rng()
  uint32_t a;
  explicit Rng(uint32_t seed = 7) : a(seed) {}
  uint32_t next() { a += 0x6D2B79F5u; uint32_t t = (a ^ (a >> 15)) * (1u | a); t = (t + (t ^ (t >> 7)) * (61u | t)) ^ t; return t ^ (t >> 14); }
  float unit() { return (float)next() * (1.0f / 4294967296.0f); }
};

// ---------------------------------------------------------------- colour stops
static inline void samp(const Stops& st, float x, float out[3]) {
  if (st.n == 0) { out[0] = out[1] = out[2] = 0; return; }
  const Stop* s = st.s; int L = st.n - 1;
  float p0 = s[0].p / 255.0f, pL = s[L].p / 255.0f;
  if (x <= p0) { out[0] = s[0].r; out[1] = s[0].g; out[2] = s[0].b; return; }
  if (x >= pL) { out[0] = s[L].r; out[1] = s[L].g; out[2] = s[L].b; return; }
  for (int k = 0; k < L; k++) {
    float pk1 = s[k + 1].p / 255.0f;
    if (x <= pk1) {
      float pk = s[k].p / 255.0f, f = (x - pk) / maxf(1e-6f, pk1 - pk);
      out[0] = lerpf(s[k].r, s[k + 1].r, f); out[1] = lerpf(s[k].g, s[k + 1].g, f); out[2] = lerpf(s[k].b, s[k + 1].b, f);
      return;
    }
  }
  out[0] = s[L].r; out[1] = s[L].g; out[2] = s[L].b;
}

// ---------------------------------------------------------------- shape parameters (builder.js SHAPES[*].dec)
struct Params {
  // anything that gets multiplied by a (large, growing) clock is double, so phase stays exact after days of uptime
  double speed = 0, period = 6, cycle = 0, scroll = 0, count = 1;
  float width = 40, floorv = 0, tail = 18, head = 2, rate = 6, attack = .5f, hold = .3f, decay = 1.6f, size = 1,
        scale = 16, contrast = 50, roll = 0, repeats = 1;
  uint8_t wshape = 0;      // waves: sine tri saw pulse blob
  uint8_t pshape = 0;      // pulse: breathe beat swell flick
  uint8_t colorBy = 0;     // waves: 0 pos, 1 wave, 2 time    comets: 0 comet, 1 tail
  bool wrapRepeat = false; // field
  bool bounce = false;     // comets
  int ncomets = 3;
};
static inline float u8f(int v) { return (float)v; }
static inline Params decodeShape(ShapeType t, uint8_t sx, uint8_t ix, uint8_t c1, uint8_t c2, uint8_t c3, bool o1, bool o2) {
  Params p;
  switch (t) {
    case SH_FIELD:
      p.scroll = (sx - 128) * 20.0 / 128.0; p.repeats = (ix < 8 ? 8 : ix) / 32.0f; p.wrapRepeat = o1; break;
    case SH_WAVES:
      p.speed = (sx - 128) * 60.0 / 128.0; p.count = (ix < 8 ? 8 : ix) / 16.0f; p.width = 5 + c1 * 95.0f / 255.0f; p.floorv = c2 * 90.0f / 255.0f;
      p.wshape = c3 < 5 ? c3 : 0; p.colorBy = o1 ? 1 : o2 ? 2 : 0; break;
    case SH_COMETS:
      p.speed = (sx - 128) * 80.0 / 128.0; p.tail = (float)(ix < 1 ? 1 : ix); p.head = (float)(c1 < 1 ? 1 : c1 > 6 ? 6 : c1);
      p.ncomets = c3 < 1 ? 1 : c3 > 12 ? 12 : c3; p.bounce = o1; p.colorBy = o2 ? 1 : 0; break;
    case SH_GLINTS:
      p.rate = 0.2f * powf(300.0f, sx / 255.0f); p.decay = (ix < 1 ? 1 : ix) * 10.0f / 255.0f; p.attack = c1 * 6.0f / 255.0f; p.hold = c2 * 6.0f / 255.0f;
      p.size = (float)(c3 < 1 ? 1 : c3 > 5 ? 5 : c3); break;
    case SH_NOISE:
      p.speed = sx / 25.5; p.scale = (float)(ix < 2 ? 2 : ix); p.contrast = c1 * 100.0f / 255.0f; p.floorv = c2 * 90.0f / 255.0f; break;
    case SH_PULSE:
      p.period = 0.3 * pow(200.0, sx / 255.0); p.cycle = ix * 120.0 / 255.0; p.roll = c1 * 100.0f / 255.0f; p.floorv = c2 * 95.0f / 255.0f;
      p.pshape = c3 < 4 ? c3 : 0; break;
    default: break;
  }
  return p;
}

// ---------------------------------------------------------------- shape renderers (builder.js renderShape)
// Comet edges have hard steps (b = 1 inside the head, 0.5 just outside). Where a comet edge lands exactly on a half-pixel
// boundary, float and double can round to opposite sides for one frame. The default (float) is faster on ESP32 and the
// difference is invisible; build with -DTLS_COMET_DOUBLE to run the comet maths in double (used by test/parity to prove that).
#ifdef TLS_COMET_DOUBLE
typedef double CometReal;
#else
typedef float CometReal;
#endif

struct GlintSpot { int32_t i; double t0; float c[3]; };
struct ShapeState {
  double acc = 0; bool seeded = false; Rng rng; GlintSpot* spots = nullptr; int nspots = 0;
  void release() { free(spots); spots = nullptr; nspots = 0; seeded = false; acc = 0; }
};

static inline void putPx(float* out, int i, const float col[3], float b) {
  out[i * 3] = col[0] / 255.0f * b; out[i * 3 + 1] = col[1] / 255.0f * b; out[i * 3 + 2] = col[2] / 255.0f * b;
}

// len = virtual length; clk = this layer's clock (seconds, already advanced); dt = clock step of this frame
static inline void renderShape(ShapeType type, const Params& p, const Stops& st, int len, double clk, double dt, ShapeState& S, uint32_t seed, float* out) {
  float col[3];
  if (len <= 0) return;
  if (type == SH_FIELD) {
    // x = (i - clk*scroll)/len*repeats ; wrap by repeat (frac) or mirror (pingpong)
    double k = (double)p.repeats / len, x0 = -(clk * p.scroll) * k;
    for (int i = 0; i < len; i++) {
      double xd = x0 + i * k;
      float x = p.wrapRepeat ? (float)fracd(xd) : pingpongd(xd);
      samp(st, x, col); putPx(out, i, col, 1.0f);
    }
  } else if (type == SH_WAVES) {
    float w = p.width / 100.0f, fl = p.floorv / 100.0f; double cnt = p.count < 0.25 ? 0.25 : p.count;
    double k = cnt / len, u0 = -(clk * p.speed) * k;
    float tcol = 0; float tsamp[3]; bool timeC = p.colorBy == 2;
    if (timeC) samp(st, pingpongd(clk / 20.0), tsamp);
    (void)tcol;
    float denom = (float)(len - 1 < 1 ? 1 : len - 1); double nwave = ceil(cnt) < 1.0 ? 1.0 : ceil(cnt);   // wave index grows with uptime: keep it in double
    for (int i = 0; i < len; i++) {
      double ud = u0 + i * k; double fu = floor(ud); float ph = (float)(ud - fu), s;
      switch (p.wshape) {
        case 1: s = 1.0f - fabsf(2.0f * ph - 1.0f); break;
        case 2: s = p.speed >= 0 ? 1.0f - ph : ph; break;
        case 3: s = clampf((float)((w - ph) * len / cnt / 1.5 + 0.5), 0, 1); break;
        case 4: { float d = (ph - 0.5f) / (w * 0.32f + 0.01f); s = expf(-d * d); break; }
        default: s = 0.5f - 0.5f * cosf(6.2831853f * ph);
      }
      s = s * s * (3.0f - 2.0f * s) * 0.35f + s * 0.65f;
      if (p.colorBy == 1) samp(st, (float)fracd(fu / nwave + 0.0001), col);
      else if (timeC) { col[0] = tsamp[0]; col[1] = tsamp[1]; col[2] = tsamp[2]; }
      else samp(st, i / denom, col);
      putPx(out, i, col, fl + (1.0f - fl) * s);
    }
  } else if (type == SH_COMETS) {
    int n = p.ncomets < 1 ? 1 : p.ncomets; CometReal tail = p.tail < 1.0f ? 1.0f : p.tail, hd = p.head < 1.0f ? 1.0f : p.head, L = (CometReal)len, invL = (CometReal)1 / L;
    memset(out, 0, sizeof(float) * len * 3);
    for (int k = 0; k < n; k++) {
      double pos; float dir;
      if (p.bounce) {
        double span = len - 1 < 1 ? 1 : len - 1, q = fmod(clk * fabs((double)p.speed) + k * 2.0 * span / n, 2.0 * span);
        if (q < 0) q += 2.0 * span;
        pos = q <= span ? q : 2.0 * span - q; dir = (q <= span ? 1.0f : -1.0f) * (p.speed < 0 ? -1.0f : 1.0f);
        if (p.speed < 0) pos = span - pos;
      } else {
        pos = fmod(clk * p.speed + (double)k * len / n, (double)len); if (pos < 0) pos += len;
        dir = p.speed < 0 ? -1.0f : 1.0f;
      }
      float hc[3]; samp(st, n > 1 ? (float)k / (n - 1) : 0.0f, hc);
      for (int i = 0; i < len; i++) {
        CometReal d = (CometReal)(pos - i) * dir;
        if (!p.bounce) { d -= L * (CometReal)floor(d * invL); if (d > L * 0.5) d -= L; }
        CometReal b = 0;
        if (d >= -hd / 2 && d <= hd / 2) b = 1;
        else if (d > hd / 2 && d < hd / 2 + tail) { CometReal f = 1.0 - (d - hd / 2) / tail; b = f * f; }
        else if (d < -hd / 2 && d > -hd / 2 - 1) b = (1.0 + (d + hd / 2)) * 0.5;
        if (b <= 0) continue;
        const float* c = hc; float tc[3];
        if (p.colorBy == 1) { CometReal tt = (d - hd / 2) / tail; samp(st, (float)(tt < 0 ? 0 : tt > 1 ? 1 : tt), tc); c = tc; }
        float* o = out + i * 3; float bf = (float)b;
        o[0] = maxf(o[0], c[0] / 255.0f * bf); o[1] = maxf(o[1], c[1] / 255.0f * bf); o[2] = maxf(o[2], c[2] / 255.0f * bf);
      }
    }
  } else if (type == SH_GLINTS) {
    if (!S.spots) { S.spots = (GlintSpot*)malloc(sizeof(GlintSpot) * MAX_SPOTS); S.nspots = 0; }
    if (!S.spots) { memset(out, 0, sizeof(float) * len * 3); return; }
    if (!S.seeded) { S.rng = Rng(seed ? seed : 7u); S.seeded = true; }
    S.acc += (double)p.rate * (len / 190.0) * dt;
    while (S.acc >= 1) {
      S.acc -= 1;
      if (S.nspots >= MAX_SPOTS) { memmove(S.spots, S.spots + 1, sizeof(GlintSpot) * (MAX_SPOTS - 1)); S.nspots = MAX_SPOTS - 1; }
      GlintSpot sp; sp.i = (int32_t)(((uint64_t)S.rng.next() * (uint64_t)len) >> 32);   // == floor(unit()*len), exact
      sp.t0 = clk; float u = S.rng.unit(); samp(st, u, sp.c);
      S.spots[S.nspots++] = sp;
    }
    memset(out, 0, sizeof(float) * len * 3);
    float life = p.attack + p.hold + p.decay, half = (p.size - 1.0f) / 2.0f;
    int w = 0;
    for (int r = 0; r < S.nspots; r++) if (clk - S.spots[r].t0 < life) S.spots[w++] = S.spots[r];
    S.nspots = w;
    for (int r = 0; r < S.nspots; r++) {
      const GlintSpot& s = S.spots[r];
      float a = (float)(clk - s.t0), e;
      e = a < p.attack ? a / maxf(1e-3f, p.attack) : a < p.attack + p.hold ? 1.0f : 1.0f - (a - p.attack - p.hold) / p.decay;
      e = clampf(e, 0, 1); e = e * e * (3.0f - 2.0f * e);
      int j0 = (int)floorf(s.i - half - 0.5f), j1 = (int)ceilf(s.i + half + 0.5f);
      for (int j = j0; j <= j1; j++) {
        if (j < 0 || j >= len) continue;
        float f = clampf(1.0f - maxf(0.0f, fabsf(j - (float)s.i) - half), 0, 1) * e;
        if (f <= 0) continue;
        float* o = out + j * 3;
        o[0] = minf(1.0f, o[0] + s.c[0] / 255.0f * f); o[1] = minf(1.0f, o[1] + s.c[1] / 255.0f * f); o[2] = minf(1.0f, o[2] + s.c[2] / 255.0f * f);
      }
    }
  } else if (type == SH_NOISE) {
    float sc = maxf(1.0f, p.scale), k = 1.0f + p.contrast / 18.0f, fl = p.floorv / 100.0f;
    double y1 = clk * p.speed * 0.35, y2 = clk * p.speed * 0.15;
    int32_t y1i = floori(y1), y2i = floori(y2); float y1f = (float)(y1 - y1i), y2f = (float)(y2 - y2i);
    for (int i = 0; i < len; i++) {
      float x1 = i / sc, x2 = i / sc * 0.5f + 40.0f; int32_t x1i = (int32_t)floorf(x1), x2i = (int32_t)floorf(x2);
      float b = vn(x1i, x1 - x1i, y1i, y1f, 3); b = clampf((b - 0.5f) * k + 0.5f, 0, 1);
      float cx = vn(x2i, x2 - x2i, y2i, y2f, 9);
      samp(st, clampf((cx - 0.2f) / 0.6f, 0, 1), col); putPx(out, i, col, fl + (1.0f - fl) * b);
    }
  } else if (type == SH_PULSE) {
    float fl = p.floorv / 100.0f; double per = p.period < 0.1 ? 0.1 : p.period;
    double base = fracd(clk / per);
    double fx1 = (clk * 7.0 / per) * 6.0, fx2 = (clk * 19.0 / per) * 6.0;
    float denom = (float)(len - 1 < 1 ? 1 : len - 1), rollk = (p.roll / 100.0f) / len;
    float ccol[3]; bool cyc = p.cycle > 0; if (cyc) samp(st, pingpongd(clk / p.cycle), ccol);
    for (int i = 0; i < len; i++) {
      float ph = fracf((float)base - rollk * i), s;
      if (p.pshape == 1) {
        float a = (ph - 0.08f) / 0.045f, b = (ph - 0.26f) / 0.05f;
        s = minf(1.0f, expf(-(a * a)) + 0.75f * expf(-(b * b)));
      } else if (p.pshape == 2) s = ph < 0.35f ? powf(ph / 0.35f, 1.6f) : powf(1.0f - (ph - 0.35f) / 0.65f, 2.2f);
      else if (p.pshape == 3) {
        s = 0.62f + 0.38f * (vnD(fx1 + i * 3.1, i * 0.7, 5) * 0.7f + vnD(fx2, (double)i, 6) * 0.3f);
        s = clampf((s - 0.55f) * 2.2f, 0, 1);
      } else s = 0.5f - 0.5f * cosf(6.2831853f * ph);
      if (cyc) { col[0] = ccol[0]; col[1] = ccol[1]; col[2] = ccol[2]; } else samp(st, i / denom, col);
      putPx(out, i, col, fl + (1.0f - fl) * s);
    }
  }
}

// ---------------------------------------------------------------- WLED virtual -> physical mapping (builder.js wledMap)
static inline int virtualLength(int len, int grp, int spc, bool mi) {
  int gl = grp + spc; int VL = (len + gl - 1) / gl; if (mi) VL = (VL + 1) / 2; return VL;
}
// buf (len*3) <- vb (VL*3) using grouping / spacing / reverse / mirror exactly like Segment::setPixelColor
static inline void mapVirtualToPhysical(const float* vb, float* buf, int len, int grp, int spc, bool rev, bool mi) {
  int gl = grp + spc, VL = virtualLength(len, grp, spc, mi);
  memset(buf, 0, sizeof(float) * len * 3);
  for (int vi = 0; vi < VL; vi++) {
    int i = vi * gl;
    if (rev) i = mi ? (len - 1) / 2 - i : (len - 1) - i;
    for (int j = 0; j < grp; j++) {
      int s = i + (rev ? -j : j);
      if (s >= 0 && s < len) {
        memcpy(buf + s * 3, vb + vi * 3, sizeof(float) * 3);
        if (mi) memcpy(buf + (len - 1 - s) * 3, vb + vi * 3, sizeof(float) * 3);
      }
    }
  }
}

// ---------------------------------------------------------------- blends (builder.js blendPx)
static inline float lum3(float r, float g, float b) { return maxf(r, maxf(g, b)); }
static inline void blendPx(uint8_t mode, float* d, const float s[3], float a) {
  float dr = d[0], dg = d[1], db = d[2], r, g, b;
  switch (mode) {
    case BM_ADD: r = minf(1, dr + s[0]); g = minf(1, dg + s[1]); b = minf(1, db + s[2]); break;
    case BM_SCREEN: r = 1 - (1 - dr) * (1 - s[0]); g = 1 - (1 - dg) * (1 - s[1]); b = 1 - (1 - db) * (1 - s[2]); break;
    case BM_LIGHTER: {
      float ls = lum3(s[0], s[1], s[2]), ld = lum3(dr, dg, db);
      if (ls > ld) { r = s[0]; g = s[1]; b = s[2]; } else { r = dr; g = dg; b = db; } break; }
    case BM_REVEAL: { float l = lum3(s[0], s[1], s[2]); r = dr * l; g = dg * l; b = db * l; break; }
    case BM_TINT: {
      float ls = lum3(s[0], s[1], s[2]), ld = lum3(dr, dg, db);
      if (ls < 0.004f) { r = dr; g = dg; b = db; } else { r = s[0] / ls * ld; g = s[1] / ls * ld; b = s[2] / ls * ld; } break; }
    case BM_DIM: { float k = 0.25f + 0.75f * lum3(s[0], s[1], s[2]); r = dr * k; g = dg * k; b = db * k; break; }
    default: r = s[0]; g = s[1]; b = s[2];   // cover (and 0)
  }
  d[0] = dr + (r - dr) * a; d[1] = dg + (g - dg) * a; d[2] = db + (b - db) * a;
}

// ---------------------------------------------------------------- modulators (builder.js modVal / effOf / hueRot)
static inline double modVal(const Mod& m, double t) {
  double per = m.perMs / 1000.0; if (per < 0.05) per = 0.05;
  double ph = fracd(t / per + m.phase / 100.0);
  switch (m.shape) {
    case MS_TRI: return 1 - 4 * fabs(ph - 0.5);
    case MS_UP: return 2 * ph - 1;
    case MS_DOWN: return 1 - 2 * ph;
    case MS_SQUARE: return ph < 0.5 ? 1.0 : -1.0;
    case MS_WANDER: return (vnDd(fmod(t / per * 2.0, 100000.0), 0.0, 17) - 0.5) * 2.6;
    default: return sin(6.2831853 * ph);
  }
}
static inline void hueRot(float deg, float m[9]) {
  float a = deg * 3.14159265358979f / 180.0f, c = cosf(a), s = sinf(a);
  m[0] = .213f + c * .787f - s * .213f; m[1] = .715f - c * .715f - s * .715f; m[2] = .072f - c * .072f + s * .928f;
  m[3] = .213f - c * .213f + s * .143f; m[4] = .715f + c * .285f + s * .140f; m[5] = .072f - c * .072f - s * .283f;
  m[6] = .213f - c * .213f - s * .787f; m[7] = .715f - c * .715f + s * .715f; m[8] = .072f + c * .928f + s * .072f;
}
struct Eff { double op = 1, hue = 0, pos = 0, speed = 1, size = 1; };   // double: these scale clocks and counts
static inline Eff effOf(uint8_t opacity255, const Mod* mods, int nmods, double t) {
  Eff e; e.op = opacity255 / 255.0f;
  for (int k = 0; k < nmods; k++) {
    const Mod& m = mods[k]; double v = modVal(m, t), dp = m.depth / 100.0;
    switch (m.target) {
      case MT_OPACITY: { double o = 1 - dp * (0.5 - 0.5 * v); e.op *= o < 0 ? 0 : (o > 1 ? 1 : o); break; }
      case MT_HUE: e.hue += dp * 180.0 * v; break;
      case MT_POS: e.pos += dp * v; break;
      case MT_SPEED: { double sp = 1 + dp * v; e.speed *= sp < 0 ? 0 : sp; break; }
      case MT_SIZE: { double z = 1 + dp * v; e.size *= z < 0.05 ? 0.05 : z; break; }
      default: break;   // sx/ix/c1/c2/c3 modulation only applies to stock effects (not available in this usermod)
    }
  }
  return e;
}

// ---------------------------------------------------------------- one Studio layer, composited onto comp
struct LayerIn {
  ShapeType type = SH_NONE; uint8_t sx = 0, ix = 0, c1 = 0, c2 = 0, c3 = 0; bool o1 = false, o2 = false;
  Stops stops; Mod mods[MAX_MODS]; uint8_t nmods = 0;
  uint8_t bm = 1, fe = 0, opacity = 255; bool on = true;
  uint16_t len = 0; uint8_t grp = 1, spc = 0; bool rev = false, mi = false; uint8_t slow = 1;
};
struct LayerState { double clk = 0; ShapeState sh; };

// scratch must hold at least 6*len floats. comp points at this layer's first pixel (RGB floats 0..1, len*3).
// tSec = absolute time for modulators; dt = real frame time in seconds (already clamped by the caller).
static inline void compositeStudioLayer(const LayerIn& L, LayerState& S, double tSec, double dt, uint32_t seed, float* scratch, float* comp) {
  const int len = L.len; if (len <= 0 || L.type == SH_NONE) return;
  Eff e = effOf(L.opacity, L.mods, L.nmods, tSec);
  double slow = L.slow < 1 ? 1.0 : (double)L.slow;
  double cdt = dt * e.speed / slow;
  S.clk += cdt;
  if (!L.on) return;                                  // hidden layers still keep their clock moving, like builder.js
  Params p = decodeShape(L.type, L.sx, L.ix, L.c1, L.c2, L.c3, L.o1, L.o2);
  if (e.size != 1.0) { p.count *= e.size; p.tail = (float)(p.tail * e.size); p.size = (float)(p.size * e.size); p.scale = (float)(p.scale * e.size); }   // params flagged `size` in builder.js
  const int grp = L.grp < 1 ? 1 : L.grp, spc = L.spc, gl = grp + spc, VL = virtualLength(len, grp, spc, L.mi);
  float* vb = scratch; float* buf = scratch + (size_t)len * 3;
  renderShape(L.type, p, L.stops, VL, S.clk, cdt, S.sh, seed, vb);
  mapVirtualToPhysical(vb, buf, len, grp, spc, L.rev, L.mi);
  int sh = (int)floor(e.pos * len / 2.0 + 0.5);   // Math.round
  bool rot = fabs(e.hue) > 0.01; float M[9]; if (rot) hueRot((float)e.hue, M);
  for (int i = 0; i < len; i++) {
    int rel = L.rev ? len - 1 - i : i;
    if (gl > 1 && (rel % gl) >= grp) continue;
    int j = (i - sh) % len; if (j < 0) j += len;
    float s[3] = { buf[j * 3], buf[j * 3 + 1], buf[j * 3 + 2] };
    if (rot) {
      float r2 = s[0] * M[0] + s[1] * M[1] + s[2] * M[2], g2 = s[0] * M[3] + s[1] * M[4] + s[2] * M[5], b2 = s[0] * M[6] + s[1] * M[7] + s[2] * M[8];
      s[0] = clampf(r2, 0, 1); s[1] = clampf(g2, 0, 1); s[2] = clampf(b2, 0, 1);
    }
    float a = (float)e.op;
    if (L.fe > 0) a *= clampf(minf(i + 0.5f, len - i - 0.5f) / (float)L.fe, 0, 1);
    if (a <= 0) continue;
    blendPx(L.bm, comp + i * 3, s, a);
  }
}

}  // namespace tls
