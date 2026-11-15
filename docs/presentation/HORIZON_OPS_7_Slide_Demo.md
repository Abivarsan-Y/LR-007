# HORIZON OPS (`LR-007`) — 7-Slide Project Demo Deck

> **Format:** 7-Slide Deck (within the NASA Space Apps 7-slide limit) · Language: English  
> **Rendered PDF Deck:** [`HORIZON_OPS_7_Slide_Demo.pdf`](./HORIZON_OPS_7_Slide_Demo.pdf)  
> **SI Disclosure:** Deck structure, layout scripts, code scaffolding, and documentation assisted by **Super Intelligence (SI)** tools (**ChatGPT, OpenAI Codex, Google Antigravity**). All lunar geometry, NASA LOLA terrain evaluation, JPL Horizons ephemeris replay, LunaDiff computations, and rover traverse planning execute via deterministic algorithms with **zero generative AI in runtime physics** and **zero NASA branding or logos**.

---

## Slide 1 — HORIZON OPS (`LR-007`) · Title Slide
- **Challenge:** 2026 NASA Space Apps Challenge — *Lunar Landing Site Navigator*
- **Project Name:** **HORIZON OPS** — *Lunar South Pole Landing Site, Mission Window, LunaDiff & Rover Traverse Navigator*
- **Summary:** Interactive 3D & 2D mission control workbench powered by real NASA LRO LOLA Digital Elevation Models and JPL Horizons (`DE421`) ephemerides — uniting touchdown slope safety, causal shadow/comms root-cause analysis, and energy-aware PSR rover routing.
- **Key Highlights:** `80°S–90°S` South Polar coverage · `4` LOLA `129×129 (20 m)` 3D patches · `184` automated tests passing · `100%` offline resilient (`SHA-256` cache).
- **Public Repository:** [`https://github.com/Abivarsan-Y/LR-007`](https://github.com/Abivarsan-Y/LR-007)

**Speaker Note:** Welcome to HORIZON OPS by Team LR-007 — an open-source mission planning cockpit designed for Artemis-era Lunar South Pole operations.

---

## Slide 2 — The Lunar South Pole Problem (`80°S–90°S`)
- **01 · Grazing Sunlight (`0°–1.5°`):** Distant crater rims `15–30+ km` away cast long dynamic shadows capable of causing `60–70 h` continuous freezing blackouts.
- **02 · Flat-Moon Geodesy Failure:** Ignoring lunar radius ($R = 1,737.4\,\text{km}$) produces false shadow predictions ($\Delta z = \sqrt{R^2 + d^2} - R \approx 115.1\,\text{m}$ curvature drop at $20\,\text{km}$).
- **03 · Earth Libration DTE Dropouts:** Earth oscillates low across the northern skyline over a `27.3-day` libration cycle, turning minor ridge relief into communication dead zones.
- **04 · Water-Ice PSR Rover Risk:** Water ice resides inside Permanently Shadowed Regions (PSRs) behind steep (`>15°`) crater walls where rovers risk tip-over, battery depletion, or losing Base Pod line-of-sight.
- **Data Proof:** LOLA `129×129` DEM comparison across Connecting Ridge (`390 m` relief), Shackleton Rim (`1,300 m` relief, steep walls), Malapert Mountain (`397 m`), and Haworth Floor (`153 m`).

---

## Slide 3 — Interactive Mission Workspace & Safe Haven Recommender
- **Dual-View 3D + 2D Stage:** CesiumJS 3D globe textured with NASA LROC WAC (`luna_wac_global`), far-field 3D starfield, seamless `129×129 (20 m)` LOLA relief patches (with camera elevation floor guard), plus synchronized 2D Polar Map (`80°S–90°S`).
- **Instant Artemis Slope Screening:** Evaluates any polar click as **SAFE (`< 8.0°`)**, **CAUTION (`8.0°–15.0°`)**, or **HAZARD (`> 15.0°`)** with live 3D shader switching.
- **Nearby Safe Haven Recommender:** Scans concentric surrounding rings (`5–20 km` / local patch envelope) to divert unsafe clicks to nearby flat ridges (`Site 01` output: `SH-1: 0.44°`, `SH-2: 2.61°`, `SH-3: 1.36°`).

---

## Slide 4 — LunaDiff Engine: *"See What Changed. See Why."*
- **Launch Delay Impact (`Nov 15, 2026` Nominal vs `+48h` Delay at Connecting Ridge `Site 01`):**
  - **Nominal Sunlight (14d):** `249.1 h` (`74.1%`) · **Max Continuous Dark:** `59.5 h`
  - **+48h Delay Sunlight Delta:** `-46.2 h` net sunlight impact
  - **+48h Delay Earth DTE Delta:** `+10.0 h` net Earth visibility shift
- **Causal 360° Horizon Inspector:** Plots `1,440` curvature-adjusted horizon rays (`0.25°` spacing) alongside DE421 Sun and Earth sky tracks. Clicking any gained/lost interval highlights the exact obstructing ridge azimuth (e.g., `MET +216.0h`: SE rim at `118.29°` azimuth rising to `1.534°` blocks delayed Sun at `1.255°`).

---

## Slide 5 — Energy & LOS-Constrained Rover Traverse Planner
- **Dual Modes:** **Manual Mode** (`0.45×–1.32×` adaptive radial step candidates + exact target snap) and **Automatic Mode** (constrained multi-waypoint solver).
- **Real Physics Constraints:** `1,200 Wh` battery (`20%` safety floor), `150 W` drive draw, `350 W` peak solar array, `0.5 m/s` cruise speed, `≤ 15°` max slope, dynamic synodic solar rotation (`+0.508°/h`), return-to-Base-Pod / sunlit-haven safety margin, and curvature-aware `5 m` Base Pod mast to `2 m` rover mast radio LOS.
- **Executed Real LOLA Sortie (`LDEM_80S_80MPP_ADJ.TIF`):** Starts at `46.7%` battery, executes two **`⚡ SOLAR_REGEN_HOLD`** stops (`2.06 h + 0.15 h` -> `90.0%` SoC) before entering the `0%` sunlit target at `1,091.9 m` distance with `84.9%` battery and `100%` Base Pod LOS.

---

## Slide 6 — Scientific Validity, NASA & CSA Data, and Verification
- **NASA Data Products:**
  1. **NASA LRO LOLA DEMs (GSFC PGDA 90 & 78):** `LDEM_80S_80MPP_ADJ.TIF` (`7600×7600`), `LDEM_80S_20MPP_ADJ.TIF`, and `Site01_final_adj_5mpp_surf.tif` (`+ _ldec/_slp/_toterr/_slperr`).
  2. **NASA JPL Horizons API (`DE421`, `MOON_ME_DE421`):** Sun (`NAIF 10`) & Earth (`NAIF 399`) topocentric observer quantities `4, 13, 20`.
  3. **NASA LROC WAC (`luna_wac_global`)** via Lunaserv WMS + **NASA Moon Trek / QuickMap** validation.
- **Space Agency Partner Resource:** **Canadian Space Agency (CSA)** Moon Exploration science portal integrated in Mission Resources.
- **Verification:** Fail-closed `NaN -> UNKNOWN` semantics + SHA-256 dataset provenance + **184 Automated Passing Tests** (`153` Backend Python tests + `8` JSON Schema Draft 2020-12 contract tests + `23` Frontend Node tests).

---

## Slide 7 — Impact, Offline Accessibility & Open Source Delivery
- **Built in Sri Lanka for the World:** 100% offline-resilient replay cache allows universities, STEM learners, and mission analysts worldwide to run verified South Pole studies without cloud cost or stable internet.
- **Auditable Mission Packages:** One-click **JSON** & **CSV** exports with full coordinates (`MOON_ME_DE421`), horizon profiles, rover waypoints, and SHA-256 provenance records.
- **Public Access:** Open-source code, submission documentation, and live presentation files published at [`https://github.com/Abivarsan-Y/LR-007`](https://github.com/Abivarsan-Y/LR-007).
