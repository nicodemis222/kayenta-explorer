# Kayenta Explorer

Regional real-estate scraper and dashboard built around Ivins, UT.

## Modes

- **Farmland** — properties within ~3 hrs of Ivins, UT with a 2,500+ sqft home on 5+ acres. Surfaces water (creek / well / water rights / irrigation), solar, and workshop/barn features detected from listing text.
- **Cabin** — properties within ~3 hrs of Ivins with 2,000+ sqft and 20+ acres (or explicitly described as cabin/log home with 5+ acres). Surfaces water, solar, and storage features.
- **Ivins** — original Kayenta/Ivins views: homes for sale, land, rentals, and price changes.

## Data sources

- Realtor.com GraphQL (`/frontdoor/graphql`)
- Redfin Stingray GIS / rentals API

Regional scraping iterates a fixed list of nearby cities: Ivins, St. George, Hurricane, Washington, Cedar City, Enterprise, Beaver, Kanab, Panguitch UT; Mesquite NV; Page AZ.

## Architecture

- `server/` — Node + Express + better-sqlite3. Auto-refreshes every 8 hours.
- `client/` — React + Vite. Proxies `/api` to the server in dev.

## Run

```bash
cd server && npm install
cd ../client && npm install
cd .. && ./start.sh
```

Dashboard: http://localhost:3000 — API: http://localhost:3001.

Click **Refresh Data** to trigger a manual scrape. The first scrape populates the SQLite DB at `server/data/kayenta.db` (gitignored).

## Notes

Feature flags (water / solar / outbuilding / storage) are heuristics extracted from listing descriptions. Verify any property's actual features and water rights directly with the listing agent.
