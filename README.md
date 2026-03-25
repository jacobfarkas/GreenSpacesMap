# 🌿 GreenSpacesMap — NYC Park Access

**Live:** [Neighborhood Parks](https://jacobfarkas.github.io/GreenSpacesMap/) · [Flagship Parks](https://jacobfarkas.github.io/GreenSpacesMap/index-fs.html)

> *Highlighting access to parks in NYC, by block and by neighborhood.*

Built for [NYC Open Data Week 2026](https://opendataweek.nyc/event/mapping-green-space-access-turn-data-into-community-action/)  <br> Presented by Jacob Farkas at LREI - Little Red School House, in New York, NY <br> March 25, 2026

Built with open source tools and data, including R, H3, Leaflet.js, NYC Open Data, and OpenStreetMap.

---

## Access to Parks / Green Spaces

New York City has over 1,700 spaces designated as parks. But a concrete playground with a swing set is not the same as a park with trees, grass, and open space. And a park two miles away with no transit connection might as well not exist for the people who need it most.

This project asks a different question than existing tools: **given where you live, how long does it actually take you to reach a real green space — on foot or by public transit?**

---

## Live Maps

| Map | URL | Description |
|---|---|---|
| 🌳 Neighborhood Parks | [index.html](https://jacobfarkas.github.io/GreenSpacesMap/) | Walk time to nearest park or green space |
| 🏛️ Flagship Parks  | [index-fs.html](https://jacobfarkas.github.io/GreenSpacesMap/index-fs.html) | Walk and subway access to NYC's 15 "Flagship" Parks |

Both maps are **mobile-first and fully responsive** — designed to work on iPhone, Android, iPad, and desktop. Search any NYC address to get your personal park access score.

---

## What This Map Does

- **Block-level precision** — every cell is designed to be roughly one short city block.
- **Real green space only** — playgrounds, ballfields, and paved courts are filtered out using NYC's own tree inventory as a quality proxy. If it doesn't have trees, it doesn't count.
- **Two separate questions** — neighborhood park access (is there green space nearby?) and flagship park access (can you reach a major destination park?). These are different equity questions with different policy implications.
- **Transit scoring** — the flagship subway score models walk to station + scheduled MTA ride time + walk to park, with single-transfer routing and a walk fallback. Nobody is forced to take the subway — it only helps.
- **Address search** — search any NYC address and instantly get your personal park access score, nearest park, and travel time.
- **Mobile-first** — designed and tested on iPhone and Android. Not a desktop tool that happens to work on mobile.
- **Fully reproducible** — every data source is public, every script is documented, every methodological decision is explained. Fork it, extend it, run it for another city.
- **Open source, zero infrastructure** — built entirely on NYC Open Data, OpenStreetMap, and MTA GTFS. Hosted on GitHub Pages. No proprietary data, no paid APIs, no servers.

---

## Key Findings

- **Most New Yorkers can walk to a small green space** — 87% of NYC cells score A or B for neighborhood park access
- **Flagship park access varies greatly** — 46% of NYC cells score F for flagship walk access
- **Subway helps but doesn't solve it** — subway access reduces the F count to 32%, but 15,380 cells fall back to walk score because subway is slower (this finding is preliminary, and doesnt include bus scoring, or easy multiple subway transfers)

---

## The Maps

The maps use the [H3 system](https://h3geo.org/) to divide the city into small hexagon units. At the resolution we are using, this is roughly the size of a short city block.

### 🌳 Neighborhood Parks Score

**Block-Level Score**
Every H3 cell in NYC is scored by estimated walking time to the nearest qualifying green space.

**Grading:**
| Grade | Walk Time |
|---|---|
| A | Under 5 min |
| B | 5–10 min |
| C | 10–15 min |
| D | 15–20 min |
| F | Over 20 min |

**Neighborhood Scores**
Neighborhoods are graded A–F by the percentage of cells in that neighborhood with good access.

Each neighborhood is graded by the percentage of its cells that score A or B — meaning residents within a short walk of a qualifying green space:

| Neighborhood Grade | Threshold |
|---|---|
| A | ≥ 80% of cells score A or B |
| B | ≥ 60% of cells score A or B |
| C | ≥ 40% of cells score A or B |
| D | ≥ 20% of cells score A or B |
| F | < 20% of cells score A or B |

### 🏛️ Flagship Walk Score (Walk mode)
The same model, but destinations are for NYC Parks' 15 official [Flagship Parks](https://www.nycgovparks.org/parks/flagship-parks) only — the large destination parks. Grading thresholds are recalibrated for longer acceptable travel times for these parks.

**Flagship Parks (15 total):**
Pelham Bay · Van Cortlandt · Flushing Meadows · Central Park · LaTourette · Bronx Park · Alley Pond · Prospect Park · Forest Park · Ferry Point · Cunningham · Soundview · Randall's Island · Crotona · Highland Park

**Grading:**
| Grade | Travel Time |
|---|---|
| A | Under 12 min |
| B | 12–26 min |
| C | 26–38 min |
| D | 38–50 min |
| F | Over 50 min |

Grading thresholds are informed by:
- [**Trust for Public Land ParkScore**](https://www.tpl.org/parkscore/about) — TPL's ParkScore index benchmarks the 100 most populous U.S. cities on the percentage of residents living within a 10-minute walk of a park.

### 🚇 Flagship Subway Score (Subway mode)
Total trip time = walk to nearest subway station + median GTFS scheduled ride time + walk to park. Includes single-transfer routing. Falls back to walk score when walking is faster.

**Key finding: 46% of NYC cells score F for flagship walk access.**

**Key finding: Subway access reduces the F cell count from 46% to 32%.**

---

## What is Considered a Park for This Map?

Not everything called a "park" in NYC Open Data is a green space. Playgrounds, ballfields, skate parks, and paved courts are all tagged in the data sets as parks. This project applies a quality filter designating a location a park, for our scoring purposes.

### Park Data Sources

NYC parks data including their polygons come from the **NYC Parks Properties dataset** [NYC Open Data, `enfh-gkve`](https://data.cityofnewyork.us/Recreation/Parks-Properties/enfh-gkve/about_data), which includes every property managed by the NYC Department of Parks & Recreation, along with a `typecategory` field that classifies each property (Flagship Park, Neighborhood Park, etc.).

This dataset is supplemented with data collected from **OpenStreetMap** parks. This includes state parks, privately managed green spaces, and other qualifying open spaces not under NYC Parks jurisdiction. OSM data is retrieved via the Overpass API using the `leisure=park` tag. We only included those parks that are ≥12,500 m² and don't appear in the NYC Parks dataset.

### Park Quality Filter
A space qualifies as a park / green space if any of the the following are true:

- **Tree count ≥ 10** — if the park has 10 mapped trees inside its boundaries, per the NYC Forestry Tree Points dataset (`hn5i-inap`), OR
- **Area ≥ 40,000 m²** — large natural areas (wetlands, shoreline) that have few managed trees but are genuine green spaces

This filter was calibrated by running a spatial join between the Forestry Tree Points dataset and all park polygons, examining the distribution of tree counts, and identifying the natural break between genuine green spaces and paved/recreational facilities.

**Result:** 1,295 qualifying parks from 1,657 potential candidates.

---

## Scoring Methodology

### 🚶 Walk Time Formula
```
walk_minutes = (hops × 131 + 79) × 1.4 / 5000 × 60
```
- `hops` = number of H3 resolution 10 cells between origin and destination
- `131m` = H3 res 10 cell center-to-center distance
- `79m` = average offset correction
- `1.4` = circuity factor (street grid vs straight line)
- Result: estimated real-world walking time in minutes

### 🚇 Subway Score Formula
```
total_time = walk_to_station + median_gtfs_ride + walk_from_station
```
- Walk to station: hop model from cell centroid to nearest station
- GTFS ride: median scheduled time across all trips serving that station pair
- Walk from station: fixed 5 minutes (stations selected within 500m of park)
- Transfer routing: single transfer allowed, 5 min transfer buffer
- Fallback: if walking is faster than subway, walk score is used

---

## Data Pipeline

All R scripts are in the `data-prep/` folder. Highly recommended to run them on a local machine.
```
01_download.R          Download NYC Open Data + OSM raw data
01b_osm_parks.R        Merge NYC + OSM parks, filters out golf courses
01c_tree_filter.R      Apply tree count quality filter for NYC Parks
01d_download_gtfs.R    Download MTA subway GTFS feed
02_score.R             Scores all cells for neighborhood parks
02b_score_flagship.R   Scores all cells for flagship parks
02c_flagship_display.R Extract flagship park polygons for easier display
02d_score_subway.R     Score all cells for flagship parks - subway score
```

### Outputs
All processed files are served from `docs/data/`:

| File | Description | Features |
|---|---|---|
| `parks_display.geojson` | Qualifying green spaces | 1,295 |
| `flagship_display.geojson` | 15 Flagship Parks | 15 |
| `golf_courses.geojson` | Golf courses (excluded from scoring) | ~15 |
| `hex_scores_parks.geojson` | H3 Cell or Block scores for neighborhood parks | 47,675 |
| `nta_scores.geojson` | Neighborhood grades | 205 |
| `hex_scores_flagship_walk.geojson` | Block scores - Flagship Parks - walking | 46,235 |
| `nta_scores_flagship_walk.geojson` | Neighborhood grades - Flagship Parks walking | 205 |
| `hex_scores_flagship_subway.geojson` | Block scores - Flagship Parks subway | 44,032 |
| `nta_scores_flagship_subway.geojson` | Neighborhood grades - Flagship Parks subway | 205 |

---

## Data Sources

| Dataset | Source | Identifier | Notes |
|---|---|---|---|
| NYC Parks Properties | NYC Open Data | `enfh-gkve` | 2,058 raw → 1,295 after filtering |
| NTA Boundaries 2020 | NYC Open Data | `9nt8-h7nd` | 262 NTAs |
| MTA Subway Stations | NY State Open Data | `39hk-dx4f` | 496 stations, ADA status |
| MTA Bus Stops | NY State Open Data | `ai5j-txmn` | 13,572 active stops |
| Forestry Tree Points | NYC Open Data | `hn5i-inap` | ~887K trees, park + street |
| OSM Parks | Overpass API | `leisure=park` | ≥12,500 m², 182 additions |
| OSM Golf Courses | Overpass API | `leisure=golf_course` | Excluded from scoring |
| MTA Subway GTFS | MTA Developer Data | — | Weekly feed, stop times |
| NYC GeoSearch API | NYC Planning Labs | v2 | Address geocoding |

---

## Tech Stack

### Data Pipeline (R)
- `sf` — spatial operations, polygon intersection, coordinate projection
- `h3jsr` — H3 hexagonal grid generation and hop distance calculation
- `tidyverse` — data wrangling
- `osmdata` — OpenStreetMap Overpass API queries

### Frontend
- [Leaflet.js](https://leafletjs.com/) — interactive map rendering
- [H3-js](https://github.com/uber/h3-js) — client-side H3 cell lookup
- [CARTO](https://carto.com/) — basemap tiles
- [NYC GeoSearch API v2](https://geosearch.planninglabs.nyc/) — address autocomplete
- Vanilla JavaScript — no frameworks
- GitHub Pages — hosting (zero infrastructure cost)

### Mobile-First Design
The map is designed mobile-first and tested on iPhone, Android, iPad, and desktop:
- Bottom sheet layer panel on mobile, side panel on desktop
- Search bar optimized for touch input
- Result card slides up from bottom on mobile
- All touch targets sized for mobile interaction
- Responsive breakpoints at 768px and 380px

---

## What's Next

- **Bus scoring** — MTA bus GTFS + walk-to-bus-to-park model
- **Hybrid score** — `min(walk, subway, bus)` per cell
- **Pedestrian routing** — replace hop approximation with actual street-level routing
- **Multi-transfer subway routing** — currently limited to one transfer

---

## Collaborate

This project is open source and built entirely on public data. Everything is reproducible.

**Looking for collaborators who can help with:**
- 🚌 **Transit routing** — GTFS expertise for bus scoring and multi-transfer subway
- 🗺️ **Pedestrian routing** - using open source routing tools
- 🤝 **Community partnerships** — parks advocates, community boards, BIDs
- 🎨 **Design** — making the map accessible to non-technical audiences

**GitHub:** [github.com/jacobfarkas/GreenSpacesMap](https://github.com/jacobfarkas/GreenSpacesMap)

---

## Built With AI Assistance

This project was designed and built with the help of [Claude](https://claude.ai) (Anthropic), used throughout as a coding collaborator — writing and debugging R data pipeline scripts, JavaScript map logic, CSS layout, and helping think through methodology decisions like the tree count proxy, H3 hop model, and GTFS transit scoring.

Contributors should expect an AI-assisted workflow. Claude is used for:
- Writing and iterating on code (R, JavaScript, CSS)
- Debugging spatial joins, Leaflet rendering issues, and data pipeline errors
- Thinking through methodology and scoring design
- Drafting documentation

All methodology decisions, data source choices, and design direction were made by the project author. Claude accelerated implementation — it did not drive the project.

If you want to collaborate, you're welcome to use AI tools or not — what matters is the work.

---

## License

All code is open source under MIT. All data sources are public — NYC Open Data, OpenStreetMap, and MTA Developer Data.

---

*Built by Jacob Farkas for NYC Open Data Week 2026.*
*All analysis uses publicly available data. Methodology is fully reproducible.*
