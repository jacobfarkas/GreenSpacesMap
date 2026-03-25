# 01c_build_parks_layer.R
# Builds unified parks layer combining NYC Parks Properties + OSM parks
# NYC Parks = authoritative source for city-managed properties
# OSM = supplement for parks managed by other entities
# Minimum size: 1500 sq meters. Named parks only from OSM.
# Project: GreenSpacesMap

library(sf)
library(tidyverse)
library(osmdata)

dir.create("data-prep/raw", recursive = TRUE, showWarnings = FALSE)

# ── 1. LOAD NYC PARKS ──────────────────────────────────────────────────────────
message("Loading NYC Parks properties...")

parks_nyc <- st_read("data-prep/raw/parks_filtered.geojson", quiet = TRUE) %>%
  st_make_valid() %>%
  st_transform(32618) %>%
  mutate(
    source    = "nyc_parks",
    park_name = signname,
    area_sqm  = as.numeric(st_area(.))
  ) %>%
  select(park_name, borough, source, area_sqm)

message("  ✓ ", nrow(parks_nyc), " NYC Parks properties loaded")

# ── 2. FETCH OSM PARKS BY BOROUGH ─────────────────────────────────────────────
message("Fetching OSM parks by borough...")

borough_bboxes <- list(
  Manhattan_N    = c(xmin=-74.02, ymin=40.78, xmax=-73.91, ymax=40.88),
  Manhattan_S    = c(xmin=-74.02, ymin=40.69, xmax=-73.91, ymax=40.78),
  Brooklyn_N     = c(xmin=-74.04, ymin=40.64, xmax=-73.83, ymax=40.74),
  Brooklyn_S     = c(xmin=-74.04, ymin=40.57, xmax=-73.83, ymax=40.64),
  Queens_N       = c(xmin=-73.96, ymin=40.68, xmax=-73.70, ymax=40.81),
  Queens_S       = c(xmin=-73.96, ymin=40.54, xmax=-73.70, ymax=40.68),
  Bronx_W        = c(xmin=-73.93, ymin=40.78, xmax=-73.84, ymax=40.92),
  Bronx_E        = c(xmin=-73.84, ymin=40.78, xmax=-73.75, ymax=40.92),
  StatenIsland_N = c(xmin=-74.26, ymin=40.57, xmax=-74.03, ymax=40.65),
  StatenIsland_S = c(xmin=-74.26, ymin=40.49, xmax=-74.03, ymax=40.57)
)

osm_parks_list <- list()

for (boro in names(borough_bboxes)) {
  message("  → Fetching ", boro, "...")
  
  tryCatch({
    result <- opq(bbox = borough_bboxes[[boro]]) %>%
      add_osm_feature(key = "leisure", value = "park") %>%
      osmdata_sf()
    
    polys <- result$osm_polygons
    
    if (!is.null(polys) && nrow(polys) > 0) {
      osm_parks_list[[boro]] <- polys %>%
        st_make_valid() %>%
        st_transform(32618) %>%
        mutate(borough_name = boro) %>%
        select(osm_id, name, borough_name)
      
      message("    ✓ ", nrow(polys), " OSM park polygons")
    }
  }, error = function(e) {
    message("    ✗ Error fetching ", boro, ": ", e$message)
  })
  
  Sys.sleep(3)
}

osm_all <- bind_rows(osm_parks_list)
message("  ✓ ", nrow(osm_all), " total OSM park polygons fetched")

# ── 3. FILTER OSM PARKS ────────────────────────────────────────────────────────
message("Filtering OSM parks...")

osm_filtered <- osm_all %>%
  filter(
    !is.na(name),
    nchar(name) > 0
  ) %>%
  mutate(area_sqm = as.numeric(st_area(.))) %>%
  filter(area_sqm >= 1500)

message("  ✓ ", nrow(osm_filtered), " OSM parks after filtering")

# ── 4. REMOVE OSM PARKS THAT OVERLAP WITH NYC PARKS ───────────────────────────
message("Removing OSM parks that overlap with NYC Parks properties...")

parks_nyc_buffered <- parks_nyc %>% st_buffer(10)

overlaps <- lengths(st_intersects(osm_filtered, parks_nyc_buffered)) > 0

osm_new <- osm_filtered %>%
  filter(!overlaps) %>%
  mutate(
    source    = "osm",
    park_name = name,
    borough   = case_when(
      grepl("Manhattan",    borough_name) ~ "M",
      grepl("Brooklyn",     borough_name) ~ "B",
      grepl("Queens",       borough_name) ~ "Q",
      grepl("Bronx",        borough_name) ~ "X",
      grepl("StatenIsland", borough_name) ~ "R"
    )
  ) %>%
  select(park_name, borough, source, area_sqm)

message("  ✓ ", nrow(osm_new), " OSM parks not in NYC Parks dataset")

# ── 5. COMBINE AND SAVE ────────────────────────────────────────────────────────
message("Building unified parks layer...")

parks_unified <- bind_rows(parks_nyc, osm_new)

message("  ✓ Total parks: ", nrow(parks_unified))
message("  → NYC Parks: ", sum(parks_unified$source == "nyc_parks"))
message("  → OSM only:  ", sum(parks_unified$source == "osm"))
message("  Borough breakdown:")
print(parks_unified %>%
        st_drop_geometry() %>%
        count(borough, source) %>%
        arrange(borough))

parks_unified %>%
  st_transform(4326) %>%
  st_write("data-prep/raw/parks_unified.geojson", delete_dsn = TRUE)

message("  ✓ Saved to data-prep/raw/parks_unified.geojson")
message("\nDone. Update 02_score.R to use parks_unified.geojson")