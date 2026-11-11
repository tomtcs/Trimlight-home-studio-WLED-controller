# Trimlight Home Studio · WLED Edition

A WLED-focused companion interface for designing, previewing, organizing, and scheduling roofline lighting looks. The visual identity follows Trimlight Home Studio while the controller model and effect catalog remain WLED-specific.

## Important: demo behavior

This source snapshot is a browser-only demo. `site/demo-shim.js` intercepts the application's API and WLED requests and supplies a simulated controller; pushing a look changes the on-screen preview only. Demo edits are stored in that browser's `localStorage`. It does not connect to a physical WLED controller, and it does not include the backend required for real control, schedules, or AI look generation.

The in-app wiring page is a general checklist. Controller pin maps, power limits, and wiring must be verified against the specific hardware documentation.

## Run with Docker

```sh
docker compose up -d --build
```

Open <http://localhost:8080>.

## Review notes

See [SECURITY_REVIEW.md](SECURITY_REVIEW.md) for the source review scope and limitations. No open-source license is included; repository visibility does not grant redistribution rights to contributed code or brand assets. Confirm the source and asset permissions with their owners before making this repository public or redistributing it.
