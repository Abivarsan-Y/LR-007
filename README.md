# HORIZON OPS — LR-007

Lunar Landing Site, Mission Window & LunaDiff Navigator. Work allocation follows the [master plan](notes/master_plan.md).

## Current application

The dashboard combines an interactive Cesium Moon, LROC WAC imagery, a verified local LOLA terrain crop and recorded Sun/Earth analysis for Connecting Ridge (Site 01). Search selects the site; a 14-day timeline synchronizes the numeric readouts, horizon inspector and celestial direction vectors. The +48 h LunaDiff uses bundled recorded scenarios.

The global Moon is a reference sphere with real imagery. Detailed elevation is available only at the verified Site01 crop. Other catalog sites have preview data; arbitrary coordinate selections are inspection only and have unknown analysis. Terrain slope screening is not a landing-safety certification. Imagery lighting is baked into the source mosaic; the main viewer does not calculate scientific shadows or Earth phase/libration.

## Run

Requires Node 24 and npm. From the repository root:

```sh
npm --prefix frontend ci
npm --prefix frontend run dev
```

For the self-contained recorded demo, including bundled real imagery:

```sh
npm --prefix frontend run build
npm --prefix frontend run verify:delivery
npm --prefix frontend run preview -- --host 127.0.0.1
```

Keep the preview server running during an offline laptop demo. Default imagery is bundled, so no internet or NASA requests are needed. Optional live tiles require internet. Open the printed URL and search **Connecting Ridge**. Production builds also install a versioned browser cache; see [delivery instructions and limitations](docs/delivery.md). A browser must visit the hosted app online before attempting a fully disconnected reload.

The optional Python 3.14 FastAPI backend supports astronomy, visibility, LunaDiff and export endpoints. See [backend setup](backend/README.md). A static frontend deployment uses recorded analysis when no API is configured.

## Checks

```sh
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run verify:delivery
python scripts/validate_fixtures.py
python -m unittest discover -s tests -v
```

The Python commands need `requirements-dev.txt` installed in a virtual environment. Backend science checks have separate dependencies and run in their own CI workflow; passing frontend checks does not imply those tests passed.

## Architecture and ownership

- A: astronomy, visibility engine and API.
- B: DEM ingestion, geodesy, horizon and terrain screening.
- C: mission UI, horizon inspector and LunaDiff.
- D: scene integration, shared contracts, validation and static delivery.

See [architecture](docs/architecture.md), [contract conventions](docs/contracts.md), [frontend details](frontend/README.md) and [D delivery status](docs/delivery.md). The standalone Three.js scene remains a separate legacy preview; the main dashboard uses Cesium.

## Data sources

- [NASA/GSFC LOLA Site01 DEM](https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site01/Site01_final_adj_5mpp_surf.tif): local elevation crop. Tracked binary metadata declares its reference sphere, frame and checksum.
- [NASA/JPL Horizons](https://ssd.jpl.nasa.gov/horizons/): recorded observer ephemerides used by the bundled analysis. Fixture manifests are in `backend/tests/fixtures/science/site01/`.
- [LROC WAC via Lunaserv](https://wms.im-ldi.com/): global and local imagery. Exact GetMap requests, bounds, retrieval timestamp and SHA-256 hashes are in `frontend/public/imagery/sources.json`.

Raw multi-GB DEMs and credentials are excluded from Git. Source planning documents in `notes/` are retained.
