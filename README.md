# ics-calendar

A web app that shows events from multiple ICS URLs on one calendar.
No account. Your ICS URLs and names live only in your browser's localStorage.

## Deploy to Cloudflare (team use)

```sh
npx wrangler login   # once — opens the browser
npm run deploy       # build + wrangler deploy
```

The URL is printed at the end (`https://ics-calendar.<your-subdomain>.workers.dev`).
One Worker serves both the static app and the `/api/ics` proxy.
The proxy has guardrails: it only relays responses that contain
`BEGIN:VCALENDAR`, capped at 5MB — so it cannot be abused as a
generic fetch proxy.

## Share calendars with the team

Sidebar →「チームで共有」:

- **エクスポート** downloads `ics-calendars.json` (your list of names/URLs).
- **インポート** reads such a file and shows a preview — tick what to
  bring in and edit names before confirming. URL is the unique key;
  already-added URLs are marked 追加済み and skipped.

## Run locally

```sh
npm run build   # build the frontend (only needed after code changes)
npm start       # -> http://localhost:8787
```

## Dev (hot reload)

```sh
npm run dev:server   # Hono API on :8787
npm run dev          # Vite on :5173 (proxies /api to :8787)
```

## How it works

- **Hono server** (`server/index.ts`) serves the built app and proxies
  `/api/ics?url=...` — the browser cannot fetch cross-origin ICS files
  directly because of CORS.
- **Preact + FullCalendar** (`src/app.tsx`) render the UI. The
  `@fullcalendar/icalendar` plugin parses ICS and expands recurring events.
- Every page load and the refresh button use a fresh timestamp in the
  proxy URL, so you always see the latest calendar data.
