# HORIZON OPS — Person A: Astronomy, Science & API Plan

> **Role:** Lead Astronomer, Visibility Science & Backend API Engineer  
> **Primary Domain:** Celestial Ephemerides, Solar/Earth Visibility Physics, LunaDiff Engine & FastAPI REST Services  
> **Assigned Branches:** `phase-1/a-backend-foundation`, `phase-2/a-horizons-client`, `phase-3/a-visibility-engine`, `phase-4/a-analysis-api`, `phase-5/a-science-qa`  
> **Owned Paths:** `backend/app/`, `backend/engine/`, `backend/tests/`, `backend/pyproject.toml`

---

## 1. Role Overview & Scientific Responsibilities

Person A owns the **astronomical accuracy, visibility physics, mission metrics, and REST API** for HORIZON OPS.
Key scientific principles to enforce:
- **JPL Horizons Ephemeris**: Query topocentric vectors for the Sun (`10`) and Earth (`399`) relative to lunar coordinates $(\phi, \lambda)$ using the `MOON_ME` (DE421) frame.
- **Finite Solar Disc & Penumbra**: The Sun has an angular diameter of $\sim 0.53^\circ$ ($\approx 32$ arcminutes). Model the illumination fraction $f_{sun} \in [0.0, 1.0]$ rather than binary on/off.
- **Earth Disc & Libration**: Model Earth angular diameter ($\sim 1.9^\circ$) and its 27.3-day libration cycle for direct-to-Earth (DTE) geometric line-of-sight.
- **LunaDiff Engine ("See what changed. See why.")**: Compare Scenario A vs Scenario B (site vs site or launch delay +24h/+48h) and generate causal physical explanations for lost/gained intervals.
- **Offline Hackathon Reliability**: Cache all queries to `data/cache/ephemeris/` so the backend runs 100% offline with zero latency during judging.

---

## 2. Dependency Matrix: Inputs & Outputs

```
  ┌─────────────────────────────────────────────────────────┐
  │ INPUTS CONSUMED BY PERSON A                             │
  │ • Person D: contracts/analysis.schema.json, diff.schema │
  │ • Person D: data/fixtures/synthetic_horizon.json (Ph 1-3│
  │ • Person B: backend/terrain/horizon.py profile α(θ)     │
  │ • Person B: backend/terrain/recommender.py search       │
  │ • NASA JPL: Horizons Observer REST API                  │
  └────────────────────────────┬────────────────────────────┘
                               │
                               ▼
  ┌─────────────────────────────────────────────────────────┐
  │ OUTPUTS PRODUCED BY PERSON A                            │
  │ • backend/engine/ephemeris.py (Cached vector engine)    │
  │ • backend/engine/visibility.py (Penumbral physics)      │
  │ • backend/engine/lunadiff.py (A/B delta engine)         │
  │ • FastAPI endpoints: /api/sites, /api/analyze,          │
  │   /api/diff, /api/recommend, /api/export                │
  │ • Clean CSV/JSON export engine with calculation metadata│
  └─────────────────────────────────────────────────────────┘
```

---

## 3. Phase-by-Phase Implementation Roadmap

### Phase 1: Backend Foundation (H0–H3)
* **Branch:** `phase-1/a-backend-foundation`
* **Tasks:**
  1. Initialize FastAPI application in `backend/app/main.py`.
  2. Configure CORS middleware (allow `localhost:5173` and Vite dev server).
  3. Implement `GET /api/health` returning status, version, and server timestamp.
  4. Setup `pytest` test harness in `backend/tests/test_health.py`.
* **Done When:** Running `pytest backend/tests/` passes and `uvicorn backend.app.main:app` serves `/api/health`.

### Phase 2: NASA JPL Horizons Client & Caching (H3–H11)
* **Branch:** `phase-2/a-horizons-client`
* **Tasks:**
  1. Build `backend/engine/ephemeris.py`:
     - Query JPL Horizons API for Sun (`10`) and Earth (`399`) observer tables from lunar coordinates.
     - Quantities: Azimuth, Elevation, Range, Angular diameter.
     - Time interval: 30-minute steps across mission date range (e.g., 14 to 28 days).
  2. Implement robust local disk caching (`data/cache/ephemeris/{site_id}_{start}_{duration}.json`).
  3. Add synthetic fallback fixture parser in case network is down.
  4. Write unit tests in `backend/tests/test_ephemeris.py`.
* **Done When:** Ephemeris returns deterministic topocentric vectors across a 14-day mission without live network access.

### Phase 3: Visibility, Penumbra & LunaDiff Engine (H11–H21)
* **Branch:** `phase-3/a-visibility-engine`
* **Tasks:**
  1. Build `backend/engine/visibility.py`:
     - Input: Ephemeris time-series and Horizon profile $\alpha(Az)$.
     - Solar penumbral fraction:
       $$f_{sun}(t) = \text{clamp}\left(\frac{El_{sun}(t) - \alpha(Az_{sun}(t)) + \theta_{sun}}{2 \theta_{sun}}, 0.0, 1.0\right) \quad (\theta_{sun} \approx 0.267^\circ)$$
     - Direct Earth LOS: $v_{earth}(t) = 1$ if $El_{earth}(t) > \alpha(Az_{earth}(t))$, else $0$.
  2. Build `backend/engine/metrics.py`:
     - Total sunlight hours, sunlight percentage, max continuous darkness interval.
     - Earth DTE uptime %, longest comm blackout duration, Goldilocks window (concurrent sunlight & Earth LOS).
  3. Build `backend/engine/lunadiff.py`:
     - Synchronize Scenario A and B on Mission Elapsed Time ($MET \in [0, T]$).
     - Calculate $\Delta$ metrics and list gained/lost time intervals.
     - Generate human-readable causal explanation for any timestamp $t^*$:
       *"At MET +72.0h, Sun is at 1.1° elevation, but crater rim rises to 1.8° at Azimuth 214°. Physical reason: Sun occluded by 0.7° behind terrain."*
* **Done When:** Synthetic flat and ridge cases pass test verification; LunaDiff calculates correct interval deltas.

### Phase 4: API Integration & Reproducible Export (H21–H30)
* **Branch:** `phase-4/a-analysis-api`
* **Tasks:**
  1. Wire Person B's real horizon profiles and safe haven search into FastAPI.
  2. Implement endpoints conforming strictly to `contracts/`:
     - `GET /api/sites`: Returns curated candidate sites from `data/sites.json`.
     - `POST /api/analyze`: Full point analysis (slope, horizon, sunlight, DTE, metrics).
     - `POST /api/diff`: LunaDiff A vs B differential comparison.
     - `POST /api/recommend`: Calls Person B's proximity search for nearby safe havens.
     - `GET /api/export`: Generates downloadable CSV / JSON with full scientific provenance.
  3. Add CORS, error handling, and input validation via Pydantic schemas.
* **Done When:** React frontend (Person C) can execute live queries and download reproducible CSV files.

### Phase 5: Scientific QA & Methodology Documentation (H30–H37)
* **Branch:** `phase-5/a-science-qa`
* **Tasks:**
  1. Validate computed Sun and Earth positions against published JPL Horizons tables.
  2. Author `docs/methodology.md`: Document frames (`MOON_ME`), time scales (UTC), penumbral formulas, and metric definitions.
  3. Verify zero fake/mock data in production mode.
* **Done When:** All backend tests pass (`pytest backend/tests/ -v`) and methodology documentation is complete.

---

## 4. Key Code Snippet: The LunaDiff Calculation

```python
# backend/engine/lunadiff.py
from typing import Dict, Any, List

def calculate_luna_diff(scenario_a: Dict[str, Any], scenario_b: Dict[str, Any]) -> Dict[str, Any]:
    samples_a = scenario_a["samples"]
    samples_b = scenario_b["samples"]
    
    sun_delta_hours = scenario_b["metrics"]["sunlight_hours"] - scenario_a["metrics"]["sunlight_hours"]
    max_darkness_delta = scenario_b["metrics"]["max_darkness_hours"] - scenario_a["metrics"]["max_darkness_hours"]
    dte_delta_hours = scenario_b["metrics"]["dte_comm_hours"] - scenario_a["metrics"]["dte_comm_hours"]
    
    intervals: List[Dict[str, Any]] = []
    for sa, sb in zip(samples_a, samples_b):
        met = sa["met_hours"]
        vis_a = sa["sun"]["visible"]
        vis_b = sb["sun"]["visible"]
        
        if vis_a and not vis_b:
            el = sb["sun"]["elevation_deg"]
            az = sb["sun"]["azimuth_deg"]
            horiz = sb["sun"]["horizon_deg"]
            diff = horiz - el
            intervals.append({
                "type": "LOST_SUNLIGHT",
                "met_hours": met,
                "reason": f"At MET +{met:.1f}h, Sun is at {el:.1f}° el, but terrain rises to {horiz:.1f}° at Az {az:.1f}°. Occluded by {diff:.1f}°."
            })
            
    return {
        "deltas": {
            "sunlight_hours": round(sun_delta_hours, 2),
            "max_darkness_hours": round(max_darkness_delta, 2),
            "dte_comm_hours": round(dte_delta_hours, 2)
        },
        "diagnostic_intervals": intervals
    }
```
