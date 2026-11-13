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
        hook = '  if (seg.stop == 0) {\n' + hook + '  }\n'
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
presets_source = wled / 'wled00' / 'presets.cpp'
presets_text = presets_source.read_text()
anchor = 'void deletePreset(byte index) {'
presets_text = replace_once(presets_text, anchor, '''#ifdef WLED_STUDIO_LAYERS
bool writeStudioPreset(uint8_t slot, JsonObject preset) {
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
                       (http_source, http_text), (presets_source, presets_text)):
    path.write_text(contents)
