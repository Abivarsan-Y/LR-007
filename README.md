# HORIZON OPS (`LR-007`)

**Lunar South Pole Landing Site, Mission Window, LunaDiff & Rover Traverse Navigator**  
*2026 NASA Space Apps Challenge Submission — Team LR-007*

---

## Project Demo

- **7-Slide Project Demo Deck (PDF):** [`docs/HORIZON_OPS_7_Slide_Demo.pdf`](./docs/HORIZON_OPS_7_Slide_Demo.pdf) ([public GitHub link](https://github.com/Abivarsan-Y/LR-007/blob/main/docs/HORIZON_OPS_7_Slide_Demo.pdf))

---

## What HORIZON OPS Does

1. **Interactive 3D Lunar South Pole Globe + Synchronized 2D Polar Map (`80°S–90°S`)**
   - CesiumJS 3D South Polar visualization textured with **NASA LRO WAC (`luna_wac_global`)** via Lunaserv WMS, far-field 3D starfield, and seamless `129 × 129` (`20 m` spacing) **NASA LOLA DEM** terrain relief across four Artemis-era South Pole sites (`Connecting Ridge`, `Shackleton Rim`, `Malapert Mountain`, `Haworth Interior`) with camera elevation floor protection.
2. **Artemis Slope Hazard Screening & Nearby Safe Haven Recommender**
   - Evaluates local landing slopes using **SAFE (`< 8.0°`)**, **CAUTION (`8.0°–15.0°`)**, and **HAZARD (`> 15.0°`)** thresholds with switchable shaders.
   - Scans concentric rings around unsafe points to recommend safer ridge flats (e.g., Connecting Ridge `Site 01`: `SH-1: 0.44°`, `SH-2: 2.61°`, `SH-3: 1.36°`).
3. **LunaDiff Engine (*"See What Changed. See Why."*) & Causal 360° Horizon Inspector**
   - Compares a Nominal launch window (`Nov 15, 2026`, `14` days) against launch delays (`+24h` / `+48h` / `+72h`) at `30-minute` cadence using curvature-adjusted 360° horizon ray-casting (`1,440` rays at `0.25°` spacing out to `150 km`, lunar radius $R = 1,737,400\,\text{m}$) and **NASA JPL Horizons `DE421`** (`MOON_ME_DE421`) Sun and Earth ephemerides.
   - Verified Connecting Ridge (`Site 01`) `+48h` delay shift: **`-46.2 h` net sunlight**, **`+10.0 h` net Earth visibility**, linked directly to obstructing crater rim azimuths (e.g., `MET +216.0h`, `118.293°` SE rim at `1.534°` blocking the `1.255°` Sun).
4. **Energy- & LOS-Constrained Rover Traverse Planner (Manual & Automatic Modes)**
   - Plans sorties from a landed Base Pod toward Permanently Shadowed Regions (PSRs) enforcing `≤ 15°` slope limits, `1,200 Wh` battery (`20%` safety floor), `150 W` drive draw, `350 W` peak solar charging, `0.5 m/s` cruise speed, dynamic synodic solar rotation (`+0.508°/h`), return-to-haven margin, and curvature-aware **`5 m` Base Pod mast to `2 m` rover mast** radio line-of-sight (LOS).
   - Verified real **LOLA `LDEM_80S_80MPP_ADJ.TIF`** sortie result: `1,091.9 m` distance in `3.25 h`, executing `2` **`⚡ SOLAR_REGEN_HOLD`** stops (`2.06 h + 0.15 h` to `90.0%` SoC) and arriving inside `0%` sunlight PSR target at `84.9%` (`1,019.1 Wh`) battery and `100%` Base Pod LOS.
5. **Reproducible Mission Exports & Offline Resilience**
   - Exports auditable JSON and CSV packages with `MOON_ME_DE421` coordinates, SHA-256 dataset provenance, fail-closed `NaN -> UNKNOWN` handling, and interactive client-side replay backed by committed LOLA terrain binaries (`data/processed/`) and JPL Horizons fixtures (`backend/tests/fixtures/`).

---

## NASA Data, Space Agency Partner Resources & Engineering Sources

### NASA Datasets & Planetary Services
- **NASA LRO LOLA South Polar DEMs (GSFC PGDA Product 90):** `LDEM_80S_80MPP_ADJ.TIF` (`7,600 × 7,600` float32, `80 m/px`) & `LDEM_80S_20MPP_ADJ.TIF` (`20 m/px`) — `https://pgda.gsfc.nasa.gov/products/90`
- **NASA LRO LOLA 5 m/pixel Polar Site DEM (GSFC PGDA Product 78):** `Site01_final_adj_5mpp_surf.tif` (`_surf`, `_ldec`, `_slp`, `_toterr`, `_slperr`) — `https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site01/`
- **NASA JPL Horizons On-Line Ephemeris System (`DE421`, `MOON_ME_DE421`):** Sun (`NAIF 10`) and Earth (`NAIF 399`) topocentric observer `@301` quantities `4`, `13`, `20` — `https://ssd.jpl.nasa.gov/api/horizons.api`
- **NASA / GSFC / ASU LROC Wide Angle Camera Mosaic (`luna_wac_global`):** Draped onto the 3D lunar globe via Lunaserv WMS (`IAU2000:30100`) — `https://wms.im-ldi.com/`
- **NASA Moon Trek & LROC QuickMap:** Feature cross-verification and coordinate external links (`https://trek.nasa.gov/moon/`, `https://quickmap.lroc.im-ldi.com/`).

### 2026 NASA Space Apps Space Agency Partner Resource
- **Canadian Space Agency (CSA) — Moon Exploration Portal:** Linked inside the mission external reference controls (`https://www.asc-csa.gc.ca/eng/astronomy/moon-exploration/`).

---

## Quickstart & Local Verification

### 1. Run the Backend API (Python 3.14)

```bash
uv python install 3.14
uv sync --project backend --extra dev --locked
uv run --project backend --locked python -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

*(See [`backend/README.md`](./backend/README.md) for pip setup and configuration options.)*

### 2. Run the Frontend Mission Cockpit (Node 24)

```bash
npm --prefix frontend ci
npm --prefix frontend run dev
```

Open Vite's printed local URL (`http://localhost:5173`). Processed LOLA site terrain binaries, 360° horizon profiles, Site 01 JPL Horizons cache fixtures, Safe Haven lookups, and client-side traverse planning work standalone even when the Python backend is offline. *(See [`frontend/README.md`](./frontend/README.md) for frontend details.)*

### 3. Run the Verified Automated Test Suite (`184` Passing Checks)

```bash
# Backend scientific, terrain, ephemeris, LunaDiff, and rover traverse suite (153 tests)
python3 -m pytest backend/tests/ -q

# Shared JSON Schema Draft 2020-12 contract suite (8 tests, 5 subtests)
python3 -m pytest tests/test_contracts.py -q

# Frontend UI, state, slope logic & catalog unit tests (23 tests)
npm --prefix frontend test

# Production bundle build check
npm --prefix frontend run build
```

---

## Super Intelligence (SI) Attribution & Disclosure

Team **LR-007** originated the lunar south-pole challenge design, spherical curvature horizon math, LunaDiff launch-delay diagnostics, and constrained PSR rover traverse methodology independently, and used **Super Intelligence (SI)** software (**ChatGPT**, **OpenAI Codex**, and **Google Antigravity**) strictly as development and documentation assistants:

- **Assisted:** React/TypeScript UI panel scaffolding, CesiumJS tactical overlay helpers, FastAPI endpoint boilerplate, test authoring, and documentation formatting.
- **Deterministic Runtime Physics:** Zero generative AI runs at runtime—every elevation, slope, 360° horizon obstruction, solar/Earth visibility fraction, and rover traverse trajectory is computed deterministically from verified NASA LOLA DEMs and JPL Horizons `DE421` ephemerides.
- **Branding Compliance:** No NASA logos, flags, insignias, or mission identifiers were generated, modified, or included in any SI-assisted code, documentation, or presentation visuals.
- **Embedded Project Disclosures:** Matching SI disclosures are included in [`frontend/index.html`](./frontend/index.html) (`<meta name="ai-disclosure" ...>`) and [`docs/HORIZON_OPS_7_Slide_Demo.pdf`](./docs/HORIZON_OPS_7_Slide_Demo.pdf) slide footers.
