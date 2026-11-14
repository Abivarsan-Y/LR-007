# HORIZON OPS — Person D: 3D Scene, Contracts & CI/CD Delivery Plan

> **Role:** Lead 3D Graphics Engineer, System Architect & DevOps  
> **Primary Domain:** Three.js / React Three Fiber Celestial Viewport, Shared JSON Schema Contracts, Mock Test Fixtures, CI/CD Pipeline & Production Deployment  
> **Assigned Branches:** `phase-1/d-contracts-ci`, `phase-2/d-terrain-viewer`, `phase-3/d-scene-controls`, `phase-4/d-scene-integration`, `phase-5/d-delivery`  
> **Owned Paths:** `frontend/src/scene/`, `contracts/`, `data/fixtures/`, `.github/workflows/`, `scripts/validate_fixtures.py`, `docs/architecture.md`, `README.md`

---

## 1. Role Overview & System Responsibilities

Person D owns the **3D immersive visualization, system interface contracts, synthetic test fixtures, and automated delivery pipeline** for HORIZON OPS.
Key architectural & graphical principles to enforce:
- **Hour 0–1 Priority**: Person D holds the keys to parallel team productivity. Writing the JSON schemas in `contracts/` and providing labeled synthetic fixtures in `data/fixtures/` ensures Person A, B, and C can work without waiting for each other.
- **Three.js Dual-Scale Celestial Engine**:
  - **Scale Challenge**: The Moon is $3,474\,\text{km}$ across, Earth is $384,400\,\text{km}$ away, while the lander deck and terrain mesh operate on meters.
  - **Solution**: Center the scene topocentrically at the candidate landing site $(0, 0, 0)$. Displace a local $256 \times 256$ grid from Person B's compact height-grid file. Render the celestial skybox with Sun and Earth positioned at directional infinity using topocentric azimuth/elevation unit vectors.
- **Dynamic Polar Grazing Shadows**:
  - The Sun at the lunar south pole has an elevation of only $0^\circ - 1.5^\circ$.
  - Configure Three.js `DirectionalLight` with a tightly bounded shadow frustum and PCF soft shadow maps to render dramatic, razor-sharp polar shadows across crater ridges.
- **Realistic Earth Model with Lunar Phases & Libration**:
  - Position a textured 3D Earth sphere with proper axial tilt.
  - Illuminate Earth with the same Sun directional vector so Earth displays its physically accurate phase as seen from the Moon!
- **CI/CD & Production Resilience**:
  - Automate GitHub Actions to test Python (pytest) and React (vitest + build) on every pull request.
  - Ensure the final production build has a verified static JSON fallback mode in case network access is restricted during judging.

---

## 2. Dependency Matrix: Inputs & Outputs

```
  ┌─────────────────────────────────────────────────────────┐
  │ INPUTS CONSUMED BY PERSON D                             │
  │ • Team: Scientific requirements & API parameter needs   │
  │ • Person B: data/processed/*.bin (Compact height-grids) │
  │ • Person A: Topocentric Sun & Earth ephemeris vectors   │
  │ • Person C: Layout container & timeline scrubber state  │
  └────────────────────────────┬────────────────────────────┘
                               │
                               ▼
  ┌─────────────────────────────────────────────────────────┐
  │ OUTPUTS PRODUCED BY PERSON D                            │
  │ • contracts/*.schema.json (Frozen interface contracts)  │
  │ • data/fixtures/*.json (Mock data unblocking A, B, C)   │
  │ • frontend/src/scene/SceneView.tsx (3D Canvas component)│
  │ • .github/workflows/ci.yml (Automated PR testing)      │
  │ • Production deployment configuration & demo fallback   │
  └─────────────────────────────────────────────────────────┘
```

---

## 3. Phase-by-Phase Implementation Roadmap

### Phase 1: Shared Contracts, Mock Fixtures & CI Pipeline (H0–H3)
* **Branch:** `phase-1/d-contracts-ci`
* **Tasks:**
  1. **Hour 0 Critical Task**: Author JSON Schemas in `contracts/`:
     - `site.schema.json`: Curated site coordinates and metadata.
     - `analysis.schema.json`: Sun/Earth azimuth, elevation, slope safety, and timeline metrics.
     - `diff.schema.json`: LunaDiff scenario deltas and causal obstruction descriptions.
     - `recommend.schema.json`: Nearby safe haven search results.
     - `terrain.schema.json`: Binary height-grid specification.
  2. Create labeled synthetic fixtures in `data/fixtures/`:
     - `mock_analysis.json`: Realistic 14-day sample series with both sunlit and shadowed samples.
     - `mock_diff.json`: Pre-computed scenario comparison with gained and lost intervals.
     - `mock_recommend.json`: Sample nearby haven response.
     - `mock_height_grid.bin`: Synthetic $64 \times 64$ crater heightfield.
  3. Author `scripts/validate_fixtures.py` to ensure fixtures validate against schemas.
  4. Setup `.github/workflows/ci.yml`: Runs pytest, npm test, and contract validation on all PRs.
* **Done When:** All schemas validate fixtures and GitHub Actions CI passes cleanly.

### Phase 2: Standalone 3D Terrain Viewer (H3–H11)
* **Branch:** `phase-2/d-terrain-viewer`
* **Tasks:**
  1. Build `frontend/src/scene/SceneView.tsx` using Three.js / React Three Fiber (`@react-three/fiber`, `@react-three/drei`).
  2. Implement `TerrainMesh.tsx`:
     - Displace a `PlaneGeometry` using the synthetic height-grid fixture.
     - Apply custom lunar regolith shader with subtle micro-roughness.
  3. Add Orbit Controls with damped rotation, zoom limits, and compass orientation indicator.
  4. Add a low-poly Lander Pod marker at $(0, 0, 0)$ with a $2\,\text{m}$ deck and $5\,\text{m}$ antenna mast.
* **Done When:** Standalone 3D terrain viewer runs smoothly in Vite with orbit and zoom controls.

### Phase 3: Dynamic Celestial Shading & Earth Libration (H11–H21)
* **Branch:** `phase-3/d-scene-controls`
* **Tasks:**
  1. Build `CelestialLighting.tsx`:
     - Convert topocentric Azimuth and Elevation into Three.js Cartesian light vectors:
       $$x = \cos(El) \sin(Az), \quad y = \sin(El), \quad z = -\cos(El) \cos(Az)$$
     - Align `DirectionalLight` with soft PCF shadow maps casting realistic grazing polar shadows.
  2. Build `EarthModel.tsx`:
     - Textured Earth sphere placed at topocentric Earth vector in the skybox.
     - Rotates dynamically to match Earth libration and displays accurate lunar phases.
  3. Ingest Person B's real compact height-grid file (`site01_terrain.bin`) replacing synthetic mesh.
* **Done When:** Moving Azimuth/Elevation props dynamically rotates the Sun lighting and Earth position on real lunar terrain.

### Phase 4: Full 3D Scene Integration & Scrubber Sync (H21–H30)
* **Branch:** `phase-4/d-scene-integration`
* **Tasks:**
  1. Embed `SceneView.tsx` into Person C's main dashboard layout.
  2. Bind the 3D scene props directly to Person C's `TimelineScrubber`:
     - Scrubbing time updates Sun vector and shadow direction in real-time ($60\,\text{fps}$).
     - Updates Earth phase and position in the lunar sky.
  3. Add camera presets:
     - *Tactical Surface View* (at lander deck height looking across crater rim).
     - *Orbital Overview* (high bird's-eye view looking down on South Pole).
  4. Optimize WebGL memory disposal to prevent memory leaks on site switching.
* **Done When:** Scrubbing the timeline slider smoothly moves the 3D Sun and Earth shadows without WebGL lag.

### Phase 5: Production Build, Offline Fallback & Delivery (H30–H37)
* **Branch:** `phase-5/d-delivery`
* **Tasks:**
  1. Build and test production bundle (`npm run build`).
  2. Configure static deployment fallback (e.g. Vercel / Netlify) embedding pre-computed real analysis JSONs so the app runs 100% offline.
  3. Author `README.md`: System overview, setup guide, architecture diagrams, and NASA source citations.
  4. Assist team with recording the 90-second demo video and checking NASA Space Apps submission links.
* **Done When:** Production app loads instantaneously from a fresh incognito browser window with zero console errors.

---

## 4. Key Component Preview: Three.js Directional Celestial Lighting

```tsx
// frontend/src/scene/CelestialLighting.tsx
import React, { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

interface CelestialProps {
  sunAzimuthDeg: number;
  sunElevationDeg: number;
}

export const CelestialLighting: React.FC<CelestialProps> = ({ sunAzimuthDeg, sunElevationDeg }) => {
  const lightRef = useRef<THREE.DirectionalLight>(null);

  // Convert Topocentric Azimuth/Elevation to Cartesian Vector
  const azRad = THREE.MathUtils.degToRad(sunAzimuthDeg);
  const elRad = THREE.MathUtils.degToRad(sunElevationDeg);

  const x = Math.cos(elRad) * Math.sin(azRad) * 500.0;
  const y = Math.sin(elRad) * 500.0;
  const z = -Math.cos(elRad) * Math.cos(azRad) * 500.0;

  return (
    <>
      <ambientLight intensity={0.04} color="#101525" />
      <directionalLight
        ref={lightRef}
        position={[x, y, z]}
        intensity={elRad > 0 ? 3.5 : 0.0}
        color="#fffaf0"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={10}
        shadow-camera-far={1000}
        shadow-camera-left={-200}
        shadow-camera-right={200}
        shadow-camera-top={200}
        shadow-camera-bottom={-200}
        shadow-bias={-0.0005}
      />
    </>
  );
};
```
