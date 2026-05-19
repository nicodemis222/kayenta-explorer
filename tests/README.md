# Kayenta Explorer — End-to-End Test Suite

Self-contained smoke / contract / integration tests organized by the standard
QA categories most web-app teams use:

| Category | Covered by | Notes |
|---|---|---|
| **Smoke** — does the app boot | `api.test.mjs` (server) + `ui.test.mjs` (page loads) | Catches catastrophic regressions in < 30 s. |
| **API contract** — every endpoint returns expected shape + status | `api.test.mjs` | Hits `/api/searches`, `/api/listings`, `/api/stats`, `/api/scrape-log`, `/api/listings/:id`. |
| **Data integrity** — DB state is sane | `api.test.mjs` | Verifies amenities are valid JSON arrays, lat/lng are finite numbers on commercial sources, no NULL ids, no orphan price-history rows. |
| **Critical user journey** — primary workflow E2E | `ui.test.mjs` | Sidebar → select saved search → listings render → filter → sort. |
| **Source plugin health** — every scraper at least imports + returns an array | `api.test.mjs` | Per-source smoke against the polygon in `tests/fixtures/sample-polygon.json`. |
| **Streaming SSE** — search/run/stream emits the contract | `api.test.mjs` | Listens for `start`, `source-done`, `done`. |
| **Console error monitoring** — no JS errors during normal interaction | `ui.test.mjs` | Playwright collects console + pageerror events. |
| **Accessibility (light)** — alt text, label associations | `ui.test.mjs` | Spot-checks images have `alt`, buttons have accessible names. |
| **Performance budgets** — API p99 < 500ms for non-scrape endpoints, page load < 3s | `api.test.mjs` + `ui.test.mjs` | Surfaces slow paths but doesn't fail unless egregiously over. |
| **Visual regression** | _out of scope_ — no baseline images committed. |
| **Cross-browser** | _out of scope_ — Playwright Chromium only. |

## Running

```
tests/run.sh
```

Boots a fresh server if one isn't already running, runs both suites, then
shuts down only the server it started. Returns non-zero on any failure.

To run just one suite:

```
node --test tests/api.test.mjs
node --test tests/ui.test.mjs
```
