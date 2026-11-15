# D delivery status and release procedure

## Completed in the current Cesium scope

- Shared schemas, labeled synthetic fixtures, validation and CI.
- Real Site01 binary terrain integration with coordinate/provenance checks.
- Orbital, oblique and observer-position surface camera; wireframe, slope display and height exaggeration.
- Recorded Sun/Earth vectors synchronized to the selected timeline sample; mismatch suppression.
- Viewer resource cleanup, deferred loading and failure isolation.
- Bundled real global and Site01 LROC images with source requests and checksums. Live tiles are opt-in.
- Production cache generation and verification, CI static artifact and Netlify configuration.
- Current setup guide, architecture and demo instructions.

These are completion statements for the current scientifically bounded Cesium implementation. They do not mark all original Three.js graphics aspirations complete.

## Offline modes

**Recommended judging setup:** build once, run Vite preview locally, leave that process running, and use the default bundled imagery. The recorded Site01 terrain/analysis/LunaDiff and image files are all served from the laptop. This supports a demo without internet, even in a browser that restricts service workers.

**Browser-saved mode:** production builds register `sw.js` on HTTPS or localhost. Wait for **DEMO SAVED FOR OFFLINE** before disconnecting. Installation precaches every build file in batches; API calls and live external tiles are excluded. A content hash versions the cache. New service workers wait for older tabs to close before activation, preventing a running demo from mixing releases. Browser storage can be evicted, private browsing can restrict it, and a first visit still needs the deployed files.

Automated tests verified installation contents, cache isolation, offline navigation fallback and API exclusion using the generated worker. The in-app browser displayed cache readiness, but a server-stopped reload produced a blank page. That fully disconnected browser reload is **not accepted as verified**; repeat it in the final deployment/browser before relying on browser-saved mode. The supported local-server demo does not depend on that reload behavior.

## Build and deploy

```sh
npm --prefix frontend ci
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run verify:delivery
```

`netlify.toml` publishes `frontend/dist` from the repository root using Node 24. It deliberately returns 404 JSON for `/api/*`; the client then uses recorded fixtures. Configure and validate a real backend route separately when deploying live analysis. The current asset base assumes root hosting `/`, not a GitHub Pages repository subpath.

CI uploads `horizon-ops-static-demo` after the production checks. Download/extract it and serve the directory over HTTP; opening `index.html` via `file://` is not supported. Publishing a site, choosing an account/domain and final hosted smoke tests remain release actions; no live URL is claimed by this work.

Refresh imagery only deliberately with `npm --prefix frontend run cache:imagery`. Review the new source manifest and image hashes, then rebuild and run delivery verification. Normal builds do not request external imagery.

## Verification record

- Frontend: 23 tests passed; production TypeScript/Vite build passed. Initial dashboard JavaScript is about 298 kB before gzip; the separate Cesium module remains about 4.24 MB.
- Contracts: all five synthetic fixtures and eight Python contract tests passed.
- Delivery artifact: real image hashes, terrain linkage, complete cache contents, offline app-shell fallback, unrelated-cache preservation and API exclusion passed.
- Browser: bundled imagery, recorded Site01 selection, terrain wireframe, oblique/surface cameras, end-of-window timeline selection and cache-readiness indicator exercised; no viewer console errors observed.
- Backend science suite: not rerun in this delivery environment (pytest/backend dependencies absent). Prior integration work recorded two API/fixture equality failures. Do not treat D's green checks as backend science approval.

## Remaining team/release work

| Work | Owner / condition |
| --- | --- |
| Final hosted URL, HTTPS/offline browser smoke test, deployment account selection | D/team release |
| Additional scientifically verified sites, observer heights, terrain frame/radius alignment | A + B, then D integration |
| Arbitrary-location analysis and validated nearby-candidate solar advantages | A + B, then C/D display |
| Scientific shadows with sufficient terrain coverage | B supplies coverage; D implements and validates rendering against A's horizon results |
| Physically oriented Earth phase/libration | Validated geometry/orientation inputs and rendering validation; current arrows do not claim this |
| Final demo recording and submission links | Team; actual destination links have not been supplied |

## Honest 90-second demo

1. Search Connecting Ridge and show the **cached real** provenance.
2. Explain the real LROC global mosaic versus the small verified LOLA relief crop.
3. Choose oblique view and toggle wireframe/slope; keep height at 1× for geometry explanations.
4. Scrub the recorded 14-day timeline and explain the Sun/Earth numeric direction changes.
5. Inspect a +48 h LunaDiff interval against the horizon profile, explaining that the local crop does not contain every distant obstruction.
6. Export recorded analysis and show its provenance. State that slope screening is not a certified landing decision.
