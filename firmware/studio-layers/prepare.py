from pathlib import Path
import shutil
import sys


source = Path(__file__).resolve().parent
wled = Path(sys.argv[1])
json_source = wled / 'wled00' / 'json.cpp'
original = json_source.read_text()
signature = 'static void serializeSegment(JsonObject& root, const Segment& seg, byte id, bool forPreset, bool segmentBounds)'
hook = '  root["bm"]  = seg.blendMode;'
if original.count(signature) != 1 or original.count(hook) != 1 or 'serializeStudioSegment' in original:
    raise SystemExit('Use a fresh checkout of the pinned Gledopto WLED source.')

shutil.copytree(source / 'usermods' / 'tls_studio', wled / 'usermods' / 'tls_studio')
shutil.copyfile(source / 'platformio_override.ini', wled / 'platformio_override.ini')
updated = original.replace(signature, '#ifdef WLED_STUDIO_LAYERS\nvoid serializeStudioSegment(JsonObject& segment, uint8_t id);\n#endif\n\n' + signature)
updated = updated.replace(hook, hook + '\n#ifdef WLED_STUDIO_LAYERS\n  serializeStudioSegment(root, id);\n#endif')
json_source.write_text(updated)
