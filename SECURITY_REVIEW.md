# Source review

Reviewed as a browser application with a simulated demo mode, an opt-in direct WLED mode, and a same-origin persistence API backed by SQLite.

## Confirmed behavior

- Demo mode intercepts WLED API and WebSocket requests and uses simulated controller responses plus browser-local storage.
- Real mode sends HTTP requests directly to the configured WLED address and opens WLED's `/ws` WebSocket. The app API stores patterns, schedules, layouts, controller setup, and preferences in the SQLite database mounted at `/data`.
- The setup panel validates the address, reads `/json/si` and `/json/cfg`, and can update only LED output lengths, start offsets, total count, and color order while preserving the rest of the fetched WLED configuration.
- The home-photo mapper stores a resized image and per-output normalized trace points in the server database; the image and trace are not uploaded to GitHub or sent to WLED.
- The browser's direct network path depends on WLED CORS support. WLED WebSockets are unencrypted; browsers block `ws://` when the app itself is served over HTTPS. Use HTTP on a trusted LAN or a suitable local proxy.
- HTTP-authenticated WLED controllers are not supported. The app does not collect or store controller credentials.
- WLED timer and preset operations are available for the basic nightly schedule. Date-range calendar programs, AI generation, and server-side sync still depend on absent backend services.
- The API has no built-in user authentication. Restrict network access to a trusted LAN or place an authenticated reverse proxy/VPN in front of it. Anyone who can reach the API can read or change the shared app database, including the stored home photo and controller address.

## Review limitations

This review validates Python/JavaScript syntax, local assets, demo configuration, settings/request code paths, SQLite persistence functions, and the traced-layout data flow. It has not been run against a physical WLED controller. Effect fidelity, hardware pin assignments, LED type, voltage, current limits, device-specific firmware, network isolation, and real schedule behavior must be confirmed on the target equipment.

## Before deployment

Keep WLED on a trusted LAN. Do not expose its local API to the public internet. Review any WLED configuration write before applying it; the settings form intentionally limits its writes to output lengths, offsets, total LED count, and color order.
