# Trimlight Home Studio · WLED Edition

A WLED-focused lighting interface for configuring output channels, previewing effects, and sending looks to a WLED controller.

## Run locally

Use <code>docker compose up -d --build</code> and open <http://localhost:8080>. In **Wiring &amp; setup**, choose **Real WLED controller**, enter its IP address or <code>.local</code> hostname, then select **Test connection**. Review the detected output channels, LED counts, and color order. Choose the controller's 2-, 4-, or 6-channel capacity; the number of configured outputs may be lower. Use **Map each house side** to upload elevation photos, trace roof edges or ridges, and toggle wire-only links. **Manage elevations** lets each installation add, rename, or remove house sides. Once setup is saved, the selected elevation photo and traced paths are used in the look previews; uploaded photos are shown in grayscale so the animated colors stand out. **Apply settings &amp; connect** writes changed LED counts and color order to WLED, then reconnects the app. Optional latitude and longitude values update WLED's location while leaving its configured time zone unchanged. Demo mode can save controller-capacity and output settings without contacting hardware, as well as store home photos and traces.

## Persistent application data

The web container serves the UI; a separate small API container stores the app's records in SQLite at <code>/data/studio.sqlite3</code>. Docker Compose mounts <code>/data</code> from the named <code>studio-data</code> volume, outside either container image. App patterns, edits, playlists, schedules, controller connection/output setup, five elevation photos and traced sections, and named bulb-range sections are saved there and shared by clients using this server. Rebuilding or replacing the containers keeps this volume. <code>docker compose down</code> also keeps it; <code>docker compose down -v</code> removes it. Back up the Docker volume before host migrations or destructive volume cleanup.

Use **Wiring &amp; setup → Backup &amp; restore** to download a versioned JSON backup of the app’s saved patterns, edits, playlists, schedules, named roof sections, controller connection/output setup, elevation photos, and traced rooflines. Restore validates the file and replaces the app’s saved records as one database transaction; the page reloads after a successful restore. This restores the app’s controller settings only and does not apply settings to a WLED device. Keep downloaded backups separately from the Docker host. The app backup does not include WLED Wi-Fi credentials or arbitrary WLED device configuration.

## Network requirements

The app opens WLED's WebSocket directly from the browser and uses the Studio API to coordinate calendar and preset writes. WLED documents its [JSON API](https://kno.wled.ge/interfaces/json-api/) and [WebSocket API](https://kno.wled.ge/interfaces/websocket/). Use the app on a trusted LAN. To publish port 8080 on a specific host interface, set `STUDIO_BIND_ADDRESS` to its LAN IP in Compose’s `.env` file. Set it to `127.0.0.1` when a local proxy provides access.

Never expose WLED's unauthenticated local API to the public internet. This app does not collect or store WLED credentials. Controllers requiring HTTP authentication are not supported by this browser client.

## Supported behavior and limits

- Real mode reads controller metadata, palettes, state, and live WebSocket updates. Push, schedule saves, and preset storage share the Studio API’s controller write lock.
- The configurable house mapper stores multiple roof edges and ridges per photo and lets users mark individual links as wire-only. These elevation traces are mapping metadata; WLED channel capacity and reusable pattern bulb ranges are configured separately.
- The Controller page exposes output counts and a named roof-section manager. In the Look Builder’s **Where** tab, select one or more saved ranges for a color layer; add another layer to paint a different selection another color. Saved ranges can also partition section looks.
- Channel counts and color order can be applied to existing WLED output entries. **Controller → Power limit** sets WLED’s total or per-output current limit and verifies it after saving. The app leaves GPIO pin assignments, LED type and Wi-Fi settings to WLED.
- WLED runs the nightly on, bedtime, and off timers. The Docker API selects the date-range program in the installation’s saved time zone and updates the matching nightly or weekday preset. When programs overlap, the one that starts later wins. Use **Schedule → Calendar → Enable calendar scheduler** to pause or resume automatic calendar preset updates. The setting survives restarts, and WLED continues running its existing timers. **Save Schedule** still programs those timers. Studio firmware `16.0.1-tls5` stores presets without changing the live output and runs bedtime presets only while the lights are on. Earlier firmware can temporarily apply a preset while storing it. The scheduler checks for an existing match first and backs off on failure.
- Mixed looks use standard WLED effects as the base, with Studio shapes layered above them.
- Demo mode remains available and never sends commands to a physical controller.

## Source and licensing

The project source code is licensed under the MIT License; see [LICENSE](LICENSE). See [SECURITY_REVIEW.md](SECURITY_REVIEW.md) for review scope and deployment limits. Third-party firmware, libraries, trademarks, and other contributed assets may carry separate terms; retain and follow their included license and attribution notices.
