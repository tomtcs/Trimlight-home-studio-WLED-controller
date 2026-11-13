#include "wled.h"
#include <atomic>
#include "tls_core.h"

#ifndef TLS_VERSION_TAG
#define TLS_VERSION_TAG "-tls5"
#endif
#define TLS_MAX_SEG 32                   // the app never uses more than 32 segments

// WLED 16 effects render into their segment buffers. Studio draws into the
// final strip buffer after WLED has composed the native effects.
static const char _fx_field[] PROGMEM = "Studio Field@Scroll,Repeats,,,,Repeat ends;;;01;sx=128,ix=32";
static const char _fx_waves[] PROGMEM = "Studio Waves@Speed,Waves,Width,Floor,Shape,Colour per wave,Colour over time;;;01;sx=145,ix=48,c1=100,c2=0,c3=0";
static const char _fx_comets[] PROGMEM = "Studio Comets@Speed,Tail,Head,,Comets,Bounce,Colour head to tail;;;01;sx=150,ix=18,c1=2,c3=3";
static const char _fx_glints[] PROGMEM = "Studio Glints@How many,Fade out,Fade in,Hold,Size;;;01;sx=100,ix=40,c1=25,c2=13,c3=1";
static const char _fx_noise[] PROGMEM = "Studio Noise@Drift,Patch size,Contrast,Floor;;;01;sx=38,ix=16,c1=128,c2=28";
static const char _fx_breathe[] PROGMEM = "Studio Breathe@Cycle,Colour cycle,Roll,Floor,Shape;;;01;sx=150,ix=0,c1=0,c2=64,c3=0";

static void mode_tls_noop() {}

class TlsStudioUsermod : public Usermod {
 private:
  struct Extra {                          // everything the app sends beyond stock WLED, per segment id
    bool have = false;                    // true when the app supplied layer data for this segment
    uint8_t bm = 0, fe = 0, slow = 1;
    tls::Stops stops;
    tls::Mod mods[tls::MAX_MODS]; uint8_t nmods = 0;
  };
  Extra extra[TLS_MAX_SEG];
  tls::LayerState lstate[TLS_MAX_SEG];
  uint32_t sig[TLS_MAX_SEG] = {0};        // effect + geometry signature, to reset shape state when it changes
  uint8_t fxId[7] = {255, 255, 255, 255, 255, 255, 255};

  bool enabled = true;
  std::atomic<uint32_t> resetLayers{0};
  bool initDone = false;
  unsigned long lastMs = 0;

  // compositor buffers (allocated lazily, sized to the strip)
  float* comp = nullptr; float* scratch = nullptr; uint8_t* covered = nullptr; uint16_t bufN = 0; uint16_t scratchLen = 0;

  static const char _name[];

  tls::ShapeType typeOfMode(uint8_t mode) const {
    for (uint8_t t = 1; t <= 6; t++) if (fxId[t] != 255 && fxId[t] == mode) return (tls::ShapeType)t;
    return tls::SH_NONE;
  }

  // ---------------------------------------------------------------- JSON <-> Extra
  void parseExtras(JsonObject s, Extra& x) {
    if (s.containsKey("tlsbm")) x.bm = s["tlsbm"] | 0;
    else if (s.containsKey("bm")) x.bm = s["bm"] | 0;
    if (s.containsKey("fe")) x.fe = (uint8_t)constrain((int)s["fe"], 0, 255);
    if (s.containsKey("slow")) { int v = s["slow"] | 1; x.slow = (uint8_t)constrain(v, 1, 64); }
    if (s["tlc"].is<JsonArray>()) {
      x.stops.n = 0;
      for (JsonVariant e : s["tlc"].as<JsonArray>()) {
        if (x.stops.n >= tls::MAX_STOPS) break;
        JsonArray c = e.as<JsonArray>(); if (c.size() < 4) continue;
        tls::Stop& st = x.stops.s[x.stops.n++];
        st.r = (uint8_t)((int)c[0] & 0xFF); st.g = (uint8_t)((int)c[1] & 0xFF); st.b = (uint8_t)((int)c[2] & 0xFF); st.p = (uint8_t)((int)c[3] & 0xFF);
      }
    }
    if (s["mod"].is<JsonArray>()) {
      x.nmods = 0;
      for (JsonVariant e : s["mod"].as<JsonArray>()) {
        if (x.nmods >= tls::MAX_MODS) break;
        JsonArray m = e.as<JsonArray>(); if (m.size() < 5) continue;
        tls::Mod& d = x.mods[x.nmods++];
        d.target = (uint8_t)((int)m[0] & 0xFF); d.shape = (uint8_t)((int)m[1] & 0xFF);
        d.depth = (int16_t)(int)m[2]; d.phase = (int16_t)(int)m[3]; d.perMs = (uint32_t)((long)m[4] < 50 ? 50 : (long)m[4]);
      }
    }
    x.have = x.bm > 0 || x.stops.n > 0 || x.nmods > 0 || x.fe > 0;
  }
  void writeExtras(JsonObject o, const Extra& x) {
    o["tlsbm"] = x.bm; o["fe"] = x.fe; o["slow"] = x.slow;
    JsonArray t = o.createNestedArray("tlc");
    for (uint8_t i = 0; i < x.stops.n; i++) { JsonArray c = t.createNestedArray(); c.add(x.stops.s[i].r); c.add(x.stops.s[i].g); c.add(x.stops.s[i].b); c.add(x.stops.s[i].p); }
    JsonArray m = o.createNestedArray("mod");
    for (uint8_t i = 0; i < x.nmods; i++) { JsonArray c = m.createNestedArray(); c.add(x.mods[i].target); c.add(x.mods[i].shape); c.add(x.mods[i].depth); c.add(x.mods[i].phase); c.add(x.mods[i].perMs); }
  }
  static bool hasExtraKeys(JsonObject s) {
    return s.containsKey("tlsbm") || s.containsKey("fe") || s.containsKey("tlc") || s.containsKey("mod");
  }

 public:
  // Called with the strip paused, using the ID WLED actually assigned.
  void readSegment(JsonObject s, unsigned id) {
    if (id >= TLS_MAX_SEG) return;
    if (s.containsKey("fx")) extra[id] = Extra();
    if (hasExtraKeys(s)) parseExtras(s, extra[id]);
  }

  void clearSegment(unsigned id) {
    if (id >= TLS_MAX_SEG) return;
    extra[id] = Extra();
    resetLayers.fetch_or(uint32_t(1) << id);
  }

  void eraseSegment(unsigned id) {
    if (id >= TLS_MAX_SEG) return;
    for (unsigned i = id; i + 1 < TLS_MAX_SEG; ++i) extra[i] = extra[i + 1];
    extra[TLS_MAX_SEG - 1] = Extra();
    resetLayers.fetch_or(UINT32_MAX << id);
  }

  void clearSegments() {
    for (auto& segment : extra) segment = Extra();
    resetLayers.store(UINT32_MAX);
  }

  void setup() override {
    fxId[tls::SH_FIELD] = strip.addEffect(255, &mode_tls_noop, _fx_field);
    fxId[tls::SH_WAVES] = strip.addEffect(255, &mode_tls_noop, _fx_waves);
    fxId[tls::SH_COMETS] = strip.addEffect(255, &mode_tls_noop, _fx_comets);
    fxId[tls::SH_GLINTS] = strip.addEffect(255, &mode_tls_noop, _fx_glints);
    fxId[tls::SH_NOISE] = strip.addEffect(255, &mode_tls_noop, _fx_noise);
    fxId[tls::SH_PULSE] = strip.addEffect(255, &mode_tls_noop, _fx_breathe);
    initDone = true;
  }

  void loop() override {}

  void addToSegmentJson(JsonObject& segment, uint8_t id) {
    if (id < TLS_MAX_SEG && extra[id].have) writeExtras(segment, extra[id]);
  }

  void addToJsonInfo(JsonObject& root) override {
    String v = String(versionString);
    if (v.indexOf(TLS_VERSION_TAG) < 0) v += TLS_VERSION_TAG;
    root["ver"] = v;
    root["studioPresetStore"] = true;
  }

  void addToConfig(JsonObject& root) override { JsonObject top = root.createNestedObject(FPSTR(_name)); top["enabled"] = enabled; }
  bool readFromConfig(JsonObject& root) override {
    JsonObject top = root[FPSTR(_name)]; bool ok = !top.isNull();
    ok &= getJsonValue(top["enabled"], enabled, true);
    return ok;
  }

  // ---------------------------------------------------------------- the compositor
  // ASSUMES: handleOverlayDraw() runs once per frame after all segments have drawn and before the buses are shown.
  void handleOverlayDraw() override {
    if (!initDone || (realtimeMode && !realtimeOverride)) return;
    if (!enabled) { releaseRenderMemory(); return; }
    const uint32_t reset = resetLayers.exchange(0);
    for (unsigned i = 0; reset && i < TLS_MAX_SEG; ++i) {
      if (reset & (uint32_t(1) << i)) { lstate[i].sh.release(); lstate[i].clk = 0; sig[i] = 0; }
    }
    const uint16_t N = strip.getLengthTotal(); if (N == 0) return;
    const uint8_t nseg = min((uint8_t)TLS_MAX_SEG, strip.getSegmentsNum());

    // find Studio segments first: nothing to do (and nothing allocated) when the look is a stock one
    bool any = false; uint16_t maxLen = 0;
    for (uint8_t i = 0; i < nseg; i++) {
      Segment& seg = strip.getSegment(i);
      if (seg.isActive() && seg.on && typeOfMode(seg.mode) != tls::SH_NONE) { any = true; uint16_t l = seg.stop - seg.start; if (l > maxLen) maxLen = l; }
    }
    if (!any) { releaseRenderMemory(); return; }

    if (bufN != N || scratchLen < maxLen) {
      free(comp); free(scratch); free(covered);
      comp = (float*)malloc(sizeof(float) * 3 * N); scratch = (float*)malloc(sizeof(float) * 6 * (maxLen > 0 ? maxLen : 1)); covered = (uint8_t*)malloc(N);
      if (!comp || !scratch || !covered) { free(comp); free(scratch); free(covered); comp = scratch = nullptr; covered = nullptr; bufN = 0; scratchLen = 0; return; }
      bufN = N; scratchLen = maxLen;
    }
    memset(comp, 0, sizeof(float) * 3 * N); memset(covered, 0, N);

    const unsigned long now = millis();
    double dt = lastMs ? (now - lastMs) / 1000.0 : 0.0; lastMs = now;
    if (dt > 0.1) dt = 0.1;                                   // same clamp as the preview
    const double tSec = now / 1000.0;

    for (uint8_t i = 0; i < nseg; i++) {                      // segment id order == layer order (bottom first), like the app sends them
      Segment& seg = strip.getSegment(i);
      if (!seg.isActive() || !seg.on) continue;
      const tls::ShapeType type = typeOfMode(seg.mode); if (type == tls::SH_NONE) continue;
      const uint16_t len = seg.stop - seg.start; if (seg.start + len > N) continue;
      const Extra& x = extra[i];

      tls::LayerIn L;
      L.type = type; L.sx = seg.speed; L.ix = seg.intensity; L.c1 = seg.custom1; L.c2 = seg.custom2; L.c3 = seg.custom3; L.o1 = seg.check1; L.o2 = seg.check2;
      L.bm = x.bm ? x.bm : (uint8_t)tls::BM_COVER; L.fe = x.fe; L.slow = x.slow; L.opacity = seg.opacity; L.on = seg.on;
      L.len = len; L.grp = seg.grouping; L.spc = seg.spacing; L.rev = seg.reverse; L.mi = seg.mirror;
      if (x.stops.n) L.stops = x.stops;
      else {                                                   // plain WLED use of a Studio effect: gradient across the segment's three colours
        uint32_t c[3] = { seg.colors[0], seg.colors[1], seg.colors[2] }; L.stops.n = 0;
        for (uint8_t k = 0; k < 3; k++) if (k == 0 || (c[k] & 0xFFFFFF)) { tls::Stop& st = L.stops.s[L.stops.n++]; st.r = R(c[k]); st.g = G(c[k]); st.b = B(c[k]); st.p = 0; }
        if (L.stops.n > 1) for (uint8_t k = 0; k < L.stops.n; k++) L.stops.s[k].p = (uint8_t)(255 * k / (L.stops.n - 1));
      }
      L.nmods = x.nmods; for (uint8_t k = 0; k < x.nmods; k++) L.mods[k] = x.mods[k];

      const uint32_t s = ((uint32_t)type << 24) ^ ((uint32_t)len << 8) ^ ((uint32_t)L.grp << 4) ^ L.spc ^ (L.mi ? 0x80000000u : 0);
      if (sig[i] != s) { sig[i] = s; lstate[i].sh.release(); }  // geometry/effect changed: restart this layer's random/glint state

      for (uint16_t p = seg.start; p < seg.stop; ++p) {
        if (covered[p]) continue;
        const uint32_t rgb = strip.getPixelColorNoMap(p);
        comp[p * 3] = R(rgb) / 255.0f;
        comp[p * 3 + 1] = G(rgb) / 255.0f;
        comp[p * 3 + 2] = B(rgb) / 255.0f;
      }
      tls::compositeStudioLayer(L, lstate[i], tSec, dt, 0x9E3779B1u * (i + 1), scratch, comp + (size_t)seg.start * 3);
      memset(covered + seg.start, 1, len);
    }

    // write the composite (pre-gamma, like any WLED effect; the bus applies gamma and global brightness)
    for (uint16_t p = 0; p < N; p++) {
      if (!covered[p]) continue;
      const float* c = comp + (size_t)p * 3;
      auto q = [](float v) -> uint8_t { v = v * 255.0f + 0.5f; return v <= 0 ? 0 : v >= 255 ? 255 : (uint8_t)v; };
      strip.setPixelColor(p, RGBW32(q(c[0]), q(c[1]), q(c[2]), 0));
    }
  }

  void releaseRenderMemory() {
    if (!comp) return;
    for (unsigned i = 0; i < TLS_MAX_SEG; ++i) {
      lstate[i].sh.release();
      lstate[i].clk = 0;
      sig[i] = 0;
    }
    free(comp); free(scratch); free(covered);
    comp = scratch = nullptr;
    covered = nullptr;
    bufN = scratchLen = 0;
    lastMs = 0;
  }
};

const char TlsStudioUsermod::_name[] PROGMEM = "tls_studio";

static TlsStudioUsermod tls_studio;
REGISTER_USERMOD(tls_studio);

void serializeStudioSegment(JsonObject& segment, uint8_t id) {
  tls_studio.addToSegmentJson(segment, id);
}

void readStudioSegment(JsonObject& segment, uint8_t id) { tls_studio.readSegment(segment, id); }
void clearStudioSegment(uint8_t id) { tls_studio.clearSegment(id); }
void eraseStudioSegment(unsigned id) { tls_studio.eraseSegment(id); }
void clearStudioSegments() { tls_studio.clearSegments(); }
