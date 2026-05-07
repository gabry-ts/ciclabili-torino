# Ciclabili Torino

Interactive web map and stats dashboard for Turin's cycling infrastructure
and the live pass counts from the municipal bicycle counters.

Built with [Astro](https://astro.build) + TypeScript. Optional FastAPI
caching proxy for the Eco-Visio API.

## What it shows

- **Map** (`/`): every bike-infrastructure segment in Turin from OpenStreetMap
  (1700+ segments, dedicated paths / protected lanes / on-road lanes /
  shared / cycle-pedestrian) and the 34 public bicycle counters operated by
  Comune di Torino with live yesterday / avg / total figures, hourly
  heatmap (toggleable) and a per-counter 30-day chart.
- **Stats** (`/stats`): aggregated KPIs across all counters, day / month /
  year trend, weekday and monthly seasonality, full counter ranking, and a
  by-date breakdown picker.
- **Sources** (`/fonti`): friendly attribution page.
- **Light / dark theme** toggle, persisted, defaults to
  `prefers-color-scheme`.
- **Report panel**: client-side stub for cycle-path issue reports (stored
  in `localStorage`, ready to swap with a real backend).

## Run locally

Two ways: full Docker stack (one command), or dev server with optional
proxy.

### Option A — full stack via Docker (recommended)

Single command brings up Caddy ingress + FastAPI backend + Redis. Open
http://localhost:8080.

```sh
docker compose up --build
```

The Caddy ingress on `:8080` serves the static site at `/` and proxies
`/api/*` and `/health` to the backend. Nothing else is exposed; backend
and Redis are only reachable inside the docker network.

To stop:

```sh
docker compose down
```

### Option B — dev server (live reload)

You need Node 18+ and `pnpm`. The optional caching proxy needs Docker.

```sh
pnpm install
pnpm dev          # → http://localhost:4321

# in another terminal, the caching proxy
cd backend && docker compose up --build
```

Health check: `curl http://localhost:8000/health`.

To bypass the proxy and hit Eco-Visio directly, edit `.env` at the project
root:

```env
PUBLIC_API_BASE=https://www.eco-visio.net/api/aladdin/1.0.0/pbl/publicwebpageplus/
PUBLIC_ORG_ID=6771
```

### Build for production

```sh
pnpm build        # static output in dist/
pnpm preview      # local preview of the built site
```

The build is fully static — deploy `dist/` to Vercel, Netlify, Cloudflare
Pages, GitHub Pages, or any static host.

## Data sources

- **Bike infrastructure geometries**: OpenStreetMap via Overpass API,
  queried inside the Torino municipal boundary (`admin_level=8`).
  Snapshot committed at `public/data/ciclabili-torino.geojson`.
- **Bicycle counters**: public Eco-Visio endpoint for org id `6771`
  (Comune di Torino). No API key required, CORS enabled. The proxy
  forwards `/api/{path}` to the Eco-Visio path under the same org.
- **Map tiles**: CARTO Dark Matter / Positron (free, OSM-based).
- **Geocoding**: OpenStreetMap Nominatim (used by the report flow's
  address search).

## Regenerate the bike-paths dataset

```sh
python3 scripts/fetch_ciclabili.py
```

Stdlib-only Python script. Tries the main Overpass endpoint first, falls
back to mirrors, writes to `public/data/ciclabili-torino.geojson`.

## Structure

```
ciclabili/
├── astro.config.mjs
├── package.json
├── tsconfig.json
├── .env                       # PUBLIC_API_BASE, PUBLIC_ORG_ID
├── src/
│   ├── layouts/
│   │   └── Base.astro         # shared <html>, head, theme bootstrap
│   ├── components/
│   │   ├── Topbar.astro
│   │   ├── ThemeToggle.astro
│   │   └── ThemeBootstrap.astro
│   ├── pages/
│   │   ├── index.astro        # map page
│   │   ├── stats.astro        # stats dashboard
│   │   └── fonti.astro        # sources
│   ├── scripts/
│   │   ├── map.ts             # Leaflet map, counters, heatmap, reports
│   │   ├── stats.ts           # Chart.js stats + day picker
│   │   ├── theme.ts           # light/dark handler
│   │   └── config.ts          # runtime config from env
│   └── styles/
│       └── global.css
├── public/
│   └── data/
│       └── ciclabili-torino.geojson
├── scripts/
│   └── fetch_ciclabili.py     # OSM Overpass snapshot
└── backend/
    ├── main.py                # FastAPI caching proxy
    ├── requirements.txt
    ├── Dockerfile
    └── docker-compose.yml
```

## Backend proxy notes

- Single-file FastAPI (`backend/main.py`).
- Cache key: `sha1` of the full upstream URL.
- TTL: 24h, configurable via `CACHE_TTL` env var.
- CORS: by default allows `localhost:4321` (Astro dev) and `localhost:8765`.
  Override via `ALLOWED_ORIGINS` (comma-separated).
- `x-cache: HIT | MISS` response header for inspection.
- Redis runs with `appendonly off` and `maxmemory 256mb / allkeys-lru` —
  pure cache, restart loses everything, which is fine.

## Replacing the local report stub with a real backend

Reports in the map sidebar currently persist to `localStorage`. The shape
is already backend-shaped:

```ts
{
  id, lat, lon, label,
  category, description, photos: [dataUrl|url],
  createdAt, source: "local",
}
```

Swap the three methods of `reportApi` in `src/scripts/map.ts` (`list`,
`create`, `remove`) with `fetch()` calls to your endpoint and the rest of
the flow keeps working untouched.

## Container images

GitHub Actions builds and publishes two multi-arch images
(`linux/amd64` + `linux/arm64`) to GHCR on every push to `main` and on
`v*` tags:

- `ghcr.io/gabry-ts/ciclabili-torino-ingress` — Caddy + built Astro site
- `ghcr.io/gabry-ts/ciclabili-torino-backend` — FastAPI proxy

Workflow definition: `.github/workflows/build-push.yml`.

To pull and run with the published images instead of building locally,
swap the `build:` keys in `docker-compose.yml` for `image:` lines and run
`docker compose pull && docker compose up -d`.

## License

- Code: do whatever.
- Map geometries: © OpenStreetMap contributors, ODbL.
- Counter data: Comune di Torino via Eco-Counter.
