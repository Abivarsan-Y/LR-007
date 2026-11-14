# HORIZON OPS — Terrain, Geodesy & Safety Engine (Person B)

> **Role:** Lead Lunar Geodesist & Terrain Analysis Engineer  
> **Domain:** LOLA DEM Ingestion, Lunar Curvature Horizon Profiler, Slope Hazard Engine & Nearby Safe Haven Recommender  
> **Owned Paths:** `backend/terrain/`, `data/sites.json`, `scripts/prepare_dem.py`, `data/processed/`

---

## Architecture & Module Overview

```text
backend/terrain/
├── geometry.py      # Polar stereographic math, curvature drop & coordinate transforms
├── slope.py         # 2D gradient slope calculation & Artemis/CLPS touchdown safety classification
├── ingest.py        # Sub-millisecond memory-mapped NASA LOLA DEM reader (LolaDemReader)
├── horizon.py       # 360° curvature-aware azimuth horizon profiler
├── recommender.py   # Nearby Safe Haven Recommender (< 8° slope, ridge prominence ranking)
├── exporter.py      # Binary Float32 (.bin) and v1.0 JSON terrain mesh exporter
├── generator.py     # Procedural synthetic lunar terrain baseline
└── __init__.py      # Public exports
```

---

## 1. Mathematical & Physical Principles

### Lunar Curvature Drop
On a spherical Moon ($R_{moon} = 1,737,400.0\,\text{m}$), distant topography drops below the local horizontal tangent plane:
$$\Delta z_{drop}(d) = \sqrt{R_{moon}^2 + d^2} - R_{moon} \approx \frac{d^2}{2 R_{moon}}$$
- At $10\,\text{km}$: $\Delta z \approx 28.78\,\text{m}$
- At $20\,\text{km}$: $\Delta z \approx 115.11\,\text{m}$
- At $50\,\text{km}$: $\Delta z \approx 719.47\,\text{m}$

On a smooth sphere with no relief, the apparent horizon angle matches the exact analytical spherical dip:
$$\theta_{dip} = -\arccos\left(\frac{R_{moon}}{R_{moon} + h_{obs}}\right)$$
For $h_{obs} = 2.0\,\text{m}$ (lander deck height), $\theta_{dip} = -0.0869^\circ$. Our engine reproduces this benchmark to within $0.000000^\circ$.

### Touchdown Slope Safety Envelopes
Touchdown slope is evaluated via 2D spatial gradients $\|\nabla z\| = \sqrt{(\partial z / \partial x)^2 + (\partial z / \partial y)^2}$:
- 🟢 **SAFE** ($\theta < 8.0^\circ$): Nominal touchdown envelope per Artemis HLS & CLPS landers.
- 🟡 **CAUTION** ($8.0^\circ \le \theta \le 15.0^\circ$): Marginal slope. Risk of slippage or tilt requiring leveling damping.
- 🔴 **HAZARD** ($\theta > 15.0^\circ$): Severe tip-over hazard. Exceeds stability envelope. Immediate diversion recommended.

---

## 2. Shared Contract Interfaces

### Nearby Safe Haven Recommender (`contracts/recommend.schema.json`)
When a landing site is hazardous or located in a cryogenic permanent shadow region (PSR), `recommend_safe_havens_from_dem` and `find_safe_havens_from_grid`:
1. Search within a configurable divert radius (e.g. $5 - 20\,\text{km}$).
2. Filter candidates for $\text{slope} \le 8.0^\circ$.
3. Rank candidates by local topographical elevation (solar advantage), slope flatness, and divert proximity.
4. Export contract-compliant JSON with normalized coordinates ($\lambda \in [-180, 180]$) in `MOON_ME_DE421`.

### 3D Binary Terrain Mesh (`contracts/terrain.schema.json`)
`export_terrain_binary_contract` exports:
- A compact binary Float32 Little-Endian elevation array (`.bin`, $64 \times 64 \times 4$ bytes = $16\,\text{KB}$).
- A metadata JSON specifying:
  - `encoding`: `float32_le`
  - `layout`: `row_major_north_to_south_west_to_east`
  - `height_reference`: `metres_above_reference_sphere`
  - `scene_axes`: `+X east, +Y up, -Z north`
  - `sha256`: SHA-256 checksum of the `.bin` asset

---

## 3. CLI Ingestion & Preparation Tool

To process all 4 primary landing sites using the real NASA LOLA 80m DEM:

```bash
python3 scripts/prepare_dem.py --all
```

Outputs generated in `data/processed/`:
- `{site_id}.json`: v1.0 JSON format for frontend terrain inspection.
- `{site_id}_terrain.bin`: Float32 binary mesh for Three.js.
- `{site_id}_terrain.json`: Contract-compliant metadata validating against `contracts/terrain.schema.json`.
- `{site_id}_horizon.json`: 360° curvature-aware apparent horizon profiles.
- `{site_id}_recommend.json`: Safe haven diversion recommendations validating against `contracts/recommend.schema.json`.

---

## 4. Test Suite

Run Person B unit tests and shared contract tests:

```bash
python3 -m pytest backend/tests/test_geometry.py backend/tests/test_terrain.py backend/tests/test_horizon.py backend/tests/test_recommender.py backend/tests/test_terrain_contract.py tests/test_contracts.py -v
```
