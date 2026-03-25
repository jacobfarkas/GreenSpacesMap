# =============================================================================
# 02c_flagship_display.R
# Extracts Flagship Park polygons for map display
#
# INPUTS
#   data-prep/raw/parks.geojson  - raw NYC Parks data (has typecategory)
#
# OUTPUTS
#   data-prep/processed/flagship_display.geojson  - 15 flagship park polygons
#
# NOTES
#   - Flagship Parks defined by typecategory == "Flagship Park" in NYC Open Data
#   - Used on both walk score map and flagship score map
#   - Displayed with gold border to distinguish from standard parks
# =============================================================================

library(tidyverse)
library(sf)

dir.create("data-prep/processed", recursive = TRUE, showWarnings = FALSE)

# =============================================================================
# 1. Load and filter Flagship Parks
# =============================================================================
cat("Loading parks...\n")

flagship_display <- st_read("data-prep/raw/parks.geojson") |>
  filter(typecategory == "Flagship Park") |>
  st_make_valid() |>
  st_transform(4326) |>
  select(
    park_name = signname,
    borough,
    acres,
    geometry
  )

cat("Flagship parks:", nrow(flagship_display), "\n")
flagship_display |>
  st_drop_geometry() |>
  arrange(desc(acres)) |>
  as.data.frame() |>
  print(row.names = FALSE)

# =============================================================================
# 2. Save
# =============================================================================
flagship_display |>
  st_set_precision(1e5) |>
  st_write("data-prep/processed/flagship_display.geojson",
           delete_dsn = TRUE)

cat("\nSaved: data-prep/processed/flagship_display.geojson\n")
cat("Features:", nrow(flagship_display), "\n")
cat("Fields:   park_name, borough, acres\n")