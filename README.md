# GreenSpacesMap

Mapping NYC park access gaps — who can actually reach green space?

This project scores every neighborhood in New York City based on 
how accessible its nearest park is, accounting for walking distance, 
transit access, and ADA accessibility.

Built with R, H3, Leaflet.js, and NYC Open Data.

## Data sources
- [NYC Parks Properties](https://data.cityofnewyork.us/resource/enfh-gkve.json) — NYC Open Data
- [NTA Boundaries 2020](https://data.cityofnewyork.us/resource/9nt8-h7nd.geojson) — NYC Open Data
- [MTA Subway Stations](https://data.ny.gov/api/views/39hk-dx4f) — NY State Open Data
- [MTA Bus Stops](https://data.ny.gov/api/views/ai5j-txmn) — NY State Open Data

## Structure
- `01_download.R` — downloads all raw data
- `02_score.R` — scores each NTA using H3 hexagons
- `03_export.R` — exports scored GeoJSONs for the map
- `docs/` — the public-facing Leaflet.js map (GitHub Pages)