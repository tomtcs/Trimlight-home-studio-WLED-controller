# Studio firmware downloads

**WLED 16.0.1-tls6** is an OTA update for the **Gledopto GL-C-618WL** (ESP32 Ethernet, 4 MB flash). Use the WLED firmware update page to upload the `.bin` file. Export your WLED configuration and presets before updating.

- [Download the TLS6 OTA binary](https://raw.githubusercontent.com/tomtcs/Trimlight-home-studio-WLED-controller/main/firmware/WLED_16.0.1-tls6_ESP32_Ethernet.bin)
- [SHA-256 checksum](SHA256SUMS)
- [Build and controller verification instructions](studio-layers/README.md)

This build modifies Gledopto WLED with Studio layer effects, preset handling, and boot diagnostics. It was built on November 12, 2026 (U.S. Eastern time). Copyright © 2016–present Christian Schwinne and individual WLED contributors. The firmware is licensed under the [EUPL v1.2 or later](WLED-LICENSE).

The corresponding source is available at the pinned [Gledopto WLED revision](https://github.com/GLEDOPTO/WLED/tree/0d4b90840b81a2bac98abcf053a2fa55659c6d45) and the [Studio firmware revision](https://github.com/tomtcs/Trimlight-home-studio-WLED-controller/tree/cd7cc4900fc347e6321c1e8a627398246a0136c7/firmware/studio-layers). The [build run](https://github.com/tomtcs/Trimlight-home-studio-WLED-controller/actions/runs/43359815417) recorded the ESP32 image validation.
