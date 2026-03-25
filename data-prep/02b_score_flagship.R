# =============================================================================
# 02b_score_flagship.R
# Generates H3 res 10 flagship park walk proximity scores for all NYC cells
#
# INPUTS
#   data-prep/raw/parks.geojson          - raw NYC Parks data (has typecategory)
#   data-prep/raw/nta.geojson            - neighborhood boundaries
#
# OUTPUTS
#   data-prep/processed/hex_scores_flagship_walk.geojson  - H3 cell scores
#   data-prep/processed/nta_scores_flagship_walk.geojson  - NTA scores
#
# SCORING
#   Destinations: NYC Parks Flagship Parks only (15 parks)
#   Method:       H3 hop distance with 1.4x circuity factor
#   Thresholds:   A <12 min, B 12-26, C 26-38, D 38-50, F 50+
#   Max hops:     23 (hop 23 = 51.9 min, first hop beyond F threshold)
#
# NOTES
#   - Run locally on M3
#   - Uses same hex grid and NTA boundaries as 02_score.R
#   - Flagship Parks defined by typecategory == "Flagship Park" in NYC Open Data
# =============================================================================

library(tidyverse)
library(sf)
library(h3jsr)

dir.create("data-prep/processed", recursive = TRUE, showWarnings = FALSE)

# =============================================================================
# 1. Load inputs
# =============================================================================
cat("Loading inputs...\n")

parks_raw <- st_read("data-prep/raw/parks.geojson")
nta       <- st_read("data-prep/raw/nta.geojson")

# Filter to Flagship Parks only
flagship <- parks_raw |>
  filter(typecategory == "Flagship Park") |>
  st_make_valid() |>
  st_transform(4326) |>
  mutate(park_name = signname, park_id = row_number()) |>
  select(park_id, park_name, borough, acres, geometry)

cat("Flagship parks:  ", nrow(flagship), "\n")
flagship |>
  st_drop_geometry() |>
  arrange(desc(acres)) |>
  as.data.frame() |>
  print(row.names = FALSE)

# =============================================================================
# 2. Generate H3 res 10 cells covering residential NTAs
# =============================================================================
cat("\nGenerating H3 cells...\n")

nta_residential <- nta |>
  filter(!ntatype %in% c(5, 7, 8, 9))

cat("Residential NTAs:", nrow(nta_residential), "\n")

nyc_boundary_full <- nta |>
  st_transform(4326) |>
  st_make_valid() |>
  st_union() |>
  st_make_valid() |>
  st_cast("MULTIPOLYGON")

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

# Clip to valid area (residential NTAs + flagship parks) with 150m buffer
valid_area <- bind_rows(
  nta_residential |> st_transform(4326) |> st_make_valid(),
  flagship |> select(geometry)
) |>
  st_union() |>
  st_make_valid() |>
  st_transform(6539) |>
  st_buffer(150) |>
  st_transform(4326)

hex_sf <- hex_sf |>
  filter(st_intersects(geometry, valid_area, sparse = FALSE)[,1])

hex_cells <- hex_sf$h3_index
cat("Total H3 cells after clip:", length(hex_cells), "\n")

# =============================================================================
# 3. Get H3 cells that intersect each Flagship Park
# =============================================================================
cat("\nAssigning flagship park cells...\n")

flagship_clean <- flagship |>
  st_cast("MULTIPOLYGON")

flagship_cells <- map_dfr(seq_len(nrow(flagship_clean)), ~{
  tryCatch({
    cells <- polygon_to_cells(flagship_clean[.x, ], res = 10) |>
      unlist()
    
    if (is.null(cells) || length(cells) == 0 || all(is.na(cells))) {
      centroid <- flagship_clean[.x, ] |> st_centroid()
      cells    <- point_to_cell(centroid, res = 10)
      cat("Centroid fallback:", flagship_clean$park_name[.x], "\n")
    }
    
    if (is.null(cells) || length(cells) == 0 || all(is.na(cells))) return(NULL)
    
    cells <- cells[is_valid(cells)]
    if (length(cells) == 0) return(NULL)
    
    tibble(
      h3_index  = cells,
      park_id   = flagship_clean$park_id[.x],
      park_name = flagship_clean$park_name[.x]
    )
  }, error = function(e) {
    cat("Skipped:", flagship_clean$park_name[.x], "\n")
    NULL
  })
})

cat("Cells inside flagship parks:", n_distinct(flagship_cells$h3_index), "\n")

# =============================================================================
# 4. Score all cells by hop distance to nearest Flagship Park
# Max hops = 23 (hop 23 = 51.9 min, first hop past F threshold of 50 min)
# =============================================================================
cat("\nScoring cells by hop distance...\n")

walk_minutes_flagship <- function(hops) {
  round((hops * 131 + 79) * 1.4 / 5000 * 60, 1)
}

assign_grade_flagship <- function(walk_mins) {
  case_when(
    walk_mins == 0 ~ "A",
    walk_mins < 12 ~ "A",
    walk_mins < 26 ~ "B",
    walk_mins < 38 ~ "C",
    walk_mins < 50 ~ "D",
    TRUE           ~ "F"
  )
}

all_scores <- map_dfr(seq_len(nrow(flagship_clean)), ~{
  p_name  <- flagship_clean$park_name[.x]
  p_id    <- flagship_clean$park_id[.x]
  p_cells <- flagship_cells |>
    filter(park_id == p_id) |>
    pull(h3_index)
  
  if (length(p_cells) == 0) return(NULL)
  
  scored <- tibble(
    h3_index  = p_cells,
    min_hops  = 0L,
    park_name = p_name
  )
  
  already_scored <- p_cells
  
  for (k in 1:23) {
    ring_k <- get_disk(p_cells, ring_size = k) |>
      unlist() |>
      unique()
    
    new_cells <- ring_k[!ring_k %in% already_scored]
    if (length(new_cells) == 0) next
    
    scored <- bind_rows(scored, tibble(
      h3_index  = new_cells,
      min_hops  = as.integer(k),
      park_name = p_name
    ))
    
    already_scored <- c(already_scored, new_cells)
  }
  
  scored
}, .progress = TRUE)

cat("Raw scored rows:", nrow(all_scores), "\n")

# =============================================================================
# 5. Keep best score per cell (closest flagship park wins)
# =============================================================================
cat("\nResolving best score per cell...\n")

hex_scores <- all_scores |>
  filter(h3_index %in% hex_cells) |>
  mutate(
    walk_mins = if_else(min_hops == 0, 0, walk_minutes_flagship(min_hops)),
    grade     = assign_grade_flagship(walk_mins)
  ) |>
  group_by(h3_index) |>
  arrange(walk_mins) |>
  slice(1) |>
  ungroup() |>
  select(h3_index, grade, hops = min_hops, walk_mins,
         nearest_flagship = park_name)

cat("Unique scored cells:", nrow(hex_scores), "\n")
cat("\nGrade distribution:\n")
hex_scores |>
  count(grade) |>
  arrange(match(grade, c("A","B","C","D","F"))) |>
  print()

# =============================================================================
# 6. Join NTA names
# =============================================================================
cat("\nJoining NTA names...\n")

hex_sf_scored <- hex_sf |>
  st_join(select(nta_residential, nta = ntaname),
          join = st_nearest_feature) |>
  left_join(hex_scores, by = "h3_index") |>
  mutate(
    grade = replace_na(grade, "F"),
    hops  = replace_na(hops, NA_integer_)
  )

cat("hex_sf_scored rows:", nrow(hex_sf_scored), "\n")

# =============================================================================
# 7. Convert to hex polygons
# =============================================================================
cat("\nConverting to hex polygons...\n")

hex_final <- hex_sf_scored |>
  mutate(geometry = cell_to_polygon(h3_index) |> st_sfc(crs = 4326)) |>
  st_set_geometry("geometry") |>
  mutate(
    nearest_flagship = if_else(is.na(nearest_flagship),
                               "No flagship nearby", nearest_flagship),
    nta              = if_else(is.na(nta), "NYC", nta)
  )

cat("hex_final rows:", nrow(hex_final), "\n")

# =============================================================================
# 8. Calculate NTA scores
# =============================================================================
cat("\nCalculating NTA scores...\n")

grade_to_num <- c("A" = 1, "B" = 2, "C" = 3, "D" = 4, "F" = 5)
num_to_grade <- c("1" = "A", "2" = "B", "3" = "C", "4" = "D", "5" = "F")

nta_scores <- hex_final |>
  st_drop_geometry() |>
  filter(!is.na(grade), grade %in% names(grade_to_num)) |>
  mutate(grade_num = grade_to_num[grade]) |>
  group_by(nta) |>
  summarise(
    median_grade_num = round(median(grade_num, na.rm = TRUE)),
    cell_count       = n(),
    pct_ab           = round(mean(grade %in% c("A","B")) * 100),
    pct_a            = round(mean(grade == "A") * 100),
    pct_f            = round(mean(grade == "F") * 100),
    .groups          = "drop"
  ) |>
  mutate(grade = num_to_grade[as.character(median_grade_num)]) |>
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
# 9. Save outputs
# =============================================================================
cat("\nSaving outputs...\n")

hex_final |>
  st_set_precision(1e5) |>
  st_write("data-prep/processed/hex_scores_flagship_walk.geojson",
           delete_dsn = TRUE)

nta_scored |>
  st_set_precision(1e5) |>
  st_write("data-prep/processed/nta_scores_flagship_walk.geojson",
           delete_dsn = TRUE)

cat("\n── OUTPUT SUMMARY ──────────────────────────────\n")
cat("hex_scores_flagship_walk.geojson\n")
cat("  Features:  ", nrow(hex_final), "\n")
cat("  Fields:    h3_index, grade, hops, walk_mins,\n")
cat("             nearest_flagship, nta\n\n")
cat("nta_scores_flagship_walk.geojson\n")
cat("  Features:  ", nrow(nta_scored), "\n")
cat("  Fields:    nta, grade, cell_count, pct_ab, pct_a, pct_f\n\n")
cat("Grade distribution (hex cells):\n")
hex_final |>
  st_drop_geometry() |>
  count(grade) |>
  arrange(match(grade, c("A","B","C","D","F"))) |>
  print()