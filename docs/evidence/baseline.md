# Static `dist` baseline

Captured 2026-11-28 against the checked-out `dist/` directory served by a minimal
loopback-only static HTTP server (`127.0.0.1:8765`). No monitor, API relay, or
private activity service was started. The page was opened at `/#agentes` with
Chrome headless 158.0.8127.37.

Screenshots:

- [Desktop, 1440×1100](baseline-desktop.png)
- [Mobile, 390×844](baseline-mobile.png)

The screenshots are visual evidence only; all data visible in them comes from the
checked-in static manifest/archive. The local activity endpoint is unavailable,
so the UI shows its expected stale/unavailable state.

## Asset loading check

Sequential HTTP fetches from the same loopback server returned HTTP 200 for the
document, scripts, styles, images, and manifests used by the page. The measured
aggregate was 239.9 ms (single-process sequential fetch; not a browser lab score).
See [baseline-metrics.json](baseline-metrics.json) for byte counts and per-asset
timings.
