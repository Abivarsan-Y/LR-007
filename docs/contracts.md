# D foundation: shared contracts and scene conventions

Scope follows `notes/master_plan.md` only. These are draft v0.1.0 response contracts, not implemented HTTP endpoints. A/B/C should review them before freezing; request contracts and application types follow that agreement.

## Five contracts

| Schema | Example | Consumer |
|---|---|---|
| site | mock_site.json | A/B/C/D: point, height, terrain bounds |
| analysis | mock_analysis.json | C/D: timeline, body directions, horizon, metrics |
| diff | mock_diff.json | A/C: B-minus-A changes and elapsed-time intervals |
| recommend | mock_recommend.json | B/A/C: nearby candidates, bearing and slope |
| terrain | mock_terrain.json | B/D: binary grid layout, origin and checksum |

Every object carries a schema version and provenance. `data_kind` distinguishes `synthetic`, `cached_real`, and `live_real`. Real records must identify sources with IDs, URIs and SHA-256 hashes of the source artifacts. Synthetic examples have no NASA source attribution.

## Coordinates and time

- Latitude in degrees, north positive; longitude in [-180,180], east positive. Normalize 222° E to -138° before sending this contract.
- Coordinates use `MOON_ME_DE421`; elevation is metres above a 1,737,400 m reference sphere. Observer height is additional metres above terrain. Data producers must verify transforms rather than relabel another frame.
- Azimuth in [0,360), clockwise from local north. Elevation in [-90,90], relative to local horizontal.
- ISO 8601 UTC timestamps must end in `Z`. Mission elapsed time is hours from analysis start.
- Samples include mission start and end and increase strictly. For fixture metrics, each sample governs the half-open interval until the next sample; the final endpoint contributes no duration. These are deliberately coarse step examples, not an event-refinement solver.
- Diff intervals are half-open `[start_met_hours,end_met_hours)` and share an equal-duration elapsed-time axis. Deltas are B minus A. Different scenarios can have different absolute UTC starts.

## Unknowns and interpretation

Unknown terrain elevation/visibility/illumination is `null`, never silently false or clear. Metrics may also be null when insufficient coverage prevents calculation. `visible` needs A's agreed body-centre/disc definition before real-data integration. Sunlight hours in the synthetic example integrate illumination fraction using the step convention above.

`SAFE`, `CAUTION`, and `HAZARD` are the master plan's slope screening categories, not flight certification. `mock_site` has unknown real terrain coverage; the analysis supplies an explicitly artificial flat horizon. Its slope and positions are invented test inputs. The two-hour example keeps reviews small; a real mission-length fixture should come from A's verified computation later. `mock_diff` illustrates an A/B response; its synthetic B analysis is not supplied. The empty recommendation list explicitly demonstrates a valid no-candidate result.

## Terrain grid handoff (B → D)

`mock_height_grid.bin` is 64×64 float32, little-endian and row-major. Columns move west to east; rows move north to south in a **local ENU** grid. Metadata coordinates identify the centre of the grid; sample centres span `(width-1)*spacing` by `(height-1)*spacing`. For even dimensions, the origin lies between the centre samples. Heights are absolute metres above the stated sphere; subtract origin elevation when creating the local mesh. NaN means nodata and must not become a filled terrain surface. This compact local grid is a derived display asset, not the source DEM or scientific horizon.

For row `r`, column `c`: `x=(c-(width-1)/2)*spacing`, `z=(r-(height-1)/2)*spacing`, `y=height-origin_elevation`. Thus scene axes are **+X east, +Y up, -Z north**. The SHA-256 and byte count must match before loading. B is responsible for resampling projected source terrain into this local grid; copying raster rows without coordinate conversion is insufficient.

`azElToSceneDirection()` converts celestial azimuth/elevation to that same scene basis. It supplies a unit vector toward the target, independent of React and Three.js. The later renderer can use it without duplicating the transformation.

## Validation limits and next steps

The validator rejects malformed schema data, invalid UTC/MET alignment, reversed intervals, unknown-horizon visibility, missing real-source attribution and corrupted binary assets. It does not validate terrain science, orbital calculations, metric physics or every relationship between separate documents. Passing these checks is an interface guarantee within these limits.

Next: review formats with A/B/C; expand negative/unknown fixtures; wire checks into their applications; then add D's standalone Three.js terrain viewer using the synthetic grid. The renderer must display a synthetic-data label. Real offline demo assets will be prepared separately from these fixtures.
