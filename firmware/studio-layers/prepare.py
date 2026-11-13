from pathlib import Path
import shutil
import sys


source = Path(__file__).resolve().parent
wled = Path(sys.argv[1])


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise SystemExit('Use a fresh checkout of the pinned Gledopto WLED source.')
    return text.replace(old, new)


json_source = wled / 'wled00' / 'json.cpp'
json_text = json_source.read_text()
signature = 'static bool deserializeSegment(JsonObject elem, byte it, byte presetId = 0)'
json_text = replace_once(json_text, signature, '''#ifdef WLED_STUDIO_LAYERS
void readStudioSegment(JsonObject& segment, uint8_t id);
void serializeStudioSegment(JsonObject& segment, uint8_t id);
#endif

''' + signature)
for anchor in (
    '  if (seg.reset && seg.stop == 0) {',
    '  // send UDP/WS if segment options changed (except selection; will also deselect current preset)',
):
    hook = '#ifdef WLED_STUDIO_LAYERS\n  readStudioSegment(elem, id);\n#endif\n'
    if anchor.startswith('  if'):
        hook = '#ifdef WLED_STUDIO_LAYERS\n  if (seg.stop == 0) clearStudioSegment(id);\n#endif\n'
    else:
        hook = hook.replace('  readStudioSegment(elem, id);', '  if (seg.stop != 0) readStudioSegment(elem, id);')
    json_text = replace_once(json_text, anchor, hook + anchor)
anchor = '  root["bm"]  = seg.blendMode;'
json_text = replace_once(json_text, anchor, anchor + '\n#ifdef WLED_STUDIO_LAYERS\n  serializeStudioSegment(root, id);\n#endif')

strip_source = wled / 'wled00' / 'FX_fcn.cpp'
strip_text = strip_source.read_text()
strip_text = replace_once(strip_text, 'void WS2812FX::purgeSegments() {', '''#ifdef WLED_STUDIO_LAYERS
void eraseStudioSegment(unsigned id);
void clearStudioSegments();
#endif

void WS2812FX::purgeSegments() {''')
for indent in ('  ', '    '):
    anchor = '\n' + indent + '_segments.clear();'
    if strip_text.count(anchor) != 1:
        raise SystemExit('Unexpected WLED segment reset code.')
    strip_text = strip_text.replace(anchor, '\n#ifdef WLED_STUDIO_LAYERS\n' + indent + 'clearStudioSegments();\n#endif' + anchor)
for erase in ('_segments.erase(_segments.begin() + i);', '_segments.erase(_segments.begin()+i);'):
    if erase not in strip_text:
        raise SystemExit('Unexpected WLED segment compaction code.')
    strip_text = strip_text.replace(erase, '\n#ifdef WLED_STUDIO_LAYERS\n      eraseStudioSegment(i);\n#endif\n      ' + erase)
anchor = 'void WS2812FX::show() {'
strip_text = replace_once(strip_text, anchor, '''#ifdef WLED_STUDIO_LAYERS
bool isStudioOverlayEffect(uint8_t mode);
#endif

''' + anchor)
anchor = '      blendSegment(seg);              // blend segment\'s buffer into frame buffer'
strip_text = replace_once(strip_text, anchor, '''#ifdef WLED_STUDIO_LAYERS
      if (isStudioOverlayEffect(seg.mode)) continue; // Studio overlays draw in the show callback.
#endif
''' + anchor)

http_source = wled / 'wled00' / 'wled_server.cpp'
http_text = http_source.read_text()
anchor = '    if (root.containsKey("pin")) checkSettingsPIN(root["pin"].as<const char*>());'
http_text = replace_once(http_text, anchor, anchor + '''
#ifdef WLED_STUDIO_LAYERS
    // Store a preset command without applying it or changing the active playlist.
    if (request->url().equals("/json/state") && root.containsKey("psstore")) {
      const int slot = root["psstore"] | 0;
      JsonObject preset = root["preset"].as<JsonObject>();
      if (slot < 1 || slot > 250 || preset.isNull() || preset.size() == 0) {
        releaseJSONBufferLock();
        serveJsonError(request, 400, ERR_JSON);
        return;
      }
      if (!correctPIN && strlen(settingsPIN) > 0) {
        releaseJSONBufferLock();
        serveJsonError(request, 401, ERR_DENIED);
        return;
      }
      extern bool writeStudioPreset(uint8_t slot, JsonObject preset);
      bool saved = writeStudioPreset(slot, preset);
      releaseJSONBufferLock();
      if (saved) request->send(200, CONTENT_TYPE_JSON, F("{\\"success\\":true}"));
      else serveJsonError(request, 500, ERR_FS_GENERAL);
      return;
    }
#endif''')
json_text = replace_once(json_text, 'void readStudioSegment(JsonObject& segment, uint8_t id);',
                         'void readStudioSegment(JsonObject& segment, uint8_t id);\nvoid clearStudioSegment(uint8_t id);')

file_source = wled / 'wled00' / 'file.cpp'
file_text = replace_once(file_source.read_text(), 'static File f;', '''#ifdef WLED_STUDIO_LAYERS
// Initialize the keyed file lock during WLED setup, after the scheduler starts.
static SemaphoreHandle_t studioFileMutex = nullptr;

void initStudioFileLock() {
  studioFileMutex = xSemaphoreCreateRecursiveMutex();
}

class StudioFileLock {
  bool locked = false;
public:
  StudioFileLock() {
    if (studioFileMutex) locked = xSemaphoreTakeRecursive(studioFileMutex, portMAX_DELAY) == pdTRUE;
  }
  ~StudioFileLock() { if (locked) xSemaphoreGiveRecursive(studioFileMutex); }
};

bool studioPresetStoreAvailable() { return studioFileMutex != nullptr; }
#endif
static File f;''')
for signature in (
    'void closeFile() {',
    'bool writeObjectToFile(const char* file, const char* key, const JsonDocument* content)\n{',
    'bool readObjectFromFile(const char* file, const char* key, JsonDocument* dest, const JsonDocument* filter)\n{',
):
    file_text = replace_once(file_text, signature, signature + '''
#ifdef WLED_STUDIO_LAYERS
  StudioFileLock lock;
#endif''')

main_source = wled / 'wled00' / 'wled.cpp'
anchor = '  handleBootLoop(); // check for bootloop and take action (requires WLED_FS)'
main_text = replace_once(main_source.read_text(), anchor, '''#ifdef WLED_STUDIO_LAYERS
  extern void initStudioFileLock();
  initStudioFileLock();
#endif
''' + anchor)

presets_source = wled / 'wled00' / 'presets.cpp'
presets_text = presets_source.read_text()
anchor = '  fdo = pDoc->as<JsonObject>();\n\n  // only reset errorflag'
presets_text = replace_once(presets_text, anchor, '''  fdo = pDoc->as<JsonObject>();
#ifdef WLED_STUDIO_LAYERS
  if ((fdo["ifon"] | false) && bri == 0) {
    releaseJSONBufferLock();
    return;
  }
#endif

  // only reset errorflag''')
anchor = 'void deletePreset(byte index) {'
presets_text = replace_once(presets_text, anchor, '''#ifdef WLED_STUDIO_LAYERS
bool writeStudioPreset(uint8_t slot, JsonObject preset) {
  extern bool studioPresetStoreAvailable();
  if (!studioPresetStoreAvailable()) return false;
  // WLED's keyed file writer expects a JSON document. Allocate only the
  // command being persisted and let the regular file writer update one slot.
  const size_t capacity = preset.memoryUsage() + measureJson(preset) + 128;
  DynamicJsonDocument command(capacity);
  if (!command.set(preset) || command.overflowed()) return false;
  initPresetsFile();
  bool saved = writeObjectToFileUsingId(getPresetsFileName(), slot, &command);
  if (saved) {
    closeFile();
    presetsModifiedTime = toki.second();
    updateFSInfo();
  }
  return saved;
}
#endif

''' + anchor)

shutil.copytree(source / 'usermods' / 'tls_studio', wled / 'usermods' / 'tls_studio')
shutil.copyfile(source / 'platformio_override.ini', wled / 'platformio_override.ini')
for path, contents in ((json_source, json_text), (strip_source, strip_text),
                       (http_source, http_text), (file_source, file_text), (main_source, main_text),
                       (presets_source, presets_text)):
    path.write_text(contents)
