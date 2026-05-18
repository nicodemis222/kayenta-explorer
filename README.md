# Kayenta Explorer

Regional real-estate scraper and dashboard built around Ivins, UT.

## Modes

- **Farmland** — properties within ~3 hrs of Ivins, UT with a 2,500+ sqft home on 5+ acres. Surfaces water (creek / well / water rights / irrigation), solar, and workshop/barn features detected from listing text.
- **Cabin** — properties within ~3 hrs of Ivins with 2,000+ sqft and 20+ acres (or explicitly described as cabin/log home with 5+ acres). Surfaces water, solar, and storage features.
- **Commercial** — industrial / underground / off-grid-capable commercial real estate, targeted at bunker-conversion candidates (FM 5-103 / FEMA P-361 cues). Each listing is scored 0–10 ("bunker fit") on underground / earth-bermed structure, industrial construction, loading dock, 3-phase power, off-grid utilities, well/septic, and concrete/reinforced. Sorted by score by default; a `Min fit` slider in the results header lets the user hide pure-noise low scores. Hovering the badge on any card lists the exact traits that matched. **Map markers are tier-colored** (red ≥6, amber ≥3, slate <3) so high-fit candidates pop out of a busy region. **The same bunker scorer also runs across farmland/cabin sources**, so a regular farmland listing that mentions "concrete bunker" or "underground storage" still surfaces the badge.
  - Source: Crexi (state-level browse via headless Chromium).
  - Skipped sources (verified blocked at probe time): LoopNet (Akamai), CommercialSearch (Cloudflare), LandSearch (Cloudflare), Realtor commercial (GraphQL doesn't surface commercial type, HTML rate-limited), MissileBases.com and the now-defunct 20thCenturyCastles.com (editorial content / contact form, no structured listing feed).
- **Ivins** — original Kayenta/Ivins views: homes for sale, land, rentals, and price changes.

## Data sources

- Realtor.com GraphQL (`/frontdoor/graphql`) — homes, land, rentals, farmland, cabins
- Redfin Stingray GIS / rentals API — homes, land, rentals
- Hayden Outdoors, United Country, LandWatch — regional farmland / cabin
- Crexi — commercial real estate (bunker-conversion mode)

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
