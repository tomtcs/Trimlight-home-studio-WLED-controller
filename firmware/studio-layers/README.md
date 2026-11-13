# Studio Layers for Gledopto WLED 16.0.1

The firmware targets the Gledopto GL-C-618WL and inherits Gledopto's `esp32_eth` build. It adds six Studio effects and stores the Studio layer settings in WLED presets. The controller identifies the build as `16.0.1-tls6`.

## Build

The **Build Studio firmware** GitHub Actions workflow uses the pinned Gledopto source and packages the OTA binary, its SHA-256 checksum, the ESP32 image inspection, and the corresponding source and license. For a local build, install Git, Python, Node.js and PlatformIO, then run these commands from the Studio repository root with a fresh `wled` checkout.

```sh
git clone https://github.com/GLEDOPTO/WLED.git wled
git -C wled checkout 0d4b90840b81a2bac98abcf053a2fa55659c6d45
git -C wled submodule update --init --recursive
python3 firmware/studio-layers/prepare.py wled
cd wled
npm ci
pio run -e gledopto_elite_tls
```

The OTA image is `.pio/build/gledopto_elite_tls/firmware.bin`. Before upgrading, export WLED configuration and presets and save a Studio backup. After upgrading, confirm that WLED reports `16.0.1-tls6` and lists the six Studio effects. `/json/info` includes `studioBoot` with the last reset reason, current app slot and next OTA slot capacity. Re-push Studio looks and re-save the schedule to regenerate WLED presets with the effect IDs for this firmware. Presets created directly in WLED on older firmware may need to be recreated if their effect IDs changed.

## Controller verification

Verify the configured LED outputs, time zone, NTP, and latitude and longitude. Confirm that a layered look renders, survives a preset reload, and starts on the correct weekday at sunset. In WLED 16, sunset timers use hour `254` and sunrise timers use hour `255`.
