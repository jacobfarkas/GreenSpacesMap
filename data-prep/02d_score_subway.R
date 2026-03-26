# =============================================================================
# 02d_score_subway.R
# Scores H3 cells by subway access to NYC Flagship Parks
#
# INPUTS
#   data-prep/raw/subway.geojson                    - subway station locations
#   data-prep/raw/gtfs_subway/stops.txt             - GTFS stops
#   data-prep/raw/gtfs_subway/stop_times.txt        - GTFS timetable
#   data-prep/raw/gtfs_subway/trips.txt             - GTFS trips
#   data-prep/raw/gtfs_subway/transfers.txt         - GTFS transfers
#   data-prep/raw/parks.geojson                     - raw parks (for flagship)
#   data-prep/raw/nta.geojson                       - NTA boundaries
#   data-prep/processed/hex_scores_flagship_walk.geojson - walk fallback
#
# OUTPUTS
#   data-prep/processed/hex_scores_flagship_subway.geojson
#   data-prep/processed/nta_scores_flagship_subway.geojson
#
# METHODOLOGY
#   Trip time = walk to station (H3 hops) + subway ride (GTFS) + walk to park
#   Subway ride = best of: direct ride OR one-transfer ride (+ 5 min buffer)
#   If no subway route exists: fall back to flagship walk score
#   Final score = min(subway trip, walk score)
#
# GRADING (same thresholds as flagship walk score)
#   A: < 12 min   B: 12-26 min   C: 26-38 min   D: 38-50 min   F: > 50 min
#
# NOTES
#   - Run locally on M3
#   - stop_times.txt is 35MB, parsing takes ~2 min
#   - Cell scoring loop takes ~10 min on M3
#   - Single transfer only — multi-transfer routing not implemented
# =============================================================================

library(tidyverse)
library(sf)
library(h3jsr)

dir.create("data-prep/processed", recursive = TRUE, showWarnings = FALSE)

# =============================================================================
# Walk time formula (same as walk score)
# =============================================================================
walk_mins_from_hops <- function(hops) {
  round((hops * 131 + 79) * 1.4 / 5000 * 60, 1)
}

assign_grade <- function(total_mins) {
  case_when(
    total_mins <  12 ~ "A",
    total_mins <  26 ~ "B",
    total_mins <  38 ~ "C",
    total_mins <  50 ~ "D",
    TRUE             ~ "F"
  )
}

TRANSFER_BUFFER_MINS <- 5
WALK_FROM_X_MINS     <- 5

# =============================================================================
# 1. Load inputs
# =============================================================================
cat("[1/9] Loading inputs...\n")

parks_raw   <- st_read("data-prep/raw/parks.geojson",   quiet = TRUE)
nta         <- st_read("data-prep/raw/nta.geojson",     quiet = TRUE)
subway_sf   <- st_read("data-prep/raw/subway.geojson",  quiet = TRUE)
walk_scores <- st_read("data-prep/processed/hex_scores_flagship_walk.geojson",
                       quiet = TRUE)

gtfs_dir    <- "data-prep/raw/gtfs_subway"
stops       <- read_csv(file.path(gtfs_dir, "stops.txt"),      show_col_types = FALSE)
trips       <- read_csv(file.path(gtfs_dir, "trips.txt"),      show_col_types = FALSE)
stop_times  <- read_csv(file.path(gtfs_dir, "stop_times.txt"), show_col_types = FALSE)
transfers   <- read_csv(file.path(gtfs_dir, "transfers.txt"),  show_col_types = FALSE)

cat("  Subway stations:  ", nrow(subway_sf), "\n")
cat("  GTFS stop times:  ", nrow(stop_times), "\n")
cat("  GTFS transfers:   ", nrow(transfers), "\n")

# Walk fallback lookup: h3_index -> walk_mins
walk_lookup <- walk_scores |>
  st_drop_geometry() |>
  select(h3_index, walk_mins)

# nearest_flagship lookup: h3_index -> nearest_flagship
walk_flagship_lookup <- walk_scores |>
  st_drop_geometry() |>
  select(h3_index, nearest_flagship)

# Flagship parks
flagship <- parks_raw |>
  filter(typecategory == "Flagship Park") |>
  st_make_valid() |>
  st_transform(32618) |>
  mutate(park_name = signname)

cat("  Flagship parks:   ", nrow(flagship), "\n")

# Residential NTAs
nta_residential <- nta |>
  filter(!ntatype %in% c(5, 7, 8, 9)) |>
  st_transform(4326)

# =============================================================================
# 2. Generate H3 cell grid
# =============================================================================
cat("[2/9] Generating H3 cell grid...\n")

nyc_boundary <- nta |>
  st_transform(4326) |>
  st_make_valid() |>
  st_union() |>
  st_cast("MULTIPOLYGON")

hex_cells <- polygon_to_cells(
  st_sf(geometry = st_sfc(nyc_boundary, crs = 4326)),
  res = 10
) |> unlist() |> unique()

hex_sf <- tibble(h3_index = hex_cells) |>
  mutate(geometry = cell_to_point(h3_index) |> st_sfc(crs = 4326)) |>
  st_as_sf()

valid_area <- nta_residential |>
  st_make_valid() |>
  st_union() |>
  st_transform(6539) |>
  st_buffer(150) |>
  st_transform(4326)

hex_sf <- hex_sf |>
  filter(st_intersects(geometry, valid_area, sparse = FALSE)[,1])

hex_cells <- hex_sf$h3_index
cat("  H3 cells:         ", length(hex_cells), "\n")

# =============================================================================
# 3. Find X stations — subway stations near Flagship Parks
# =============================================================================
cat("[3/9] Finding X stations (near flagship parks)...\n")

flagship_buffer <- flagship |>
  st_union() |>
  st_buffer(500)

subway_proj <- subway_sf |>
  st_transform(32618) |>
  mutate(gtfs_stop_id = as.character(gtfs_stop_id))

x_idx      <- st_within(subway_proj, flagship_buffer, sparse = FALSE)[,1]
x_stations <- subway_proj[x_idx, ]

cat("  X stations:", nrow(x_stations), "\n")
x_stations |>
  st_drop_geometry() |>
  select(stop_name, daytime_routes, ada_status) |>
  as.data.frame() |>
  print(row.names = FALSE)

x_stop_ids <- x_stations$gtfs_stop_id

# =============================================================================
# 4. Parse GTFS stop times
# =============================================================================
cat("[4/9] Parsing GTFS stop times (~2 min)...\n")

parse_gtfs_mins <- function(t) {
  parts <- str_split_fixed(t, ":", 3)
  as.numeric(parts[,1]) * 60 + as.numeric(parts[,2]) + as.numeric(parts[,3]) / 60
}

all_stop_ids <- unique(as.character(subway_sf$gtfs_stop_id))

stop_times_clean <- stop_times |>
  mutate(parent_stop_id = str_remove(stop_id, "[NS]$")) |>
  filter(parent_stop_id %in% all_stop_ids) |>
  filter(!is.na(departure_time)) |>
  mutate(dep_mins = parse_gtfs_mins(departure_time)) |>
  select(trip_id, parent_stop_id, stop_sequence, dep_mins)

cat("  Filtered stop times:", nrow(stop_times_clean), "\n")

# =============================================================================
# 5. Compute direct ride times Y -> X
# =============================================================================
cat("[5/9] Computing direct ride times...\n")

direct_ride <- map_dfr(x_stop_ids, function(x_id) {
  cat("  → Direct to X:", x_id, "\n")
  
  x_trips <- stop_times_clean |>
    filter(parent_stop_id == x_id) |>
    select(trip_id, x_seq = stop_sequence, x_dep = dep_mins)
  
  if (nrow(x_trips) == 0) return(NULL)
  
  stop_times_clean |>
    inner_join(x_trips, by = "trip_id") |>
    filter(stop_sequence < x_seq) |>
    mutate(travel_time = x_dep - dep_mins) |>
    filter(travel_time >= 0, travel_time <= 120) |>
    group_by(from_stop_id = parent_stop_id) |>
    summarise(
      median_ride_mins = round(median(travel_time), 1),
      .groups = "drop"
    ) |>
    mutate(to_x_station = x_id)
})

# Best direct ride from each station to any X
best_direct <- direct_ride |>
  group_by(from_stop_id) |>
  arrange(median_ride_mins) |>
  slice(1) |>
  ungroup()

cat("  Stations with direct ride:", nrow(best_direct), "\n")

# =============================================================================
# 6. Compute one-transfer ride times for unscored stations
# =============================================================================
cat("[6/9] Computing one-transfer ride times...\n")

transfer_pairs <- transfers |>
  mutate(
    from_stop_id = str_remove(from_stop_id, "[NS]$"),
    to_stop_id   = str_remove(to_stop_id,   "[NS]$")
  ) |>
  filter(from_stop_id %in% all_stop_ids,
         to_stop_id   %in% all_stop_ids) |>
  select(from_stop_id, to_stop_id, min_transfer_time) |>
  mutate(transfer_mins = pmax(min_transfer_time / 60, TRANSFER_BUFFER_MINS))

cat("  Valid transfer pairs:", nrow(transfer_pairs), "\n")

unscored_ids <- setdiff(all_stop_ids, best_direct$from_stop_id)
cat("  Stations needing transfer:", length(unscored_ids), "\n")

z_to_x <- best_direct |>
  select(z_stop_id = from_stop_id,
         z_to_x_mins = median_ride_mins,
         to_x_station)

y_to_z_rides <- map_dfr(unscored_ids, function(y_id) {
  y_trips <- stop_times_clean |>
    filter(parent_stop_id == y_id) |>
    select(trip_id, y_seq = stop_sequence, y_dep = dep_mins)
  
  if (nrow(y_trips) == 0) return(NULL)
  
  stop_times_clean |>
    inner_join(y_trips, by = "trip_id") |>
    filter(stop_sequence > y_seq) |>
    mutate(travel_time = dep_mins - y_dep) |>
    filter(travel_time >= 0, travel_time <= 120) |>
    group_by(z_stop_id = parent_stop_id) |>
    summarise(
      y_to_z_mins = round(median(travel_time), 1),
      .groups = "drop"
    ) |>
    mutate(from_stop_id = y_id)
})

cat("  Y->Z pairs computed:", nrow(y_to_z_rides), "\n")

transfer_scores <- y_to_z_rides |>
  inner_join(transfer_pairs,
             by = c("z_stop_id" = "from_stop_id"),
             relationship = "many-to-many") |>
  inner_join(z_to_x,
             by = c("to_stop_id" = "z_stop_id"),
             relationship = "many-to-many") |>
  mutate(
    total_ride = y_to_z_mins + transfer_mins + z_to_x_mins
  ) |>
  group_by(from_stop_id) |>
  arrange(total_ride) |>
  slice(1) |>
  ungroup() |>
  select(from_stop_id,
         median_ride_mins = total_ride,
         to_x_station)

cat("  Stations scored via transfer:", nrow(transfer_scores), "\n")

# =============================================================================
# 7. Combine direct + transfer + X self scores
# =============================================================================
cat("[7/9] Combining scores...\n")

x_self <- tibble(
  from_stop_id     = x_stop_ids,
  median_ride_mins = 0,
  to_x_station     = x_stop_ids,
  route_type       = "at_park"
)

best_ride <- bind_rows(
  best_direct     |> mutate(route_type = "direct"),
  transfer_scores |> mutate(route_type = "transfer"),
  x_self
) |>
  group_by(from_stop_id) |>
  arrange(median_ride_mins) |>
  slice(1) |>
  ungroup() |>
  rename(gtfs_stop_id = from_stop_id)

cat("  Total stations with ride time:", nrow(best_ride), "\n")
cat("  Route type breakdown:\n")
print(count(best_ride, route_type))

subway_scored <- subway_proj |>
  left_join(best_ride, by = "gtfs_stop_id")

# =============================================================================
# 8. Score each H3 cell
# =============================================================================
cat("[8/9] Scoring H3 cells (~10 min)...\n")

hex_sf_proj        <- hex_sf |> st_transform(32618)
subway_with_scores <- subway_scored |> filter(!is.na(median_ride_mins))

results <- tibble(
  h3_index        = hex_cells,
  subway_mins     = NA_real_,
  walk_mins_used  = NA_real_,
  total_mins      = NA_real_,
  nearest_station = NA_character_,
  route_type      = NA_character_
)

for (i in seq_len(nrow(hex_sf_proj))) {
  if (i %% 2000 == 0) cat("  →", i, "/", nrow(hex_sf_proj), "cells\n")
  
  cell <- hex_sf_proj[i, ]
  
  dists          <- st_distance(cell, subway_with_scores) |> as.numeric()
  nearest_idx    <- which.min(dists)
  nearest_dist_m <- dists[nearest_idx]
  
  walk_hops       <- ceiling(nearest_dist_m / 131)
  walk_to_station <- walk_mins_from_hops(walk_hops)
  
  station      <- subway_with_scores[nearest_idx, ]
  subway_total <- walk_to_station + station$median_ride_mins + WALK_FROM_X_MINS
  
  walk_fallback <- walk_lookup |>
    filter(h3_index == hex_cells[i]) |>
    pull(walk_mins)
  walk_fallback <- if (length(walk_fallback) == 0 || is.na(walk_fallback[1])) 999 else walk_fallback[1]
  
  if (!is.na(subway_total) && subway_total <= walk_fallback) {
    results$total_mins[i]      <- round(subway_total, 1)
    results$subway_mins[i]     <- station$median_ride_mins
    results$walk_mins_used[i]  <- walk_to_station
    results$nearest_station[i] <- station$stop_name
    results$route_type[i]      <- station$route_type
  } else {
    results$total_mins[i]      <- round(walk_fallback, 1)
    results$subway_mins[i]     <- 0
    results$walk_mins_used[i]  <- walk_fallback
    results$nearest_station[i] <- "Walk"
    results$route_type[i]      <- "walk_fallback"
  }
}

results <- results |>
  mutate(grade = assign_grade(total_mins))

cat("  Grade distribution:\n")
results |>
  count(grade) |>
  arrange(match(grade, c("A","B","C","D","F"))) |>
  print()

cat("  Route type breakdown:\n")
results |> count(route_type) |> print()

# =============================================================================
# 9. Join NTA names, nearest_flagship, build polygons, save
# =============================================================================
cat("[9/9] Building polygons and saving...\n")

hex_final <- hex_sf |>
  left_join(results, by = "h3_index") |>
  left_join(walk_flagship_lookup, by = "h3_index") |>
  st_join(select(nta_residential, nta = ntaname),
          join = st_nearest_feature) |>
  mutate(
    geometry          = cell_to_polygon(h3_index) |> st_sfc(crs = 4326),
    grade             = replace_na(grade, "F"),
    nta               = replace_na(nta, "NYC"),
    nearest_flagship  = replace_na(nearest_flagship, "Nearby flagship park")
  ) |>
  st_set_geometry("geometry")

# NTA scores
grade_to_num <- c("A" = 1, "B" = 2, "C" = 3, "D" = 4, "F" = 5)
num_to_grade <- c("1" = "A", "2" = "B", "3" = "C", "4" = "D", "5" = "F")

nta_scores <- hex_final |>
  st_drop_geometry() |>
  filter(!is.na(grade)) |>
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

# Save
hex_final |>
  select(h3_index, grade, total_mins, subway_mins, walk_mins_used,
         nearest_station, nearest_flagship, route_type, nta, geometry) |>
  st_set_precision(1e5) |>
  st_write("data-prep/processed/hex_scores_flagship_subway.geojson",
           delete_dsn = TRUE)

nta_scored |>
  st_set_precision(1e5) |>
  st_write("data-prep/processed/nta_scores_flagship_subway.geojson",
           delete_dsn = TRUE)

cat("\n── OUTPUT SUMMARY ──────────────────────────────\n")
cat("hex_scores_flagship_subway.geojson\n")
cat("  Features:", nrow(hex_final), "\n")
cat("  Fields:  h3_index, grade, total_mins, subway_mins,\n")
cat("           walk_mins_used, nearest_station, nearest_flagship, route_type, nta\n\n")
cat("nta_scores_flagship_subway.geojson\n")
cat("  Features:", nrow(nta_scored), "\n\n")
cat("Grade distribution (hex cells):\n")
hex_final |>
  st_drop_geometry() |>
  count(grade) |>
  arrange(match(grade, c("A","B","C","D","F"))) |>
  print()
cat("\nRoute type breakdown:\n")
hex_final |>
  st_drop_geometry() |>
  count(route_type) |>
  print()
