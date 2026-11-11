# Trimlight Home Studio · WLED Edition

A WLED-focused lighting interface for configuring output channels, previewing effects, and sending looks to a WLED controller.

## Run locally

Use <code>docker compose up -d --build</code> and open <http://localhost:8080>. In **Wiring &amp; setup**, choose **Real WLED controller**, enter its IP address or <code>.local</code> hostname, then select **Test connection**. Review the detected output channels, LED counts, and color order. **Apply settings &amp; connect** writes changed LED counts and color order to WLED, then reconnects the app. Settings are stored in that browser. Optional latitude and longitude values update WLED's location while leaving its configured time zone unchanged.

## Network requirements

The app sends WLED JSON API requests and opens its WebSocket directly from the browser. WLED documents its [JSON API](https://kno.wled.ge/interfaces/json-api/) and [WebSocket API](https://kno.wled.ge/interfaces/websocket/). Use this app over HTTP on the same trusted LAN; WLED's WebSocket endpoint is unencrypted <code>ws://</code>, so browsers block it from HTTPS pages. WLED's API permits cross-origin requests; network isolation and controller access controls remain your responsibility.

Never expose WLED's unauthenticated local API to the public internet. This app does not collect or store WLED credentials. Controllers requiring HTTP authentication are not supported by this browser client.

## Supported behavior and limits

- Real mode reads the controller's effect metadata, palettes, state, and live WebSocket updates, and sends WLED state changes directly.
- Channel counts and color order can be applied to existing WLED output entries. The app does not configure GPIO pin assignments, LED type, power limits, Wi-Fi, or other hardware settings.
- Basic nightly WLED timers and a scheduled look are written to WLED. Date-range calendar programs, AI generation, server-side sync, and custom Studio firmware features need backend services that are not included here.
- Demo mode remains available and never sends commands to a physical controller.

## Source and licensing

See [SECURITY_REVIEW.md](SECURITY_REVIEW.md) for review scope and deployment limits. No open-source license is included, so repository visibility does not grant reuse rights to contributed code or brand assets. Confirm permissions with their owners before redistributing them.
