# =============================================================================
# 02_score.R
# Generates H3 res 10 park proximity scores for all NYC cells
#
# INPUTS
#   data-prep/raw/parks_unified.geojson
#   data-prep/raw/nta.geojson
#
# OUTPUTS
#   data-prep/processed/parks_display.geojson    - park polygons for map
#   data-prep/processed/hex_scores_parks.geojson - scored hex grid
#
# NOTES
#   - Run locally on M3, then upload outputs to Posit Cloud
#   - h3jsr 1.3.1: get_disk() and grid_distance()
#   - Excludes cemeteries (ntatype 7), airports (ntatype 8), Rikers (ntatype 5)
#   - Excludes Ellis Island, Governors Island, Liberty Island
#   - K cells outside park boundary recoded to A
# =============================================================================

library(tidyverse)
library(sf)
library(h3jsr)

dir.create("data-prep/processed", recursive = TRUE, showWarnings = FALSE)

# =============================================================================
# 1. Load inputs
# =============================================================================
cat("Loading inputs...\n")

parks <- st_read("data-prep/raw/parks_unified_filtered.geojson")
nta   <- st_read("data-prep/raw/nta.geojson")

cat("Parks loaded:   ", nrow(parks), "\n")
cat("Large parks:    ", sum(parks$park_size == "large"), "\n")
cat("Standard parks: ", sum(parks$park_size == "standard"), "\n")
cat("NTAs loaded:    ", nrow(nta), "\n")

# =============================================================================
# 2. Generate H3 res 10 cells covering full NYC boundary
# =============================================================================
cat("\nGenerating H3 cells...\n")

nta_residential <- nta |>
  filter(!ntatype %in% c(5, 7, 8, 9))

cat("Residential NTAs:", nrow(nta_residential), "\n")

# Use FULL NYC boundary for hex generation (smooth edges)
# Non-residential cells excluded in step 6 via inner join
nyc_boundary_full <- nta |>
  st_transform(4326) |>
  st_make_valid() |>
  st_union() |>
  st_make_valid() |>
  st_cast("MULTIPOLYGON")

cat("Boundary type: ", as.character(st_geometry_type(nyc_boundary_full)), "\n")
cat("Boundary valid:", st_is_valid(nyc_boundary_full), "\n")

hex_cells <- polygon_to_cells(
  st_sf(geometry = st_sfc(nyc_boundary_full, crs = 4326)),
  res = 10
) |>
  unlist() |>
  unique()

cat("Total H3 cells before clip:", length(hex_cells), "\n")

hex_sf <- tibble(h3_index = hex_cells) |>
  mutate(geometry = cell_to_point(h3_index) |> st_sfc(crs = 4326)) |>
  st_as_sf()

# Keep cells that intersect any NTA polygon (less aggressive than st_within)
hex_sf <- hex_sf |>
  st_filter(nta, .predicate = st_intersects)

hex_cells <- hex_sf$h3_index

cat("Total H3 cells after clip:", length(hex_cells), "\n")

# =============================================================================
# 3. Get H3 cells that intersect each park
# =============================================================================
cat("\nAssigning park cells...\n")

parks_clean <- parks |>
  st_transform(4326) |>
  st_make_valid() |>
  filter(!st_is_empty(geometry)) |>
  st_cast("MULTIPOLYGON") |>
  mutate(park_id = row_number())

park_cells <- map_dfr(seq_len(nrow(parks_clean)), ~{
  tryCatch({
    cells <- polygon_to_cells(parks_clean[.x, ], res = 10) |>
      unlist()
    
    # Fallback to centroid if polygon_to_cells returns nothing or NA
    if (is.null(cells) || length(cells) == 0 || all(is.na(cells))) {
      centroid <- parks_clean[.x, ] |> st_centroid()
      cells    <- point_to_cell(centroid, res = 10)
      cat("Centroid fallback:", parks_clean$park_name[.x], "\n")
    }
    
    if (is.null(cells) || length(cells) == 0 || all(is.na(cells))) return(NULL)
    
    cells <- cells[is_valid(cells)]
    if (length(cells) == 0) return(NULL)
    
    tibble(
      h3_index  = cells,
      park_id   = parks_clean$park_id[.x],
      park_name = parks_clean$park_name[.x],
      park_size = parks_clean$park_size[.x]
    )
  }, error = function(e) {
    cat("Skipped park:", parks_clean$park_name[.x], "\n")
    NULL
  })
})

cat("Cells inside parks:   ", n_distinct(park_cells$h3_index), "\n")
cat("Total park-cell rows: ", nrow(park_cells), "\n")
cat("Note: parks using centroid fallback are logged above\n")

# =============================================================================
# 4. Score all cells by hop distance from nearest park (fast method)
# =============================================================================
cat("\nScoring cells by hop distance (fast method)...\n")

assign_grade <- function(hops, park_size) {
  case_when(
    hops == 0  ~ "K",
    hops <= 2  ~ "A",
    hops == 3  ~ "B",
    hops <= 5  ~ "C",
    hops <= 7  ~ "D",
    TRUE       ~ "F"
  )
}

walk_minutes <- function(hops) {
  round((hops * 131 + 79) / 5000 * 60, 1)
}

all_scores <- map_dfr(seq_len(nrow(parks_clean)), ~{
  p_name  <- parks_clean$park_name[.x]
  p_size  <- parks_clean$park_size[.x]
  p_id    <- parks_clean$park_id[.x]
  p_cells <- park_cells |>
    filter(park_id == p_id) |>
    pull(h3_index)
  
  if (length(p_cells) == 0) return(NULL)
  
  scored <- tibble(
    h3_index  = p_cells,
    min_hops  = 0L,
    park_name = p_name,
    park_size = p_size
  )
  
  already_scored <- p_cells
  
  for (k in 1:15) {
    ring_k <- get_disk(p_cells, ring_size = k) |>
      unlist() |>
      unique()
    
    new_cells <- ring_k[!ring_k %in% already_scored]
    if (length(new_cells) == 0) next
    
    scored <- bind_rows(scored, tibble(
      h3_index  = new_cells,
      min_hops  = as.integer(k),
      park_name = p_name,
      park_size = p_size
    ))
    
    already_scored <- c(already_scored, new_cells)
  }
  
  scored
}, .progress = TRUE)

cat("Raw scored rows:", nrow(all_scores), "\n")

# =============================================================================
# 5. Keep best score per cell
# =============================================================================
cat("\nResolving best score per cell...\n")

assign_grade <- function(hops, park_size) {
  case_when(
    hops == 0  ~ "K",
    hops <= 2  ~ "A",
    hops == 3  ~ "B",
    hops <= 5  ~ "C",
    hops <= 7  ~ "D",
    TRUE       ~ "F"
  )
}

walk_minutes <- function(hops) {
  round((hops * 131 + 79) * 1.4 / 5000 * 60, 1)
}

hex_scores <- all_scores |>
  filter(h3_index %in% hex_cells) |>
  mutate(
    grade = assign_grade(min_hops, park_size),
    walk_mins = if_else(min_hops == 0, 0, walk_minutes(min_hops)),
    grade_order = case_when(
      grade == "K" ~ 0,
      grade == "A" ~ 1,
      grade == "B" ~ 2,
      grade == "C" ~ 3,
      grade == "D" ~ 4,
      grade == "F" ~ 5
    )
  ) |>
  group_by(h3_index) |>
  arrange(grade_order, min_hops) |>
  slice(1) |>
  ungroup() |>
  select(h3_index, grade, hops = min_hops, walk_mins,
         nearest_park = park_name, park_size)

cat("Unique scored cells:", nrow(hex_scores), "\n")
cat("\nGrade distribution:\n")
hex_scores |>
  count(grade) |>
  arrange(match(grade, c("K", "A", "B", "C", "D", "F"))) |>
  print()

# =============================================================================
# 6. Join NTA names
# =============================================================================
cat("\nJoining NTA names...\n")

# Build residential + parks union to capture all valid cells
parks_sf <- st_read("data-prep/raw/parks_unified.geojson") |>
  st_make_valid()

valid_area <- bind_rows(
  nta_residential |> st_transform(4326) |> st_make_valid(),
  parks_sf |> select(geometry)
) |>
  st_union() |>
  st_make_valid() |>
  st_transform(6539) |>
  st_buffer(150) |>
  st_transform(4326)

# Keep cells within valid area
hex_sf_valid <- hex_sf |>
  filter(st_intersects(geometry, valid_area, sparse = FALSE)[,1])

# Assign nearest residential NTA name
hex_sf_scored <- hex_sf_valid |>
  st_join(select(nta_residential, nta = ntaname),
          join = st_nearest_feature) |>
  left_join(hex_scores, by = "h3_index") |>
  mutate(
    grade = replace_na(grade, "F"),
    hops  = replace_na(hops, NA_integer_)
  )

cat("hex_sf_scored rows:", nrow(hex_sf_scored), "\n")

# =============================================================================
# 7. Convert to hex polygons - park polygon renders on top
# =============================================================================
cat("\nConverting to hex polygons...\n")

hex_final <- hex_sf_scored |>
  mutate(geometry = cell_to_polygon(h3_index) |> st_sfc(crs = 4326)) |>
  st_set_geometry("geometry") |>
  mutate(
    portion      = "full_cell",
    grade        = if_else(grade == "K", "A", grade),
    hops         = if_else(hops == 0L, 1L, hops),
    walk_mins    = if_else(walk_mins == 0, walk_minutes(1L), walk_mins),
    nearest_park = if_else(is.na(nearest_park), "Nearby park", nearest_park),
    nta          = if_else(is.na(nta), "NYC", nta)
  )

cat("hex_final rows:", nrow(hex_final), "\n")

# =============================================================================
# 8. Save outputs
# =============================================================================
cat("\nSaving outputs...\n")

parks_display <- parks |>
  select(park_name, borough, park_size, area_sqm) |>
  st_set_precision(1e5)

hex_final <- hex_final |>
  st_set_precision(1e5)

st_write(parks_display,
         "data-prep/processed/parks_display.geojson",
         delete_dsn = TRUE)

st_write(hex_final,
         "data-prep/processed/hex_scores_parks.geojson",
         delete_dsn = TRUE)

cat("parks_display.geojson saved\n")
cat("hex_scores_parks.geojson saved\n")

# =============================================================================
# 9. Summary
# =============================================================================
cat("\nOUTPUT SUMMARY\n")
cat("parks_display.geojson\n")
cat("  Features:  ", nrow(parks_display), "\n")
cat("  Fields:    park_name, borough, park_size, area_sqm\n\n")
cat("hex_scores_parks.geojson\n")
cat("  Features:  ", nrow(hex_final), "\n\n")
cat("Grade distribution:\n")
hex_final |>
  st_drop_geometry() |>
  count(grade) |>
  arrange(match(grade, c("A", "B", "C", "D", "F"))) |>
  print()

# =============================================================================
# 10. Calculate NTA scores
# =============================================================================
cat("\nCalculating NTA scores...\n")

nta_scores <- hex_final |>
  st_drop_geometry() |>
  filter(!is.na(grade), grade %in% c("A", "B", "C", "D", "F")) |>
  group_by(nta) |>
  summarise(
    cell_count = n(),
    pct_ab     = round(mean(grade %in% c("A", "B")) * 100),
    pct_a      = round(mean(grade == "A") * 100),
    pct_f      = round(mean(grade == "F") * 100),
    .groups    = "drop"
  ) |>
  mutate(
    grade = case_when(
      pct_ab >= 80 ~ "A",
      pct_ab >= 60 ~ "B",
      pct_ab >= 40 ~ "C",
      pct_ab >= 20 ~ "D",
      TRUE         ~ "F"
    )
  ) |>
  select(nta, grade, cell_count, pct_ab, pct_a, pct_f)

nta_scored <- nta_residential |>
  select(nta = ntaname, geometry) |>
  left_join(nta_scores, by = "nta") |>
  filter(!is.na(grade))

cat("NTA features scored:", nrow(nta_scored), "\n")
cat("\nNTA grade distribution:\n")
nta_scored |>
  st_drop_geometry() |>
  count(grade) |>
  arrange(match(grade, c("A","B","C","D","F"))) |>
  print()

# =============================================================================
# 11. Save NTA scores
# =============================================================================
cat("\nSaving NTA scores...\n")

nta_scored <- nta_scored |>
  st_set_precision(1e5)

st_write(nta_scored,
         "data-prep/processed/nta_scores.geojson",
         delete_dsn = TRUE)

cat("nta_scores.geojson saved\n")