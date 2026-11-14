# HORIZON OPS — observation and arrival-window explorer

The main app provides one recorded scientific demonstration and separate terrain inspection views. Run Node 24 with `npm --prefix frontend ci` and `npm --prefix frontend run dev`. Optional backend: follow `backend/README.md` and run on port 8000; Vite proxies `/api`. Recorded Site01 playback and exports work without a backend or raw DEM download.

## Demonstration

1. Choose **Explore the verified demo** (Connecting Ridge).
2. Inspect the fixed 2 m observer for 15–29 November 2026. Playback selects recorded 30-minute samples.
3. Read sunlight-equivalent hours, darkness, Earth-centre visibility, longest Earth blockage and overlap. Terrain clicks inspect a separate point and never relocate the analyzed observer.
4. Open **Arrival +48 h** for 17 November–1 December. Inspect a changed interval and read both nominal and delayed geometry at the selected elapsed time.
5. Open **Data & method** for source URLs, SHA-256 records, model assumptions and sampling limits. Export JSON or CSV; offline CSV retains precision, hashes, assumptions and mission metadata.

Other catalog sites expose terrain inspection only. Their exploratory astronomy is withheld from results and the viewer. Unsupported dates/heights are not editable. Candidate markers are terrain suggestions, not newly analyzed or certified landing sites. The globe, light and terrain context are illustrative; visibility comes from the horizon calculation. This release does not claim global real DEM coverage, a radio link budget, or event-refined transition times.

## Checks

`npm --prefix frontend run build` includes TypeScript validation. `npm --prefix frontend test` runs geometry/adapter tests and science-client regression tests for unknown coverage, unsupported heights, export request identity and offline provenance. The renderer is loaded separately from the initial interface. Browser/GPU, keyboard and responsive visual acceptance still require testing on the target device; the cloud browser was unavailable during this implementation.

This branch starts from main `6046515`. It does not merge the separate `Frontend-Overhaul` camera/imagery update, B's later renderer changes or the Cesium experiment. Those require independent integration and scientific/display validation.
