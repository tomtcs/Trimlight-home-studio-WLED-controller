# Source review

Reviewed as a browser application with a simulated demo mode, an opt-in direct WLED mode, and a same-origin persistence API backed by SQLite.

## Confirmed behavior

- Demo mode intercepts WLED API and WebSocket requests and uses simulated controller responses plus browser-local storage.
- Real mode sends HTTP requests directly to the configured WLED address and opens WLED's `/ws` WebSocket. The app API stores patterns, schedules, layouts, controller setup, and preferences in the SQLite database mounted at `/data`.
- The setup panel validates the address, reads `/json/si` and `/json/cfg`, and can update only LED output lengths, start offsets, total count, and color order while preserving the rest of the fetched WLED configuration.
- The home-photo mapper stores a resized image and per-output normalized trace points in the server database; the image and trace are not uploaded to GitHub or sent to WLED.
- The browser's direct network path depends on WLED CORS support. WLED WebSockets are unencrypted; browsers block `ws://` when the app itself is served over HTTPS. Use HTTP on a trusted LAN or a suitable local proxy.
- HTTP-authenticated WLED controllers are not supported. The app does not collect or store controller credentials.
- The API container runs the date-range scheduler and connects only to resolved private network addresses, without following redirects. It selects the active calendar program using the saved browser time zone and updates the scheduled WLED preset; WLED retains responsibility for timer execution. AI generation and broader server-side sync remain unavailable.
- The API has no built-in user authentication. Restrict network access to a trusted LAN or place an authenticated reverse proxy/VPN in front of it. Anyone who can reach the API can read or change the shared app database, including the stored home photo and controller address.

## Review limitations

The scheduler implementation has not been executed against a physical WLED controller. Confirm its network reachability, local time-zone alignment, preset behavior, effect fidelity, hardware pin assignments, LED type, voltage, current limits, device-specific firmware, and network isolation on the target equipment.

## Before deployment

Keep WLED on a trusted LAN. Do not expose its local API to the public internet. Review any WLED configuration write before applying it; the settings form intentionally limits its writes to output lengths, offsets, total LED count, and color order.
