# HORIZON OPS — Person B: Terrain, Geodesy & Safety Engine Plan

> **Role:** Lead Lunar Geodesist & Terrain Analysis Engineer  
> **Primary Domain:** LOLA DEM Ingestion, Lunar Curvature Horizon Profiler, Slope Hazard Engine & Nearby Safe Haven Recommender  
> **Assigned Branches:** `phase-1/b-terrain-foundation`, `phase-2/b-lola-ingestion`, `phase-3/b-horizon-engine`, `phase-4/b-second-site`, `phase-5/b-terrain-qa`  
> **Owned Paths:** `backend/terrain/`, `data/sites.json`, `scripts/prepare_dem.py`, `data/processed/`

---

## 1. Role Overview & Geospatial Responsibilities

Person B owns the **lunar topography, georeferencing accuracy, slope safety evaluation, and horizon profile generation** for HORIZON OPS.
Key physical & mathematical principles to enforce:
- **LOLA Polar Stereographic Projection**: NASA LOLA elevation products (`LDEM_80S_20MPP` / `LDEM_75S`) use polar stereographic projection in meters, standard parallel $-90^\circ$ (or $-75^\circ$), central meridian $0^\circ$, reference lunar sphere $R_{moon} = 1,737.4\,\text{km}$.
- **Lunar Curvature Drop**: Distant terrain drops below the local tangent plane according to:
  $$\Delta z_{drop}(d) = \sqrt{R_{moon}^2 + d^2} - R_{moon} \approx \frac{d^2}{2 R_{moon}}$$
  *(A ridge 20 km away drops by $\approx 115\,\text{m}$. Failing to account for curvature produces severely flawed horizon angles!)*
- **Landing Slope Safety (< 8° Standard)**: Landing gear for CLPS landers (Nova-C, Blue Ghost) and Artemis HLS can tip over on steep terrain:
  - 🟢 **Safe Touchdown**: $\theta_{slope} < 8.0^\circ$
  - 🟡 **Marginal / Caution**: $8.0^\circ \le \theta_{slope} \le 15.0^\circ$
  - 🔴 **Hazardous / Reject**: $\theta_{slope} > 15.0^\circ$ (severe tip-over risk)
- **Nearby Safe Haven Recommender**: When a user clicks an unsafe point or shadow trap, search a 5–20 km radius to find the nearest flat ridge ($\text{slope} \le 8^\circ$) with elevated horizon clearance.
- **Compact 3D Mesh Export**: Export downsampled binary elevation grids (`.bin` or Float32 array) for Person D's Three.js viewer.

---

## 2. Dependency Matrix: Inputs & Outputs

```
  ┌─────────────────────────────────────────────────────────┐
  │ INPUTS CONSUMED BY PERSON B                             │
  │ • NASA PGDA / GSFC: LOLA Polar Stereographic DEMs       │
  │ • Person D: contracts/terrain.schema.json, site.schema  │
  │ • Mission Target List: Connecting Ridge, Shackleton,   │
  │   Malapert Mountain, Haworth Crater                     │
  └────────────────────────────┬────────────────────────────┘
                               │
                               ▼
  ┌─────────────────────────────────────────────────────────┐
  │ OUTPUTS PRODUCED BY PERSON B                            │
  │ • backend/terrain/geometry.py (Coordinate transforms &  │
  │   slope gradients)                                      │
  │ • backend/terrain/horizon.py (Curvature horizon rays)   │
  │ • backend/terrain/recommender.py (Nearby safe haven)    │
  │ • data/sites.json (Verified site coordinates)           │
  │ • data/processed/*.bin (Compact 3D elevation grids)     │
  │   delivered to Person D for Three.js rendering          │
  └─────────────────────────────────────────────────────────┘
```

---

## 3. Phase-by-Phase Implementation Roadmap

### Phase 1: Geospatial Foundation & Math (H0–H3)
* **Branch:** `phase-1/b-terrain-foundation`
* **Tasks:**
  1. Setup `backend/terrain/geometry.py`:
     - Implement Planetocentric Lat/Lon $(\phi, \lambda) \leftrightarrow$ Polar Stereographic $(X, Y)$ projection math.
     - Implement East-North-Up (ENU) tangent frame basis generator.
     - Implement curvature drop function $\Delta z_{drop}(d) = \frac{d^2}{2 R_{moon}}$.
  2. Create `data/sites.json` with initial curated south pole candidate coordinates:
     - **Site 01: Connecting Ridge** ($89.4^\circ\text{S}, 222.0^\circ\text{E}$)
     - **Site 04: Shackleton Crater Rim** ($89.9^\circ\text{S}, 0.0^\circ\text{E}$)
     - **Site 07: Malapert Mountain** ($86.0^\circ\text{S}, 2.7^\circ\text{E}$)
     - **Site 09: Haworth Crater Floor** ($87.5^\circ\text{S}, 355.0^\circ\text{E}$)
  3. Write unit tests in `backend/tests/test_geometry.py` verifying curvature at 10 km ($\approx 28.77\,\text{m}$) and coordinate round-tripping.
* **Done When:** Coordinates convert accurately and geometric unit tests pass.

### Phase 2: LOLA DEM Ingestion & Site 01 Processing (H3–H11)
* **Branch:** `phase-2/b-lola-ingestion`
* **Tasks:**
  1. Acquire and crop LOLA DEM sub-raster for **Connecting Ridge (Site 01)**.
  2. Implement `backend/terrain/ingest.py`: Read GeoTIFF elevation array, pixel resolution ($20\,\text{m/px}$), and affine transform.
  3. Implement `scripts/prepare_dem.py`:
     - Generate a lightweight, downsampled $256 \times 256$ height-grid file (`data/processed/site01_terrain.bin`) for Person D's 3D viewer.
  4. Document dataset version, original filename, checksum, and nodata values in `data/sites.json`.
* **Done When:** Site 01 height-grid is extracted, oriented correctly, and delivered to Person D.

### Phase 3: Horizon Engine, Slope Safety & Safe Haven Recommender (H11–H21)
* **Branch:** `phase-3/b-horizon-engine`
* **Tasks:**
  1. Build `backend/terrain/horizon.py`:
     - For observer position $(\phi_0, \lambda_0)$ and height $h_{obs}$ ($2\,\text{m}$ deck to $10\,\text{m}$ mast):
     - Cast $N_{az} = 360$ azimuth rays ($\Delta \theta = 1.0^\circ$).
     - Sample terrain out to $R_{max} = 35\,\text{km}$ in radial steps:
       $$\alpha(\theta) = \max_r \arctan\left(\frac{h(r, \theta) - h_{site} - h_{obs} - \frac{r^2}{2 R_{moon}}}{r}\right)$$
  2. Build Slope Safety Calculator:
     - Compute 2D spatial gradients $(\frac{\partial z}{\partial x}, \frac{\partial z}{\partial y})$ via $3 \times 3$ Sobel filter.
     - Return slope angle $\theta_{slope} = \arctan(\|\nabla z\|)$ and status (`SAFE`, `CAUTION`, `HAZARD`).
  3. Build `backend/terrain/recommender.py`:
     - Given a clicked coordinate, if hazardous or in deep shadow:
     - Scan concentric rings in radius $R \in [5, 20]\,\text{km}$.
     - Filter candidates for $\text{slope} \le 8.0^\circ$ and high elevation.
     - Rank top 3 candidates with distance, bearing, slope, and solar advantage.
* **Done When:** Horizon profile $\alpha(\theta)$ and slope checks pass synthetic and real Site 01 test benchmarks.

### Phase 4: Second Primary Site (Shackleton) & Multi-Site Grids (H21–H30)
* **Branch:** `phase-4/b-second-site`
* **Tasks:**
  1. Ingest and process **Site 04: Shackleton Crater Rim**.
  2. Process **Malapert Mountain** and **Haworth Crater** DEM tiles.
  3. Generate horizon profiles and export compact 3D height-grids for all sites.
  4. Provide pre-computed JSON horizon caches in `data/cache/horizons/` for zero-latency comparisons.
* **Done When:** All 4 sites have verified coordinates, valid horizon profiles, slope maps, and 3D terrain assets.

### Phase 5: Terrain QA & Provenance Documentation (H30–H37)
* **Branch:** `phase-5/b-terrain-qa`
* **Tasks:**
  1. Cross-verify horizon silhouettes and slope angles against NASA Moon Trek.
  2. Author `docs/sources.md`: Detail LOLA PGDA product numbers, PDS links, pixel resolutions, and elevation units.
  3. Ensure preprocessing script `scripts/prepare_dem.py` is fully reproducible.
* **Done When:** Terrain documentation is auditable and all terrain tests pass.

---

## 4. Key Code Snippet: Curvature-Aware Horizon Profiler

```python
# backend/terrain/horizon.py
import numpy as np

R_MOON = 1737400.0  # Lunar mean radius in meters

def compute_azimuth_horizon(dem_grid, x0_idx, y0_idx, pixel_res_m=20.0, h_obs=2.0, max_radius_km=35.0):
    num_azimuths = 360
    horizon_profile = np.zeros(num_azimuths)
    z0 = dem_grid[y0_idx, x0_idx] + h_obs
    max_steps = int((max_radius_km * 1000.0) / pixel_res_m)
    
    azimuths_rad = np.deg2rad(np.arange(num_azimuths))
    
    for i, az in enumerate(azimuths_rad):
        dx = np.sin(az)
        dy = np.cos(az)
        
        step_indices = np.arange(1, max_steps)
        sample_x = np.clip(np.round(x0_idx + step_indices * dx).astype(int), 0, dem_grid.shape[1] - 1)
        sample_y = np.clip(np.round(y0_idx - step_indices * dy).astype(int), 0, dem_grid.shape[0] - 1)
        
        sample_z = dem_grid[sample_y, sample_x]
        distances = step_indices * pixel_res_m
        
        # Lunar curvature drop
        drop = (distances ** 2) / (2.0 * R_MOON)
        apparent_angles = np.arctan2(sample_z - z0 - drop, distances)
        horizon_profile[i] = np.rad2deg(np.max(apparent_angles))
        
    return horizon_profile
```
