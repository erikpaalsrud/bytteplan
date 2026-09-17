# Bytteplan push server and Docker deployment

Deployment is prepared, **not deployed**. Choose an always-on Docker host and domain later. The server serves both the app and `/api/push/*` on the same origin. GitHub Pages alone cannot run this service. No external database or paid notification provider is required; the device's browser push service delivers notifications.

## Prepare once

With Node 24 installed:

```sh
npm ci --ignore-scripts
npm run keys
```

This creates an ignored `.env` with mode 0600 and refuses to overwrite existing keys. Edit it using `.env.example` as a guide:

- `PUBLIC_ORIGIN=https://your-domain.example` — exact origin, no trailing slash.
- `SITE_DOMAIN=your-domain.example` — hostname used by Caddy.
- `VAPID_SUBJECT=mailto:your-real-contact@example.com`.
- Keep the generated VAPID public/private keys unchanged across deployments. Back up `.env` securely; never commit it.

Docker-only key generation is also available after building the image:

```sh
docker build -t bytteplan:local .
docker run --rm --user "$(id -u):$(id -g)" --entrypoint node \
  -v "$PWD:/config" bytteplan:local server/generate-keys.mjs /config/.env
```

Do not run key generation again if `.env` already exists.

## Deploy when a host is chosen

Point DNS at the host and allow inbound TCP 80/443 (UDP 443 optional). Copy the project and its protected `.env`, then:

```sh
docker compose up -d --build
docker compose ps
```

Caddy obtains HTTPS certificates. SQLite schedules and subscriptions live in the `push_data` volume. Certificates live in `caddy_data`. Use **one app instance** with this SQLite scheduler; do not scale the app container horizontally. Back up the database volume and `.env`. Normal container replacement retains schedules; deleting the volume does not.

For local development, keep `PUBLIC_ORIGIN=http://localhost:3000` and run `npm start`, then open that exact address. The notification API requires HTTPS or localhost. An ordinary HTTP LAN address is insufficient for mobile push testing.

The new domain has its own localStorage. Existing player names/history on GitHub Pages will **not automatically migrate**. Keep old reports on that origin or copy them before switching; an import/export feature is not included.

## Coach flow

On iPhone/iPad, add the HTTPS app to the Home Screen and open that installed app. In the lineup step:

1. Test sound with the app open.
2. Tap **Tillat og test pushvarsler** and grant the device permission.
3. Confirm that the server test appears in Notification Center.
4. Start the match and wait for the server-saved status before locking the phone.

The server schedules the next substitution, current period end and break end. It does not assume that substitutions were performed or start subsequent periods automatically. Pause, snooze, confirmed substitutions, next period, sound changes and match end replace the schedule. Turning push off deletes the device subscription and jobs when the server acknowledges it.

## Reliability and privacy

- A persisted timestamp lets the page recover elapsed playing time when reopened, capped at period end. JavaScript is not expected to keep executing under screen lock.
- Push needs network access and the device's notification permission. Focus, silent mode, battery policy and push-service delays affect sound/delivery. This is not an exact alarm or a permanent notification-bar stopwatch.
- Unacknowledged offline changes cannot cancel jobs already stored on the server. The app shows that warning. Already delivered/in-flight pushes cannot be recalled.
- Jobs retry transient errors with backoff; events expire after one minute to limit stale reminders. A server outage lasting longer can lose alerts. A crash between delivery and acknowledgement can duplicate a notification.
- Only the push endpoint/keys, a hashed device capability, revision numbers, event IDs/times and sound preference are stored. Player names, opponents, scores, rosters and reports stay on the phone.
- Device records expire after 30 days without updates. Invalid push endpoints are removed on 404/410. Sent-event dedup records expire after one day. Test/reconnect renews expired subscriptions.
- HTTPS, same-origin mutation checks, per-device bearer capabilities, bounded payloads/events, registration/request limits and a push-provider endpoint allowlist are included. This is designed for club use, not an unrestricted high-volume public service. Behind Caddy the application rate limit is shared across clients; tune it if usage grows.
- Treat the SQLite volume as sensitive device data. Do not expose port 3000 directly to the Internet. The static server only serves explicitly allowed public files.

## Verification

```sh
npm test
node tests/server-http.mjs
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/browser.mjs
BYTTEPLAN_ENV_FILE=.env.example docker compose --env-file .env.example config --quiet
```

26 unit/regression tests passed. Real HTTP API and mobile Chromium integration checks passed; browser push transport was mocked. Compose configuration passed validation. Docker image build was attempted but the local Docker daemon was not running, so the image/container has not been exercised here.

Before production use, test actual delivery on locked iPhone and Android devices: next substitution, pause/cancel, snooze, period end, break end, Focus/silent mode, app closure, network loss and server restart. No live Apple/Google push delivery was claimed by the automated tests.

Platform references: [WebKit Home Screen push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [MDN background operation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation), [Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API).
