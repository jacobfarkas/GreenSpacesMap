# =============================================================================
# 01b_osm_parks.R
# Builds the unified parks layer used as routing destinations in 02_score.R
#
# SOURCES
# 1. NYC Parks Properties - NYC Open Data, identifier enfh-gkve
# 2. OpenStreetMap - via Overpass API
#
# OUTPUT
# data-prep/raw/parks_unified.geojson
# data-prep/raw/golf_courses.geojson
# =============================================================================

library(tidyverse)
library(sf)
library(osmdata)

# =============================================================================
# 1. Load NYC Parks and filter
# =============================================================================
EXCLUDE <- c(
  "Undeveloped", "Buildings/Institutions", "Lot",
  "Operations", "Retired N/A", "Parkway", "Strip",
  "Mall", "Triangle/Plaza", "Waterfront Facility"
)

nyc_parks <- st_read("data-prep/raw/parks.geojson") |>
  filter(!typecategory %in% EXCLUDE) |>
  filter(!str_detect(str_to_lower(signname), "golf course")) |>
  mutate(
    source   = "nyc_open_data",
    area_sqm = as.numeric(st_area(st_transform(geometry, 6539)))
  ) |>
  filter(area_sqm >= 1500) |>
  select(park_name = signname, borough, source, area_sqm, geometry)

cat("NYC parks after filtering:", nrow(nyc_parks), "\n")

# =============================================================================
# 2. Load OSM parks via Overpass API
# =============================================================================
cat("Querying Overpass API for parks... this may take 2-5 minutes\n")

osm_raw <- opq(
  bbox    = "New York City, New York, USA",
  timeout = 180
) |>
  add_osm_feature(key = "leisure", value = "park") |>
  osmdata_sf()

osm_combined <- bind_rows(
  osm_raw$osm_polygons,
  osm_raw$osm_multipolygons
) |>
  st_make_valid() |>
  st_transform(4326)

cat("OSM raw park polygons:", nrow(osm_combined), "\n")

# =============================================================================
# 3. Load NTA boundary for clipping
# =============================================================================
nta <- st_read("data-prep/raw/nta.geojson")
nyc_boundary <- st_union(nta) |> st_make_valid()

# =============================================================================
# 4. Clean OSM polygons
# =============================================================================
osm_parks <- osm_combined |>
  filter(!is.na(name), name != "") |>
  filter(!str_detect(str_to_lower(name),
                     "triangle|square|plaza|commons|strip|mall|parkway")) |>
  mutate(area_sqm = as.numeric(st_area(st_transform(geometry, 6539)))) |>
  filter(area_sqm >= 12500) |>              # raised from 1,500 to 12,500
  st_filter(nyc_boundary) |>
  st_join(select(nta, borough = boroname), largest = TRUE) |>
  filter(!is.na(borough))

cat("OSM parks after cleaning:", nrow(osm_parks), "\n")

# =============================================================================
# 5. Remove OSM parks that overlap NYC Parks (10m buffer)
# =============================================================================
nyc_buffered <- nyc_parks |>
  st_transform(6539) |>
  st_buffer(10) |>
  st_transform(4326) |>
  st_union()

osm_no_overlap <- osm_parks |>
  filter(!st_intersects(geometry, nyc_buffered, sparse = FALSE)[,1])

cat("OSM parks after overlap removal:", nrow(osm_no_overlap), "\n")

# =============================================================================
# 6. Deduplicate OSM
# =============================================================================
osm_deduped <- osm_no_overlap |>
  distinct(geometry, .keep_all = TRUE) |>
  select(park_name = name, borough, geometry) |>
  mutate(
    source   = "osm",
    area_sqm = as.numeric(st_area(st_transform(geometry, 6539)))
  )

# =============================================================================
# 7. Combine into unified layer
# =============================================================================
parks_unified <- bind_rows(nyc_parks, osm_deduped) |>
  mutate(
    park_size = if_else(area_sqm >= 32374, "large", "standard")
  ) |>
  select(park_name, borough, source, area_sqm, park_size, geometry)

# =============================================================================
# 8. Save parks_unified.geojson
# =============================================================================
st_write(parks_unified,
         "data-prep/raw/parks_unified.geojson",
         delete_dsn = TRUE)

cat("\n── parks_unified.geojson ──────────────────\n")
cat("Total parks:    ", nrow(parks_unified), "\n")
cat("NYC Open Data:  ", sum(parks_unified$source == "nyc_open_data"), "\n")
cat("OSM only:       ", sum(parks_unified$source == "osm"), "\n")
cat("Large parks:    ", sum(parks_unified$park_size == "large"), "\n")
cat("Standard parks: ", sum(parks_unified$park_size == "standard"), "\n")

# =============================================================================
# 9. Fetch and save golf courses
# =============================================================================
cat("\nQuerying Overpass API for golf courses...\n")

golf_raw <- opq(
  bbox    = "New York City, New York, USA",
  timeout = 180
) |>
  add_osm_feature(key = "leisure", value = "golf_course") |>
  osmdata_sf()

golf_nyc <- bind_rows(
  golf_raw$osm_polygons,
  golf_raw$osm_multipolygons
) |>
  filter(!is.na(name)) |>
  select(golf_name = name, geometry) |>
  st_make_valid() |>
  st_transform(4326) |>
  st_filter(nyc_boundary)

cat("NYC golf courses:", nrow(golf_nyc), "\n")

st_write(golf_nyc,
         "data-prep/raw/golf_courses.geojson",
         delete_dsn = TRUE)

cat("golf_courses.geojson saved\n")