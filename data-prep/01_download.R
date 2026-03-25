# 01_download.R
# Downloads all raw data needed for NYC park access scoring
# Run once. Saves everything to data-prep/raw/
# Project: GreenSpacesMap

library(tidyverse)
library(sf)
library(httr)
library(janitor)

dir.create("data-prep/raw", recursive = TRUE, showWarnings = FALSE)

# ── 1. NTA BOUNDARIES (2020) ───────────────────────────────────────────────────
message("Downloading NTA boundaries...")

nta <- st_read(
  "https://data.cityofnewyork.us/resource/9nt8-h7nd.geojson?$limit=1000",
  quiet = TRUE
)

st_write(nta, "data-prep/raw/nta.geojson", delete_dsn = TRUE)
message("  ✓ ", nrow(nta), " NTAs saved")

# ── 2. PARKS PROPERTIES ────────────────────────────────────────────────────────
message("Downloading parks properties...")

parks_sf <- read_csv(
  "https://data.cityofnewyork.us/resource/enfh-gkve.csv?$limit=5000",
  show_col_types = FALSE
) %>%
  filter(!is.na(multipolygon)) %>%
  st_as_sf(wkt = "multipolygon", crs = 4326)

st_write(parks_sf, "data-prep/raw/parks.geojson", delete_dsn = TRUE)
message("  ✓ ", nrow(parks_sf), " parks saved")

# ── 3. MTA SUBWAY STATIONS + ADA ───────────────────────────────────────────────
message("Downloading MTA subway stations...")

subway_sf <- read_csv(
  "https://data.ny.gov/api/views/39hk-dx4f/rows.csv?accessType=DOWNLOAD",
  show_col_types = FALSE
) %>%
  clean_names() %>%
  filter(!is.na(gtfs_latitude), !is.na(gtfs_longitude)) %>%
  mutate(
    ada_status = case_when(
      ada == 1 ~ "Fully accessible",
      ada == 2 ~ "Partially accessible",
      ada == 0 ~ "Not accessible",
      TRUE     ~ "Unknown"
    )
  ) %>%
  st_as_sf(coords = c("gtfs_longitude", "gtfs_latitude"), crs = 4326)

st_write(subway_sf, "data-prep/raw/subway.geojson", delete_dsn = TRUE)
message("  ✓ ", nrow(subway_sf), " subway stations saved")
message("  → ADA breakdown:")
print(st_drop_geometry(subway_sf) %>% count(ada_status))

# ── 4. MTA BUS STOPS ───────────────────────────────────────────────────────────
message("Downloading MTA bus stops...")

bus_sf <- read_csv(
  "https://data.ny.gov/api/views/ai5j-txmn/rows.csv?accessType=DOWNLOAD",
  show_col_types = FALSE
) %>%
  clean_names() %>%
  filter(revenue_stop == TRUE, !is.na(latitude), !is.na(longitude)) %>%
  distinct(stop_id, .keep_all = TRUE) %>%
  st_as_sf(coords = c("longitude", "latitude"), crs = 4326)

st_write(bus_sf, "data-prep/raw/bus_stops.geojson", delete_dsn = TRUE)
message("  ✓ ", nrow(bus_sf), " bus stops saved")

# ── DONE ───────────────────────────────────────────────────────────────────────
message("\nAll raw data downloaded:")
list.files("data-prep/raw/")
message("Run 02_score.R next.")