# HORIZON OPS — Master Documentation & Submission Guide

> **Target Audience:** Team Documentation Lead & Delivery Specialist (Person D / Documentation Owner)  
> **Mission:** Author comprehensive, auditable, and judge-ready documentation for **HORIZON OPS** (NASA Space Apps Challenge 2026: *Lunar Landing Site Navigator*).  
> **Guiding Principle:** **Truth before polish.** Verified NASA science first, intuitive interactive explanation always. Clear and rigorous documentation wins hackathons.

---

## Table of Contents
1. [Role Overview & Responsibilities](#1-role-overview--responsibilities)
2. [Master Documentation Deliverables (File-by-File)](#2-master-documentation-deliverables-file-by-file)
   - [A. Root `README.md` (Front Door & First Impression)](#a-root-readmemd-front-door--first-impression)
   - [B. `docs/sources.md` (NASA Data Provenance & Auditing)](#b-docssourcesmd-nasa-data-provenance--auditing)
   - [C. `docs/methodology.md` (Scientific Formulas & Mathematical Rigor)](#c-docsmethodologymd-scientific-formulas--mathematical-rigor)
   - [D. `docs/architecture.md` (System Design & Pipeline Flow)](#d-docsarchitecturemd-system-design--pipeline-flow)
   - [E. `docs/validation.md` (QA, Benchmarks & Truth Certification)](#e-docsvalidationmd-qa-benchmarks--truth-certification)
   - [F. `docs/user_guide.md` (Judge Demo Runbook & Feature Manual)](#f-docsuser_guidemd-judge-demo-runbook--feature-manual)
3. [NASA Space Apps Official Submission Template](#3-nasa-space-apps-official-submission-template)
4. [90–120 Second Video Pitch Script & Storyboard](#4-90120-second-video-pitch-script--storyboard)
5. [Style Guide, Tone & Scientific Terminology](#5-style-guide-tone--scientific-terminology)
6. [Progress Tracker & Pre-Submission Checklist](#6-progress-tracker--pre-submission-checklist)

---

## 1. Role Overview & Responsibilities

As the **Documentation & Delivery Lead**, you are the public voice of HORIZON OPS. While the engineers build backend physics and 3D UI, your job is to translate complex celestial mechanics and lunar geodesy into clear, compelling, and rigorously verified documentation that wins over hackathon judges and NASA evaluators.

### Your Core Responsibilities:
1. **Document the Science**: Explain lunar polar terrain, ephemeris retrieval, and curvature geometry so anyone from a high school student to a NASA mission architect can understand it.
2. **Audit Data Provenance**: Ensure every coordinate, elevation, and time sample links back to authentic NASA sources (LOLA PDS and JPL Horizons).
3. **Write the Submission**: Fill out the official NASA Space Apps project page fields, including the AI disclosure and data citations.
4. **Direct the Golden Demo**: Coordinate the 90–120 second pitch video script to showcase our best features within the judging time limit.

---

## 2. Master Documentation Deliverables (File-by-File)

Here is the exact blueprint of files to create or update in the repository.

```text
LR-007/
├── README.md                 # Primary project overview, quickstart & demo script
└── docs/
    ├── architecture.md       # System design, data flow & component contracts
    ├── methodology.md        # Scientific formulas, geodesy & visibility equations
    ├── sources.md            # NASA LOLA & JPL Horizons provenance, hashes & citations
    ├── validation.md         # Test suite results, truth checks vs Moon Trek & benchmarks
    ├── user_guide.md         # Step-by-step user manual & golden demo walkthrough
    └── contracts.md          # Existing shared JSON schemas reference
```

---

### A. Root `README.md` (Front Door & First Impression)
*Target path:* `README.md`  
*Purpose:* The first file judges and visitors see on GitHub. Must be visually striking, clear, and easy to run in under 2 minutes.

#### Key Sections to Include:
1. **Header & Tagline**:
   - `HORIZON OPS — Lunar Landing Site, Mission Window & LunaDiff Navigator`
   - Badges: `NASA Space Apps 2026`, `Tests: 122 Passing`, `Python 3.14`, `React 19`, `Three.js`.
2. **The Problem (Why Lunar South Pole Landing is Hard)**:
   - Grazing solar elevation ($0^\circ - 1.5^\circ$) means crater rims 15–30 km away cast long, sweeping shadows.
   - A site with 80% total sunlight can still experience a catastrophic 70-hour continuous blackout.
   - Earth wobbles low along the southern horizon in a 27.3-day libration cycle, causing intermittent Direct-to-Earth (DTE) communication dropouts.
3. **The Solution (Our 7 Key Innovations)**:
   - **Interactive 2D Polar Map & 3D Celestial Scene**: Click anywhere from $85^\circ\text{S} - 90^\circ\text{S}$ to analyze terrain.
   - **Landing Hazard & Slope Safety Engine**: Instant touchdown safety evaluation ($<8^\circ$ Safe, $8^\circ-15^\circ$ Caution, $>15^\circ$ Hazard tip-over risk).
   - **Nearby Safe Haven Recommender**: Auto-scans 5–20 km radius to find optimal flat landing ridges when an unsafe spot is clicked.
   - **LunaDiff Engine ("See what changed. See why.")**: A/B scenario comparison (Site A vs Site B, or Launch Delay +24h/+48h) quantifying gained/lost sunlight and DTE comms.
   - **Causal Horizon Obstruction Inspector**: Click any lost window to reveal the exact 360° terrain silhouette blocking the Sun/Earth.
   - **Synchronized Time Scrubber**: Scrubbing the timeline dynamically moves the 3D Sun, casts realistic polar grazing shadows, and updates Earth libration.
   - **100% Offline Resilience**: Pre-cached real NASA LOLA DEMs and JPL Horizons ephemerides ensure zero reliance on external network during judging.
4. **Architecture Diagram**: High-level flow from NASA raw data $\rightarrow$ Python scientific backend $\rightarrow$ JSON contracts $\rightarrow$ React/Three.js frontend.
5. **Quickstart / How to Run**:
   - Step 1: Clone repo.
   - Step 2: Run frontend (`npm --prefix frontend install`, `npm --prefix frontend run dev`).
   - Step 3: Run backend (`uvicorn backend.app.main:app --reload`).
   - Step 4: Run tests (`python3 -m pytest backend/tests/ tests/test_contracts.py -v`).
6. **90-Second Golden Demo Script**: Concise summary of what to demo to judges.

---

### B. `docs/sources.md` (NASA Data Provenance & Auditing)
*Target path:* `docs/sources.md`  
*Purpose:* Provide complete scientific traceability so judges can verify that all results come from real NASA data, not fabricated numbers.

#### Key Sections to Include:
1. **NASA Planetary Data System (PDS) & LOLA DEMs**:
   - **Dataset Name**: Lunar Reconnaissance Orbiter (LRO) Lunar Orbiter Laser Altimeter (LOLA) Digital Elevation Model.
   - **Product ID**: `LDEM_80S_80MPP_ADJ` (South Pole 80 m/pixel adjusted elevation raster, $80^\circ\text{S}$ to $90^\circ\text{S}$).
   - **Download Link**: NASA PDS Geosciences Node / GSFC PGDA (`https://pgda.gsfc.nasa.gov/products/90`).
   - **Raw File Details**:
     - Filename: `LDEM_80S_80MPP_ADJ.TIF`
     - Dimensions: $7,600 \times 7,600$ float32 pixels ($\approx 180.4\,\text{MB}$).
     - Unit of Elevation: Metres relative to the reference lunar sphere ($R_{moon} = 1,737,400.0\,\text{m}$).
     - Projection: Polar Stereographic, standard parallel $-90^\circ$, central meridian $0^\circ$.
2. **NASA JPL Horizons Ephemeris System**:
   - **API Endpoint**: `https://ssd-api.jpl.nasa.gov/horizons.api`
   - **Ephemeris Frame**: Planetary ephemeris DE421, Lunar Mean Earth / Polar Axis (ME) frame.
   - **Targets**: Sun (NAIF ID: `10`), Earth (NAIF ID: `399`).
   - **Observer**: Topocentric coordinates on Moon surface (`@301`) at site latitude, longitude, and elevation + mast height.
   - **Quantities Queried**: Apparent azimuth and elevation (`QUANTITIES='4'`), angular diameter (`QUANTITIES='13'`).
3. **Curated Landing Sites & Geographic Coordinates**:
   - **Site 01: Connecting Ridge** ($89.44^\circ\text{S}, 222.61^\circ\text{E}$, elevation $-1,350\,\text{m}$)
   - **Site 04: Shackleton Crater Rim** ($89.90^\circ\text{S}, 0.00^\circ\text{E}$, elevation $+1,120\,\text{m}$)
   - **Site 07: Malapert Mountain** ($86.04^\circ\text{S}, 2.71^\circ\text{E}$, elevation $+5,030\,\text{m}$)
   - **Site 09: Haworth Crater Floor** ($87.52^\circ\text{S}, 355.20^\circ\text{E}$, elevation $-3,400\,\text{m}$)
4. **Data Integrity & Checksums**:
   - Document SHA-256 hashes for all processed site files in `data/processed/*.json` and `data/fixtures/`.
5. **Open Science & Licensing**:
   - NASA Public Domain policy and attribution statements.

---

### C. `docs/methodology.md` (Scientific Formulas & Mathematical Rigor)
*Target path:* `docs/methodology.md`  
*Purpose:* Explain the exact physics, geometry, and algorithms powering HORIZON OPS.

#### Key Sections to Include:
1. **Lunar Polar Stereographic Projection**:
   - Forward and inverse conversion between planetocentric $(\phi, \lambda)$ and map $(X, Y)$:
     $$X = 2 R_{moon} \tan\left(\frac{\pi}{4} - \frac{|\phi|}{2}\right) \sin(\lambda)$$
     $$Y = -2 R_{moon} \tan\left(\frac{\pi}{4} - \frac{|\phi|}{2}\right) \cos(\lambda)$$
   - Standard parallel: $-90^\circ$, Central meridian: $0^\circ$, $R_{moon} = 1,737,400\,\text{m}$.
2. **Lunar Curvature Drop Equation**:
   - Explain why flat-Earth / flat-Moon models fail catastrophically:
     $$\Delta z_{drop}(d) = \sqrt{R_{moon}^2 + d^2} - R_{moon} \approx \frac{d^2}{2 R_{moon}}$$
   - Quantitative example: At $d = 20\,\text{km}$, the terrain drops by $115.1\,\text{m}$. Ignoring this produces false terrain blockage of the Sun!
3. **360° Azimuth Horizon Profiler**:
   - Ray-casting along true north-clockwise bearings ($\theta \in [0^\circ, 359^\circ]$):
     $$\alpha(\theta) = \max_{r \in (0, R_{max}]} \arctan\left(\frac{z(r, \theta) - z_{site} - h_{obs} - \frac{r^2}{2 R_{moon}}}{r}\right)$$
   - Handling of missing/nodata samples: Treated as **unknown**, never assumed to be clear sky.
4. **Solar Disc Penumbra Model (Circular-Segment Integration)**:
   - The Sun is an extended disc ($\approx 0.53^\circ$ diameter), not a point source.
   - Let $c$ be Sun center elevation minus horizon angle, $r$ be solar radius. Let normalized clearance $u = c / r$:
     - $u \le -1$: Full eclipse (fraction $f = 0.0$).
     - $u \ge +1$: Full sunlight (fraction $f = 1.0$).
     - $-1 < u < 1$: Penumbra / partial sunlight:
       $$f(u) = \frac{\arccos(-u) + u \sqrt{1 - u^2}}{\pi}$$
5. **Touchdown Slope Safety & Geotechnical Classification**:
   - 2D spatial elevation gradients $(\frac{\partial z}{\partial x}, \frac{\partial z}{\partial y})$ evaluated via $3 \times 3$ kernel.
   - Slope angle $\theta_{slope} = \arctan\left(\sqrt{(\partial z / \partial x)^2 + (\partial z / \partial y)^2}\right)$.
   - NASA Artemis / CLPS Lander Thresholds:
     - 🟢 **SAFE**: $\theta_{slope} < 8.0^\circ$ (nominal landing zone).
     - 🟡 **CAUTION**: $8.0^\circ \le \theta_{slope} \le 15.0^\circ$ (marginal stability).
     - 🔴 **HAZARD**: $\theta_{slope} > 15.0^\circ$ (severe tip-over risk).
6. **Nearby Safe Haven Recommender Algorithm**:
   - When clicked point is $\text{slope} > 8^\circ$ or in permanent shadow:
   - Concentric spatial search $r \in [5, 20]\,\text{km}$.
   - Candidate filtering: $\theta_{slope} \le 8^\circ$ + local topographical high.
   - Ranking score: Balanced metric of proximity, slope flatness, and solar exposure.
7. **LunaDiff Engine Differential Logic**:
   - Compares Scenario A (baseline) against Scenario B (e.g. +24h or +48h delay).
   - Time-aligned timeline delta intervals:
     - 🟢 **Gained Window**: Period where Scenario B has sunlight/DTE but Scenario A did not.
     - 🔴 **Lost Window**: Period where Scenario A had sunlight/DTE but Scenario B is blocked.
   - Causal attribution: Identifies the exact azimuth and elevation of the obstructing obstacle.

---

### D. `docs/architecture.md` (System Design & Pipeline Flow)
*Target path:* `docs/architecture.md`  
*Purpose:* Illustrate how the frontend, backend, 3D engine, and NASA pipelines fit together seamlessly.

#### Key Sections to Include:
1. **System Architecture Overview Diagram** (Use Mermaid `flowchart TD`):
   ```mermaid
   flowchart TD
       subgraph NASA_Data ["NASA Scientific Data Sources"]
           LOLA["NASA LOLA DEM (80m/px GeoTIFF)"]
           HORIZONS["JPL Horizons Ephemeris API (DE421)"]
       end

       subgraph Backend ["Python Scientific Engine (FastAPI)"]
           INGEST["Terrain Ingestion & Curvature Engine (Person B)"]
           EPHEM["Ephemeris Client & Cache (Person A)"]
           HORIZON["360° Curvature Horizon Profiler (Person B)"]
           VISIBILITY["Line-of-Sight & Solar Disc Engine (Person A)"]
           DIFF["LunaDiff Differential Engine (Person A)"]
           RECOMMEND["Safe Haven Recommender (Person B)"]
       end

       subgraph Contracts ["Frozen JSON Schemas (Person D)"]
           SCHEMA_TERRAIN["contracts/terrain.schema.json"]
           SCHEMA_ANALYSIS["contracts/analysis.schema.json"]
           SCHEMA_DIFF["contracts/diff.schema.json"]
           SCHEMA_RECOMMEND["contracts/recommend.schema.json"]
       end

       subgraph Frontend ["Interactive Mission Dashboard (React 19 + TypeScript)"]
           MAP["2D Polar Map & Site Selector (Person C)"]
           SCRUBBER["Synchronized Timeline Scrubber (Person C)"]
           LUNADIFF_UI["LunaDiff Scenario Visualizer (Person C)"]
           SCENE_3D["Three.js Celestial 3D Viewport (Person D)"]
       end

       LOLA --> INGEST
       HORIZONS --> EPHEM
       INGEST --> HORIZON
       EPHEM & HORIZON --> VISIBILITY
       VISIBILITY --> DIFF
       INGEST --> RECOMMEND

       Backend --> Contracts
       Contracts --> Frontend
   ```
2. **Component Ownership & Contract Enforcement**:
   - Detail the 4-person parallel development methodology and how shared JSON schemas prevented integration conflicts.
3. **Data Flow & Caching Strategy**:
   - Explain how offline replay ensures the demo runs without internet access.

---

### E. `docs/validation.md` (QA, Benchmarks & Truth Certification)
*Target path:* `docs/validation.md`  
*Purpose:* Prove to evaluators that HORIZON OPS is scientifically tested and verified against official NASA baselines.

#### Key Sections to Include:
1. **Automated Test Suite Summary**:
   - **Total Tests**: **122 automated tests** passing in Pytest across `backend/tests/` and `tests/test_contracts.py`.
   - **Frontend Tests**: 4 unit tests passing in `frontend/src/scene/terrain-json.test.mjs`.
2. **Analytical Horizon Benchmarking**:
   - On a synthetic smooth sphere of radius $R = 1,737,400\,\text{m}$ with observer height $h$, the apparent horizon dip must match:
     $$\theta_{dip} = -\arccos\left(\frac{R}{R + h}\right)$$
   - Verified that computed horizon matches analytical formula to within $\pm 0.001^\circ$.
3. **Cross-Verification Against NASA Moon Trek**:
   - Compare horizon silhouettes generated by our engine against NASA Moon Trek line-of-sight elevation cuts at Connecting Ridge and Shackleton Crater.
4. **Contract Conformance Checks**:
   - Every JSON payload output by the backend validates against draft 2020-12 JSON Schemas in `contracts/`.
5. **Fail-Closed Design & Truth Assertions**:
   - If terrain data has gaps or is out of bounds, status is marked `unknown` rather than fabricating clear sky.

---

### F. `docs/user_guide.md` (Judge Demo Runbook & Feature Manual)
*Target path:* `docs/user_guide.md`  
*Purpose:* Provide a step-by-step walkthrough of every UI feature so judges can navigate the application effortlessly.

#### Key Sections to Include:
1. **Launching the Application** (local URL and pre-deployed link).
2. **Walkthrough of Primary Features**:
   - **Feature 1: Site Selection**: Choosing between Connecting Ridge, Shackleton, Malapert, and Haworth.
   - **Feature 2: Landing Hazard & Slope Evaluation**: Clicking dangerous crater walls and seeing instant $<8^\circ$ warnings.
   - **Feature 3: Using the Safe Haven Recommender**: Clicking "Find Nearby Safe Haven" to discover optimal flat ridges.
   - **Feature 4: Comparing Scenarios with LunaDiff**: Setting Scenario A (nominal) vs Scenario B (+48h launch delay) and reading the gained/lost sunlight timeline.
   - **Feature 5: Causal Horizon Inspector**: Clicking a lost-sunlight bar to open the 360° terrain obstruction popup.
   - **Feature 6: 3D Celestial Scrubber**: Dragging the timeline to watch the grazing polar Sun move and cast long shadows in real-time.
   - **Feature 7: Exporting Mission Plan**: Downloading JSON/CSV mission plans with complete provenance.

---

## 3. NASA Space Apps Official Submission Template

The Documentation Lead must prepare these exact fields for the official Space Apps portal submission:

### 1. Project Title
`HORIZON OPS — Lunar Landing Site, Mission Window & LunaDiff Navigator`

### 2. High-Level Summary (Elevator Pitch — max 200 words)
> At the Lunar South Pole, the Sun never rises high—it creeps along the horizon at $0^\circ$ to $1.5^\circ$, casting long, sweeping shadows from distant crater rims that can create 70-hour continuous blackouts. Meanwhile, Earth wobbles low in the sky, disrupting vital direct-to-Earth communication links.
>
> **HORIZON OPS** is an interactive, scientifically verified lunar landing site and mission window navigator. Powered by NASA Lunar Reconnaissance Orbiter (LOLA) 80m elevation models and JPL Horizons ephemerides, HORIZON OPS provides:
> 1. Immediate landing slope safety evaluation ($<8^\circ$ touchdown stability).
> 2. A Nearby Safe Haven Recommender that diverts planners away from shadow traps to flat, sunlit ridges.
> 3. Our novel **LunaDiff Engine** ("See what changed. See why."), which quantifies the exact impact of launch delays (+24h/+48h) on solar power and communication windows.
> 4. A Causal 360° Horizon Obstruction Inspector that pinpoints the exact physical mountain ridge blocking the Sun or Earth.
> 5. A synchronized 3D Three.js celestial lighting viewer that casts realistic grazing polar shadows.
>
> Built with React 19, FastAPI, and Python, HORIZON OPS is 100% offline-resilient, auditable, and grounded in authentic NASA planetary data.

### 3. How We Addressed the Challenge
> We tackled the "Lunar Landing Site Navigator" challenge by building an end-to-end mission planning dashboard that unites rigorous geodesy with intuitive visual explanation. We implemented lunar polar stereographic projections, lunar spherical curvature correction ($\Delta z = d^2 / (2 R_{moon})$), 360° azimuth horizon ray-casting out to 100 km, and circular-segment solar penumbra modeling. Rather than presenting abstract charts, we created **LunaDiff**, enabling mission planners to explore what happens when launch windows slip and visually inspect the causal terrain obstruction behind every lost minute of power.

### 4. Space Agency Data Used
- **NASA Lunar Reconnaissance Orbiter (LRO) / LOLA**: Polar Digital Elevation Model (`LDEM_80S_80MPP_ADJ`, $7600 \times 7600$ raster, 80 m/pixel). Link: https://pgda.gsfc.nasa.gov/products/90
- **NASA JPL Horizons On-Line Ephemeris System**: Apparent Sun and Earth positions, topocentric azimuth/elevation, and angular diameters from lunar south pole coordinates using ephemeris DE421. Link: https://ssd-api.jpl.nasa.gov/horizons.api
- **NASA Moon Trek**: Ground-truth cross-validation of lunar south pole features and horizon line-of-sight silhouettes. Link: https://trek.nasa.gov/moon/

### 5. Tools, Frameworks & Languages Used
- **Languages**: Python 3.14, TypeScript, JavaScript, HTML5/CSS3.
- **Frontend**: React 19, Vite, Tailwind CSS, Three.js, React Three Fiber, Lucide Icons, Recharts.
- **Backend & Science**: FastAPI, Pydantic, NumPy, SciPy, Rasterio, PyProj, Tifffile, ImageCodecs.
- **Testing & Quality Assurance**: Pytest, Node Test Runner, JSON Schema Draft 2020-12, GitHub Actions CI.

### 6. AI Tool Disclosure Statement
> "During the development of HORIZON OPS, generative AI assistants were utilized for scaffolding boilerplate code, optimizing numerical algorithms, writing unit test cases, and formatting markdown documentation. All mathematical formulas, scientific models, NASA data ingestion pipelines, and astronomical calculations were independently verified, benchmarked against NASA Moon Trek, and validated by our automated test suite (122 passing tests)."

---

## 4. 90–120 Second Video Pitch Script & Storyboard

This script is timed for a high-impact, judging-compliant presentation:

| Time | Visual / Screen Action | Spoken Narration (Voiceover) |
| :--- | :--- | :--- |
| **0:00 – 0:15** | **The Hook**: Zoom into Lunar South Pole on 3D Moon; show crater rims and long dark shadows. | *"At the Moon's South Pole, the Sun never rises high—it grazes the horizon at just one degree, while distant crater rims cast 70-hour shadows that can freeze a lander. Welcome to HORIZON OPS."* |
| **0:15 – 0:30** | **Map & Touchdown Hazard**: Click near Haworth Crater. UI immediately flags: 🔴 **HAZARD: 18.4° Slope (Tip-over risk)** and permanent shadow. | *"When a mission planner explores a site, HORIZON OPS calculates immediate touchdown slope safety against NASA Artemis standards—instantly flagging steep crater walls and shadow traps."* |
| **0:30 – 0:45** | **Safe Haven Recommender**: Click *"Find Safe Haven"*. System highlights Haworth North Ridge: 🟢 **SAFE: 4.2° Slope, 71% Sunlight, 4.8 km NW**. | *"If a site is hazardous, our Safe Haven Recommender scans surrounding terrain and diverts the mission to the nearest flat, sunlit ridge."* |
| **0:45 – 1:05** | **LunaDiff Launch Delay**: Open LunaDiff. Compare Nominal Launch vs +48-Hour Delay. Green and red differential bars appear. | *"Missions rarely launch on time. Our novel LunaDiff engine compares scenarios in seconds. When a launch slips by 48 hours, LunaDiff reveals exactly which sunlight and Earth communication windows are gained or lost."* |
| **1:05 – 1:20** | **Causal Obstruction Inspector**: Click a red "Lost Sunlight" bar. 360° horizon modal pops up showing the ridge blocking the solar disc. | *"Don't just see what changed—see why. Clicking any blackout window opens the Causal Horizon Inspector, revealing the exact mountain ridge 18 kilometers away blocking the solar disc."* |
| **1:20 – 1:35** | **Synchronized 3D Scrubber**: Drag timeline slider. Watch the 3D Sun rotate and cast real-time grazing shadows across LOLA topography. | *"Our interactive 3D celestial engine synchronizes solar lighting, Earth libration, and polar shadows in real time as you scrub through the mission."* |
| **1:35 – 1:45** | **Proven Science & 100% Offline**: Show 122 passing tests and click "Export Mission Plan (JSON/CSV)". Show NASA citations. | *"Backed by 122 automated tests, real NASA LOLA 80-meter DEMs, and JPL Horizons ephemerides, HORIZON OPS delivers truth before polish. Ready for Artemis. Ready for the Moon."* |

---

## 5. Style Guide, Tone & Scientific Terminology

To maintain professional credibility with NASA judges, follow these writing standards:

### 1. Terminology Rules:
- ✅ **DO USE**:
  - *"Geometric line-of-sight visibility"* (not "guaranteed comms link").
  - *"Lunar Polar Stereographic projection, standard parallel -90°"* (not "flat coordinates").
  - *"Topocentric apparent coordinates"* (not "sun position").
  - *"Touchdown slope safety standard (< 8° safe, Artemis HLS criteria)"*.
  - *"Solar disc penumbra fraction"* (not "partial sunshine").
  - *"Mean-Earth / Polar Axis (ME) frame (DE421)"*.
  - *"Unknown coverage"* (never assume missing DEM pixels are clear sky).
- ❌ **DO NOT USE**:
  - Avoid hyperbolic hype: *"Revolutionary AI magic"*, *"Flawless prediction"*, *"100% guaranteed communication"*.
  - Truth before polish: Always state assumptions and engineering limits clearly.

### 2. Markdown Formatting Best Practices:
- Use GitHub callout blocks:
  ```markdown
  > [!NOTE]
  > Surface elevation is referenced to the 1,737,400 m lunar sphere.
  ```
- Use LaTeX formatting for all mathematical equations ($$...$$).
- Include Mermaid diagrams for data flows and architectures.
- Make all file and source links clickable.

---

## 6. Progress Tracker & Pre-Submission Checklist

Copy this checklist into your notes and check off items as they are completed:

### Documentation Deliverables:
- [ ] Root `README.md` updated with Hero, problem, solution, quickstart, and demo script.
- [ ] `docs/sources.md` authored with NASA LOLA DEM & JPL Horizons citations and file hashes.
- [ ] `docs/methodology.md` authored with projection, curvature drop, horizon, and penumbra formulas.
- [ ] `docs/architecture.md` authored with Mermaid pipeline diagram and contract specifications.
- [ ] `docs/validation.md` authored with test counts (122 tests), analytical benchmarks, and Moon Trek checks.
- [ ] `docs/user_guide.md` authored with step-by-step feature walkthrough and screenshots.

### Submission Readiness:
- [ ] Space Apps Portal title, tagline, and project description finalized.
- [ ] AI Disclosure statement written and approved.
- [ ] Video demo recorded following the 90–120s storyboard script.
- [ ] Video uploaded to YouTube/Vimeo (set to Public or Unlisted, NOT Private).
- [ ] Public GitHub repository set to **Public** before submission deadline.
- [ ] All submission links tested in a fresh Incognito browser window by a second team member.
