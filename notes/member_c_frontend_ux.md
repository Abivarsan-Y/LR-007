# HORIZON OPS — Person C: Frontend UX, LunaDiff & Dashboard Plan

> **Role:** Lead Frontend Engineer & UX Designer  
> **Primary Domain:** React Application Architecture, Interactive 2D Polar Map, LunaDiff Visualizer, Touch + Slider Scrubber & Charting  
> **Assigned Branches:** `phase-1/c-frontend-foundation`, `phase-2/c-mission-ui`, `phase-3/c-analytics-ui`, `phase-4/c-site-comparison`, `phase-5/c-ui-polish`  
> **Owned Paths:** `frontend/src/features/`, `frontend/src/components/`, `frontend/src/api/`, `frontend/src/App.tsx`, `frontend/src/index.css`

---

## 1. Role Overview & UX Responsibilities

Person C owns the **user journey, mission controls, reactive state management, and intuitive visual explanations** for HORIZON OPS.
Key design & interactive principles to enforce:
- **Aerospace Glassmorphic Design**: Clean, dark-mode aerospace aesthetic (pitch-black space background, glowing lunar telemetry badges, collapsible glass panels, zero unnecessary clutter).
- **Interactive Touch + Slider Timeline Scrubber**: A dual-input timeline scrubber at the bottom of the screen. Moving the scrubber simultaneously scrubs:
  - 3D Sun and Earth celestial positions (via Person D's Three.js viewport).
  - Horizon elevation crosshairs (showing Sun/Earth altitude against terrain).
  - Real-time HUD telemetry cards (sunlight %, DTE link status, battery/power estimate).
- **Interactive 2D Polar Map (Click to Pin)**: An interactive canvas/SVG map of the South Pole ($85^\circ\text{S} - 90^\circ\text{S}$). Users can click anywhere to drop a lander pin, instantly inspecting slope safety and viewing "Recommended Nearby Havens".
- **LunaDiff Inspector ("See what changed. See why.")**:
  - Compare Scenario A vs Scenario B (e.g. Site vs Site, or Date vs +48h launch delay).
  - A visual diff bar highlighting gained (green) and lost (red) intervals.
  - Clicking any lost interval opens a **Causal Horizon Popover** with the exact physical reason (e.g., *“Sun at 1.1° occluded by 1.8° crater rim at Az 214°”*).
- **Zero-Blocker Development**: Use Person D's synthetic fixtures in `data/fixtures/` during Phases 1–3, then switch to live FastAPI calls in Phase 4.

---

## 2. Dependency Matrix: Inputs & Outputs

```
  ┌─────────────────────────────────────────────────────────┐
  │ INPUTS CONSUMED BY PERSON C                             │
  │ • Person D: contracts/analysis.schema.json, diff.schema │
  │ • Person D: data/fixtures/mock_analysis.json (Ph 1-3)   │
  │ • Person D: frontend/src/scene/SceneView.tsx (3D Canvas)│
  │ • Person A: Live FastAPI Endpoints (Phase 4)            │
  └────────────────────────────┬────────────────────────────┘
                               │
                               ▼
  ┌─────────────────────────────────────────────────────────┐
  │ OUTPUTS PRODUCED BY PERSON C                            │
  │ • frontend/src/features/mission-planner/ (Controls)     │
  │ • frontend/src/features/lunadiff/ (A/B Diff Visualizer) │
  │ • frontend/src/features/map/ (2D Polar Click Map)       │
  │ • frontend/src/components/TimelineScrubber.tsx          │
  │ • frontend/src/features/analysis/HorizonChart.tsx       │
  │ • Complete responsive React application ready for judge │
  └─────────────────────────────────────────────────────────┘
```

---

## 3. Phase-by-Phase Implementation Roadmap

### Phase 1: Frontend Foundation & Layout Shell (H0–H3)
* **Branch:** `phase-1/c-frontend-foundation`
* **Tasks:**
  1. Initialize React + Vite + TypeScript in `frontend/`.
  2. Install Tailwind CSS, `lucide-react`, and selected charting library (`recharts` or custom Canvas).
  3. Build responsive app grid in `frontend/src/App.tsx`:
     - **Left Sidebar**: Mission setup (Site dropdown, date picker, observer mast height).
     - **Center**: Main viewport area (reserved for Person D's 3D scene / 2D Map toggle).
     - **Right Panel**: Telemetry scorecard and comparison metrics.
     - **Bottom Drawer**: Timeline scrubber placeholder.
  4. Setup typed API client in `frontend/src/api/client.ts` pointing to mock fixtures.
* **Done When:** `npm run dev` builds cleanly and renders responsive dashboard shell with synthetic data.

### Phase 2: Mission Controls & Touch/Slider Scrubber (H3–H11)
* **Branch:** `phase-2/c-mission-ui`
* **Tasks:**
  1. Build Mission Setup form:
     - Site selector (Connecting Ridge, Shackleton, Malapert, Haworth).
     - Mission start UTC date picker.
     - Duration slider (7 to 28 days).
     - Observer height toggle ($2\,\text{m}$ Lander Deck vs $5\,\text{m}$ Mast).
     - Quick delay buttons: `+24h Delay` and `+48h Delay`.
  2. Build `frontend/src/components/TimelineScrubber.tsx`:
     - Smooth slider with touch-swipe support for tablets/mobile.
     - Plays/pauses mission playback with $1\times, 5\times, 20\times$ speed controls.
     - Emits `currentMetHours` and `currentTimeUtc` to parent state.
  3. Render summary cards driven by mock fixture data.
* **Done When:** Dragging the scrubber updates timeline timestamp and metric badges smoothly without lag.

### Phase 3: LunaDiff Visualizer & Interactive Polar Map (H11–H21)
* **Branch:** `phase-3/c-analytics-ui`
* **Tasks:**
  1. Build **Interactive 2D Polar Map** (`frontend/src/features/map/PolarMap.tsx`):
     - Polar stereographic grid ($85^\circ\text{S} - 90^\circ\text{S}$) with crater outlines.
     - Click/touch event drops a target pin.
     - Displays point slope badge (🟢 Safe $< 8^\circ$, 🔴 Hazard $> 15^\circ$).
     - Shows "Nearby Safe Havens" card with 1-click divert button.
  2. Build **LunaDiff Differential Panel** (`frontend/src/features/lunadiff/LunaDiffPanel.tsx`):
     - Visual horizontal diff timeline: Green segments = Gained Sunlight/DTE; Red segments = Lost Sunlight/DTE.
     - Delta metric summary ($\Delta$ Sunlight hours, $\Delta$ Max darkness).
  3. Build **Causal Horizon Popover**:
     - Clicking any lost window opens a popover showing the azimuth obstruction angle.
  4. Build **Horizon Skyline Chart** (`frontend/src/features/analysis/HorizonChart.tsx`):
     - Plot terrain elevation vs azimuth ($0^\circ - 360^\circ$).
     - Overlay Sun and Earth trajectory markers at current scrubber time.
* **Done When:** User can click a lost sunlight window and immediately view the causal terrain obstruction popover.

### Phase 4: Live FastAPI Integration & 2-Site Comparison (H21–H30)
* **Branch:** `phase-4/c-site-comparison`
* **Tasks:**
  1. Switch `frontend/src/api/client.ts` from mock fixtures to live FastAPI endpoints (`/api/analyze`, `/api/diff`, `/api/recommend`).
  2. Build **Side-by-Side Comparison Matrix**:
     - Compare Site A vs Site B across Sunlight %, Max Darkness, DTE Comms %, and Goldilocks window.
  3. Wire up "1-Click Divert to Recommended Haven" from the Polar Map to the Mission Planner.
  4. Connect 1-click "Export CSV / JSON" button.
* **Done When:** Complete end-to-end user workflow runs seamlessly against the live Python backend.

### Phase 5: UI Polish, Touch Optimization & Accessibility (H30–H37)
* **Branch:** `phase-5/c-ui-polish`
* **Tasks:**
  1. Refine touch targets, responsive breakpoints (desktop, tablet, mobile).
  2. Add tooltip explanations for scientific terms ("Direct-to-Earth", "Penumbra", "Libration").
  3. Verify error boundaries and graceful offline fallback if backend disconnects.
* **Done When:** Frontend is visually stunning, intuitive for judges, and passes all build checks (`npm run build`).

---

## 4. Key Component Preview: LunaDiff Gained/Lost Inspector

```tsx
// frontend/src/features/lunadiff/LunaDiffPanel.tsx
import React, { useState } from 'react';

export const LunaDiffPanel: React.FC<{ diffData: any }> = ({ diffData }) => {
  const [selectedInterval, setSelectedInterval] = useState<any>(null);

  return (
    <div className="bg-slate-900/80 backdrop-blur border border-slate-700 rounded-xl p-4 text-white">
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-semibold text-cyan-400">LunaDiff: See What Changed</h3>
        <span className="text-xs text-slate-400">Scenario A vs Scenario B</span>
      </div>
      
      {/* Metrics Delta Badges */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="bg-slate-800 p-2 rounded text-center">
          <div className="text-xs text-slate-400">Sunlight Delta</div>
          <div className={`text-sm font-bold ${diffData.deltas.sunlight_hours >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {diffData.deltas.sunlight_hours > 0 ? '+' : ''}{diffData.deltas.sunlight_hours} hrs
          </div>
        </div>
        <div className="bg-slate-800 p-2 rounded text-center">
          <div className="text-xs text-slate-400">Max Darkness</div>
          <div className={`text-sm font-bold ${diffData.deltas.max_darkness_hours <= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
            {diffData.deltas.max_darkness_hours > 0 ? '+' : ''}{diffData.deltas.max_darkness_hours} hrs
          </div>
        </div>
        <div className="bg-slate-800 p-2 rounded text-center">
          <div className="text-xs text-slate-400">Direct Earth LOS</div>
          <div className="text-sm font-bold text-cyan-400">
            {diffData.deltas.dte_comm_hours > 0 ? '+' : ''}{diffData.deltas.dte_comm_hours} hrs
          </div>
        </div>
      </div>

      {/* Interactive Gained/Lost Timeline Bar */}
      <div className="h-6 w-full bg-slate-800 rounded flex overflow-hidden cursor-pointer">
        {diffData.diagnostic_intervals.map((inv: any, idx: number) => (
          <div
            key={idx}
            onClick={() => setSelectedInterval(inv)}
            className={`h-full flex-1 transition-opacity hover:opacity-80 ${inv.type === 'LOST_SUNLIGHT' ? 'bg-rose-500' : 'bg-emerald-500'}`}
            title={`MET +${inv.met_hours}h: Click to inspect causality`}
          />
        ))}
      </div>

      {/* Causal Explanation Popover */}
      {selectedInterval && (
        <div className="mt-3 p-3 bg-rose-950/60 border border-rose-700/50 rounded-lg text-xs">
          <div className="font-semibold text-rose-300 mb-1">Physical Causality at MET +{selectedInterval.met_hours}h:</div>
          <p className="text-slate-200">{selectedInterval.reason}</p>
        </div>
      )}
    </div>
  );
};
```
