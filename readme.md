# FPL League Live PWA

A minimal, mobile-optimized Progressive Web App for tracking live Fantasy Premier League standings.

## Features

- Ultra-condensed league table view
- Live points for all teams in league
- Real-time rank changes
- Auto-refresh every 20 seconds while a match is live (every 5 minutes otherwise), and on reopening the app
- Sticky headers for easy scrolling
- Mobile-optimized for information density
- Offline support with service worker
- Installable as Chrome app
- Starred Teams tab (swipe or tap to switch): live squads, side by side, for hard-coded teams outside the H2H league
  (`STARRED_TEAMS` in `public/app.js`)
- Fixtures tab: attack/defence ratings (0–10) for every PL team from goals per game
  (season to date, weighted towards the last 6, plus a shared home advantage), their
  trend over the season, next-6 fixture difficulty, and all teams ranked by it.
  The formula is documented at the top of `public/ratings.js`

## Architecture

One Cloudflare Worker serves both the static PWA and the FPL API, from a single
origin (`fpl.macleod.in`):

```
src/index.ts   Worker: proxies /api/fpl/* → fantasy.premierleague.com/api/*,
               delegates everything else to the ASSETS binding.
public/        The PWA itself (plain HTML/CSS/JS, no build step).
```

`wrangler.toml` sets `run_worker_first = true`, so every request reaches the Worker;
`/api/*` is handled there and the rest is served from `public/`.

## Setup

```bash
npm install
npm run dev        # wrangler dev on :8787 — serves the app *and* the API
```

Open http://localhost:8787. To install as an app, use Chrome's install icon in the
address bar (or menu → "Install FPL League Live").

Icons: open `generate-icons.html` in a browser and save the canvases as `icon-192.png`
/ `icon-512.png` into `public/`.

## Deploy

Pushing to `main` auto-deploys via `.github/workflows/deploy.yml`. It needs two repo
secrets: `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`.

Manual: `npm run ship` (`wrangler deploy --env production`). Logs: `npm run tail`.

The custom domain `fpl.macleod.in` is declared in `wrangler.toml` under
`[env.production]` — the zone must already exist in the same Cloudflare account.

## How to Use

1. Find your League ID:
   - Log into fantasy.premierleague.com
   - Go to your league page
   - Your League ID is in the URL (e.g., fantasy.premierleague.com/leagues/123456/standings/c)

2. Enter your League ID in the app
3. Click "Go" to load the league
4. View live points for all teams
5. Auto-refreshes while matches are live, or click ↻ to refresh manually

## Why there's no CORS proxy any more

The FPL API sends no CORS headers, so the browser can't call it directly. This app
used to route through public CORS proxies (corsproxy.io, then allorigins.win), which
was the single biggest source of breakage — they rate-limit, 403 and disappear, and
"Failed to load league" was almost always one of them having a bad day.

Server-side there is no CORS restriction at all. The Worker fetches
fantasy.premierleague.com itself and serves the result from the same origin as the
page, so the browser never makes a cross-origin request and there is no third party
left to be flaky. It also caches at the edge (`bootstrap-static` 5min, live data 10s; the browser is told not to cache anything but `bootstrap-static`),
which keeps eight parallel team fetches off FPL's back.

## Files

- `src/index.ts` - Worker: API proxy + static asset serving
- `wrangler.toml` - Worker config, custom domain, assets binding
- `public/index.html` - Minimal league table structure
- `public/styles.css` - Ultra-condensed mobile styling
- `public/app.js` - H2H matches, Starred Teams tab and live points logic
- `public/ratings.js` - Fixtures tab: form ratings, fixture difficulty, charts
- `public/manifest.json` - PWA configuration
- `public/sw.js` - Service worker for offline support
- `generate-icons.html` - Icon generator utility (not served)

## Table Columns

- **#** - Current live rank
- **Team** - Team name (hover for manager name)
- **GW** - Gameweek points from FPL
- **Live** - Live points including captain and transfers
- **Total** - Total season points
- **→** - Rank change from previous gameweek