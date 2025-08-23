# FPL League Live PWA

A minimal, mobile-optimized Progressive Web App for tracking live Fantasy Premier League standings.

## Features

- Ultra-condensed league table view
- Live points for all teams in league
- Real-time rank changes
- Auto-refresh every 30 seconds
- Sticky headers for easy scrolling
- Mobile-optimized for information density
- Offline support with service worker
- Installable as Chrome app

## Setup

1. Generate app icons by opening `generate-icons.html` in a browser and saving the canvases as:
   - icon-192.png
   - icon-512.png

2. Serve the app using a local web server:
   ```bash
   python3 -m http.server 8000
   ```

3. Open http://localhost:8000 in Chrome

4. To install as an app:
   - Click the install icon in Chrome's address bar
   - Or go to Chrome menu → "Install FPL League Live"

## How to Use

1. Find your League ID:
   - Log into fantasy.premierleague.com
   - Go to your league page
   - Your League ID is in the URL (e.g., fantasy.premierleague.com/leagues/123456/standings/c)

2. Enter your League ID in the app
3. Click "Go" to load the league
4. View live points for all teams
5. Auto-refreshes every 30 seconds or click ↻ to refresh manually

## CORS Proxy

The app uses corsproxy.io to bypass CORS restrictions when calling the FPL API from the browser. For production use, consider setting up your own proxy server.

## Files

- `index.html` - Minimal league table structure
- `styles.css` - Ultra-condensed mobile styling
- `app.js` - League standings and live points logic
- `manifest.json` - PWA configuration
- `sw.js` - Service worker for offline support
- `generate-icons.html` - Icon generator utility

## Table Columns

- **#** - Current live rank
- **Team** - Team name (hover for manager name)
- **GW** - Gameweek points from FPL
- **Live** - Live points including captain and transfers
- **Total** - Total season points
- **→** - Rank change from previous gameweek