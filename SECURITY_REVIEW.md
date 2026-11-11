# Source review

Reviewed as a static browser demo; no production backend or hardware integration is present in this snapshot.

## Confirmed behavior

- `site/demo-shim.js` replaces application API requests with simulated responses and local browser storage. The demo does not send commands to a real controller.
- No dependency manager or third-party runtime packages are required; Docker serves the static files with NGINX.
- The application includes direct WLED request paths in `site/app.js`, but they are intercepted in the shipped demo by `demo-shim.js`. Removing the shim without adding a tested backend and an explicit connection design would expose the browser to local-network/CORS and mixed-content constraints.
- AI, controller status, schedules, and persistent server-side settings depend on `/api/*` routes that are not implemented in this repository.

## Review limitations

This review checks JavaScript syntax, static asset references, Docker configuration, and visible request/storage paths. It does not validate WLED effect fidelity against hardware, network behavior, installation wiring, or a real deployment. The included setup guide is generic and does not define hardware-specific pin maps or power limits.

## Before enabling real hardware control

Implement and review an authenticated backend, validate WLED host inputs and request boundaries, add CSRF/origin protections where applicable, and test on a non-production controller. Keep demo mode explicit until those pieces exist.
