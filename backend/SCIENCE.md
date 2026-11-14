# Phase 3 scientific model and validation

This is a reproducible, sampled planning-support model. It computes terrain-aware
Sun/Earth visibility and comparisons; HTTP/UI integration is a separate phase.

## Inputs, coordinates and source integrity

The Phase 2 client supplies airless apparent body-centre azimuth/elevation,
equatorial angular diameter and UTC timestamps. Native NASA LOLA GeoTIFFs supply
surface elevation in metres above the 1,737,400 m lunar sphere. The observer adds
its mast/deck height to that surface elevation. All inputs must represent the
same observer, mean-Earth frame and height.

The native-raster adapter reads each GeoTIFF's affine and CRS, checks the lunar
sphere and unit scale, and transforms lunar longitude/latitude through that CRS.
The source manifest is checked against actual file length and full SHA-256.
NASA product documentation establishes the mean-Earth DE421 frame; a generic
CRS label alone does not establish a lunar orientation model.

Raster interpolation uses pixel centres and bilinear weights. Outside coverage
stays unknown. A preferred high-resolution source can fall back to a valid
regional source; an unresolved value is never replaced by a median or repeated
edge pixel. A 1e-6 pixel snap tolerance handles numerical roundoff at exact
centres, particularly near the pole. Broad windows are split to bound memory;
the whole polar DEM is not expanded into a temporary memory-mapped file.

B's merged reader remains available but is not used by this scientific adapter.
Its polar-Y convention, edge clipping, nodata filling and full-image memmap
behavior need reconciliation with the native NASA grids before scientific
integration. B's source files and interfaces were not changed by this phase.

## Spherical terrain horizon

True north-clockwise bearings are traced on a lunar sphere using `pyproj.Geod`.
This avoids interpreting polar-map image rows as local geographic north. For a
terrain point at surface distance `d`, reference radius `R`, terrain elevation
`z`, observer surface elevation `z0` and observer height `h`:

```text
theta = d / R
vertical = (R + z) * cos(theta) - (R + z0 + h)
horizontal = (R + z) * sin(theta)
terrain_elevation = atan2(vertical, horizontal)
```

The largest sampled elevation along each bearing is the skyline. Negative
skylines are preserved. On a flat sphere this reproduces the analytic depressed
horizon `-acos(R / (R+h))` to the configured sampling tolerance.

Default preparation uses a finite 100 km search, 0.5° bearing steps, 5 m radial
steps within 2 km and 20 m beyond. The recorded real fixture and four-site local
validation use **150 km and 0.25°**. Actual values are stored in the profile and
analysis provenance. Missing any radial height makes that bearing unknown.
Profiles interpolate circularly across 0°/360°; an unknown endpoint makes its
interpolation interval unknown.

Coverage `complete` means the configured ray samples were known. It does not
prove continuous coverage between samples, resolve sub-pixel rocks, or rule out
obstructions beyond the radius. Finite radial and azimuth sampling, bilinear
terrain and different local/regional effective resolutions remain limitations.
Native height/slope uncertainty layers are retained in site-source metadata;
this phase does not propagate them into a complete confidence interval.

## Solar disc and Earth visibility

Let `c` be Sun-centre elevation minus terrain-horizon elevation and `r` its
angular radius. The model assumes a uniformly bright circular solar disc and a
locally straight horizon through the disc. If `u=c/r`, exposed area fraction is:

```text
u <= -1: f = 0
u >=  1: f = 1
otherwise: f = (acos(-u) + u * sqrt(1-u*u)) / pi
```

The fraction is bounded to [0,1] against floating roundoff. This circular-segment
model replaces the plan's approximate linear ramp. It does not model solar limb
darkening or the full jagged two-dimensional skyline across the disc.

- Sun `visible`: any positive exposed fraction. An upper limb just tangent to
  the horizon has zero exposed area and is classified blocked.
- Earth `visible`: its apparent centre is strictly above the local skyline.
  Equality is blocked. Earth's finite disc is supplied but is not used to claim
  visibility of a particular ground station or available RF service.
- Unknown horizon: visibility and solar fraction are null.

## Time intervals and metrics

Every sample governs the half-open interval `[MET_i, MET_i+1)`. The final endpoint
adds no duration. This follows D's shared fixture convention. Durations come from
actual elapsed-time differences, with UTC/MET agreement checked independently.

- `sunlight_hours`: integral of exposed disc fraction, in **full-sun-equivalent
  hours**, not binary sunlight duration or generated electrical energy.
- `sunlight_fraction`: those equivalent hours divided by mission duration.
- `max_darkness_hours`: longest consecutive zero-visible-solar-disc interval.
- `earth_visible_hours/fraction`: time with Earth-centre visibility.
- `max_earth_occlusion_hours`: longest consecutive Earth-centre blockage.
- `both_visible_hours`: time with any sunlight and Earth-centre visibility.

Unknown positive-duration samples make affected whole-mission totals/maximum
outages null. Bodies remain independent: an unknown solar condition does not
invalidate a fully known Earth total. For overlap, a known blocked body makes
the conjunction false even if the other is unknown. The interval helper retains
contiguous visible/blocked/unknown windows for subsequent presentation.

There is no event refinement in this phase. With 30-minute ephemerides, transition
times are grid-limited and short events between samples can be missed. Fractional
sunlight integration does not make transition times precise to seconds.

Slope `SAFE/CAUTION/HAZARD` labels use the plan's <8°, 8–15°, >15° screening bands.
They are project heuristics, not spacecraft certification. An omitted slope is
`UNKNOWN`; the visibility engine does not infer a slope from the sky geometry.

## LunaDiff

Scenarios must have equal durations but may have different UTC starts, sites or
sample spacings. They align on the union of mission-elapsed-time boundaries;
each scenario retains its own left-held values. Metric deltas are **B minus A**
and are recomputed from samples instead of trusting stale supplied summaries.

Contiguous boolean gains/losses of Sun or Earth visibility are merged into
half-open intervals. Unknown comparisons produce no claimed gain/loss. Changes
between two partially exposed solar discs affect equivalent-hour deltas but do
not create a boolean visibility event. Causal text gives each scenario's centre
elevation, horizon and azimuth at the interval start; it does not invent a named
ridge or claim constant geometry throughout a long interval.

## Validation evidence

Controlled cases test analytic flat-sphere curvature, a true-east ridge at
nonzero lunar longitude, nodata rays, native pixel centres, source/frame
validation, circular seams, disc fractions/symmetry, partial sunlight, UTC/MET,
irregular duration weighting, endpoint treatment, unknown intervals, and
elapsed-time gain/loss comparisons with different grids and dates.

The separate `Backend science` GitHub Actions workflow installs the locked
Python 3.14 environment and runs backend pytest plus shared contract checks.
D's existing contract/scene workflow remains unchanged.

The small `tests/fixtures/science/site01/` recording exercises real NASA inputs,
offline raw-cache replay and D's full analysis/diff schemas without a multi-GB
download. This is integration evidence, not an independent flight-validation
oracle. Source links and hashes, exact observation coordinates and reproducible
preparation parameters are included. A mathematical or synthetic input keeps
the combined result labeled synthetic; real ephemerides do not turn synthetic
terrain into a real terrain prediction.

Local four-site validation used native source-backed observation pixels, 1,440
known sampled bearings per site and cached real 14-day Sun/Earth series for
nominal/+24 h/+48 h starts. All 12 analyses and 8 launch-delay diffs validated
against the merged D contracts. Observation pixels are not optimized/approved
landing sites; the selected Site04 pixel has a steep native slope.

For the Site01 nominal window, 100 km versus 150 km at 0.25° changed no sampled
skyline angles or metrics. At 150 km, refining 0.5° to 0.25° produced a maximum
skyline difference of 0.030532° (95th percentile 0.005509°), an equivalent-sunlight
change of 0.001803 h (about 6.5 s), and no change in Earth-hour/maximum-outage
metrics. These are sensitivity results for this case, not universal error bounds.

The nominal Site01 example yields approximately 249.064 full-sun-equivalent
hours over 336 h, 59.5 h maximum darkness and 89.5 h maximum Earth-centre
occlusion. These results follow this finite sampled model and its source inputs;
they do not claim continuous communications, battery survival or touchdown safety.

Sources: [NASA PGDA product 78](https://pgda.gsfc.nasa.gov/products/78),
[product 90](https://pgda.gsfc.nasa.gov/products/90),
[JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html), and
[Horizons manual](https://ssd.jpl.nasa.gov/horizons/manual.html).
