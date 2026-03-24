# =============================================================================
# 01c_tree_filter.R
# Filters parks_unified.geojson to only include genuine green spaces
# using NYC Parks Forestry Tree Points as a proxy for tree cover
#
# INPUTS
#   data-prep/raw/parks_unified.geojson
#   data-prep/raw/Forestry_Tree_Points_20260324.csv
#
# OUTPUTS
#   data-prep/raw/parks_with_tree_counts.csv    - tree count per park (for review)
#   data-prep/raw/parks_unified_filtered.geojson - parks passing tree threshold
#
# METHODOLOGY
#   - Load Forestry Tree Points (already filtered to non-retired trees)
#   - Convert to sf point geometry
#   - Spatial join against park polygons
#   - Count trees per park
#   - Show distribution to inform threshold decision
#   - Filter parks below threshold and save
#
# NOTES
#   - Run locally on M3 (887k tree points, memory intensive)
#   - OSM-only parks may have lower counts - NYC Forestry only tracks
#     NYC Parks-managed trees, not state/federal/private park trees
#   - Threshold X is set manually after reviewing distribution
# =============================================================================

library(tidyverse)
library(sf)

# =============================================================================
# 1. Load inputs
# =============================================================================
cat("Loading inputs...\n")

parks <- st_read("data-prep/raw/parks_unified.geojson")
cat("Parks loaded:", nrow(parks), "\n")

trees_raw <- read_csv(
  "data-prep/raw/Forestry_Tree_Points_20260324.csv",
  show_col_types = FALSE
)
cat("Tree points loaded:", nrow(trees_raw), "\n")
cat("Tree columns:", paste(names(trees_raw), collapse = ", "), "\n")

# =============================================================================
# 2. Convert trees to sf points
# =============================================================================
cat("\nConverting trees to spatial points...\n")

trees_sf <- trees_raw |>
  filter(!is.na(Geometry)) |>
  st_as_sf(wkt = "Geometry", crs = 4326) |>
  select(objectid = OBJECTID, condition = TPCondition, structure = TPStructure)

cat("Tree points converted:", nrow(trees_sf), "\n")

# =============================================================================
# 3. Spatial join - count trees per park
# =============================================================================
cat("\nCounting trees per park polygon (slow step - ~5 min on M3)...\n")

# Project to meters for accurate spatial join
parks_proj  <- parks  |> st_transform(6539)
trees_proj  <- trees_sf |> st_transform(6539)

# Join trees to parks
trees_in_parks <- st_join(trees_proj, parks_proj, join = st_within)

# Count per park
tree_counts <- trees_in_parks |>
  st_drop_geometry() |>
  filter(!is.na(park_name)) |>
  group_by(park_name, borough) |>
  summarise(tree_count = n(), .groups = "drop") |>
  arrange(desc(tree_count))

cat("Parks with at least one tree:", nrow(tree_counts), "\n")

# Join counts back to all parks (parks with 0 trees get NA -> 0)
parks_counted <- parks |>
  left_join(tree_counts, by = c("park_name", "borough")) |>
  mutate(tree_count = replace_na(tree_count, 0))

# =============================================================================
# 4. Show distribution
# =============================================================================
cat("\n── TREE COUNT DISTRIBUTION ─────────────────────────\n")
cat("Parks with 0 trees:       ", sum(parks_counted$tree_count == 0), "\n")
cat("Parks with 1-4 trees:     ", sum(parks_counted$tree_count >= 1  & parks_counted$tree_count <= 4), "\n")
cat("Parks with 5-9 trees:     ", sum(parks_counted$tree_count >= 5  & parks_counted$tree_count <= 9), "\n")
cat("Parks with 10-19 trees:   ", sum(parks_counted$tree_count >= 10 & parks_counted$tree_count <= 19), "\n")
cat("Parks with 20-49 trees:   ", sum(parks_counted$tree_count >= 20 & parks_counted$tree_count <= 49), "\n")
cat("Parks with 50-99 trees:   ", sum(parks_counted$tree_count >= 50 & parks_counted$tree_count <= 99), "\n")
cat("Parks with 100+ trees:    ", sum(parks_counted$tree_count >= 100), "\n")
cat("\nMedian tree count:        ", median(parks_counted$tree_count), "\n")
cat("Mean tree count:          ", round(mean(parks_counted$tree_count), 1), "\n")

cat("\n── BOTTOM 30 PARKS BY TREE COUNT ───────────────────\n")
parks_counted |>
  st_drop_geometry() |>
  arrange(tree_count) |>
  select(park_name, borough, source, area_sqm, tree_count) |>
  head(30) |>
  as.data.frame() |>
  print(row.names = FALSE)

cat("\n── OSM PARKS TREE COUNT SUMMARY ────────────────────\n")
parks_counted |>
  st_drop_geometry() |>
  filter(source == "osm") |>
  summarise(
    total      = n(),
    zero_trees = sum(tree_count == 0),
    median     = median(tree_count),
    mean       = round(mean(tree_count), 1)
  ) |>
  print()

# =============================================================================
# 5. Save tree counts for review
# =============================================================================
parks_counted |>
  st_drop_geometry() |>
  select(park_name, borough, source, area_sqm, park_size, tree_count) |>
  arrange(tree_count) |>
  write_csv("data-prep/raw/parks_with_tree_counts.csv")

cat("\nSaved: data-prep/raw/parks_with_tree_counts.csv\n")
cat("\nReview the distribution above, then set TREE_THRESHOLD below\n")
cat("and run section 6 to generate parks_unified_filtered.geojson\n")

# =============================================================================
# 6. Apply hybrid threshold and save filtered parks
# Rule: tree_count >= 10 OR area_sqm >= 40000
# Large natural areas (wetlands, shoreline) pass on size even with few trees
# Small playgrounds, gardens, ballfields fail both tests and are removed
# =============================================================================

parks_filtered <- parks_counted |>
  filter(tree_count >= 10 | area_sqm >= 40000)

cat("\n── FILTERED PARKS ──────────────────────────────────\n")
cat("Rule:                   tree_count >= 10 OR area_sqm >= 40000\n")
cat("Parks before filter:    ", nrow(parks_counted), "\n")
cat("Parks after filter:     ", nrow(parks_filtered), "\n")
cat("Parks removed:          ", nrow(parks_counted) - nrow(parks_filtered), "\n")
cat("NYC Open Data remaining:", sum(parks_filtered$source == "nyc_open_data"), "\n")
cat("OSM remaining:          ", sum(parks_filtered$source == "osm"), "\n")
cat("Large parks remaining:  ", sum(parks_filtered$park_size == "large"), "\n")
cat("Standard parks remaining:", sum(parks_filtered$park_size == "standard"), "\n")

parks_filtered |>
  select(park_name, borough, source, area_sqm, park_size, tree_count, geometry) |>
  st_set_precision(1e5) |>
  st_write("data-prep/raw/parks_unified_filtered.geojson",
           delete_dsn = TRUE)

cat("\nSaved: data-prep/raw/parks_unified_filtered.geojson\n")