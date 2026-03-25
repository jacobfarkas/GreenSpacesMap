# 01b_download_network.R
# Downloads OSM pedestrian network for NYC
# Run once on local Mac. Saves to data-prep/raw/osm_network.rds
# Project: GreenSpacesMap

library(dodgr)
library(osmdata)
library(tidyverse)

dir.create("data-prep/raw", recursive = TRUE, showWarnings = FALSE)

# ── 1. DEFINE NYC BOUNDING BOX ─────────────────────────────────────────────────
message("Fetching OSM pedestrian network for NYC...")
message("  This will take several minutes — large download")

nyc_bbox <- c(
  xmin = -74.26,
  ymin =  40.49,
  xmax = -73.69,
  ymax =  40.92
)

# ── 2. FETCH PEDESTRIAN NETWORK ────────────────────────────────────────────────
network <- dodgr_streetnet(
  bbox    = nyc_bbox,
  expand  = 0,
  quiet   = FALSE
)

message("  ✓ Network fetched: ", nrow(network), " edges")

# ── 3. WEIGHT THE NETWORK ──────────────────────────────────────────────────────
graph <- weight_streetnet(
  network,
  wt_profile = "foot"
)

message("  ✓ Graph weighted: ", nrow(graph), " directed edges")

# ── 4. SAVE ────────────────────────────────────────────────────────────────────
saveRDS(graph, "data-prep/raw/osm_network.rds")
message("  ✓ Saved to data-prep/raw/osm_network.rds")
message("\nDone. Run 02_score.R next.")