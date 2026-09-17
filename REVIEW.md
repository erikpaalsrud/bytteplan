# Code review — 2026-09-17

Scope: the static application in `index.html`, persistence, substitution planning, reports, and `sw.js`. Changes are local; no deployment performed.

## Findings addressed

| Severity | Finding and impact | Resolution |
| --- | --- | --- |
| High | A suspended timer credited the entire elapsed wall-clock delta, even beyond the end of the period. Reload also discarded the clock anchor. Player statistics could be substantially inflated or time lost. | Persist the timestamp, reconcile before player changes and page lifecycle events, and cap credit at the current period boundary. |
| High | Clearing history during a live match removed the roster still referenced by that match. | Block deletion during a match; clear stale setup along with the roster otherwise. |
| Medium | Preview ran through a continuous match duration instead of resetting intervals and stints at each period; its results differed from live substitutions. | Simulate each period with the shared planner, including unequal lengths, rotations and period resets. |
| Medium | An injured player returning to an understaffed lineup was always placed on the bench, leaving a vacant position. | Fill the missing position first and ignore duplicate returns. |
| Medium | Service-worker activation removed all origin caches, including unrelated applications. Fetch also cached unsuccessful responses and returned HTML for missing assets. | Restrict cleanup to the app prefix; cache only successful same-origin GET requests; restrict document fallback to navigation. |
| Medium | localStorage failures were silently ignored. | Show a persistent visible warning when saving fails. |
| Medium | Player cards and the fairness table appeared live but did not refresh with the clock. | Update their times on ticks without rebuilding interactive controls. |
| Low | Zero-minute breaks fell back to five minutes; help promised equal minutes and guaranteed positions that the algorithm cannot guarantee. | Preserve zero and clarify the actual behavior. |
| Low | Numeric-input rerenders swallowed the first click on Next; lineup navigation retained the prior scroll offset. | Update only dependent fields and the summary; reset scroll when entering review. |

## Product changes

Three-step setup: match settings → players → lineup review. Supports 3er without keeper and 5er/7er/9er with keeper, with format-specific positions and substitution limits. Each period has an independent duration, plus configurable breaks and substitution interval. Optional player preferences are collapsed. Selected chips are keyboard-operable buttons; labels, focus indicators and browser zoom are supported. Reports retain the format. Existing 5er data stays compatible.

## Verification

- 11 automated regression tests: all four formats with/without bench, unique players and positions, preview/live time agreement, unequal periods, injury returns, timer catch-up, zero break, live-match deletion protection and legacy settings/statistics.
- Chromium at 390 × 844: complete 9er flow, 11 players, 17.5 + 23 minute periods, zero break, preview, start, reload, next period and saved report; no page errors or lineup horizontal overflow.
- Offline reload and preservation of an unrelated cache; direct click on Next after editing a number; screenshots inspected.

## Remaining limitations / follow-up

- **Medium — accessibility:** live player cards still use clickable divs, and dialogs do not fully manage focus or trap Tab. A keyboard/screen-reader pass remains necessary. Escape closes dialogs, but this is not full accessibility compliance.
- **Medium — storage validation:** persisted data is only shallowly validated. Malformed or manually edited localStorage can still break rendering; there is no backup/import facility. No destructive recovery was added.
- Background audio, screen wake lock and installed-PWA behavior still need a real-device Safari/iOS and Android check. Chromium testing does not establish that coverage.
- The FIFO/longest-stint planner aims for balanced outfield minutes, not mathematical equality of total minutes. Keepers are selected manually, and lineups use fixed formations.
- The application remains a single HTML file with inline event handlers. Extracting the planner, persistence and views would make future maintenance and stricter CSP easier, but is outside this change.

## Follow-up: locked-device alerts

Added optional setup permissions and sound tests, explicit wake-lock status, persistent substitution-alert deduplication, and an authenticated Node 24/SQLite Web Push scheduler. All event updates use revisions; pause/snooze/substitution/end replace schedules. The service worker handles remote pushes and notification clicks. API responses bypass the offline cache.

26 regression tests, browser integration (mock push transport), real HTTP API checks and Compose validation pass. Actual locked-device delivery requires a deployed HTTPS host and device testing. Docker build is unverified because the local daemon was stopped. See `server/README.md` for deployment instructions, retention, security assumptions and delivery limits.
