# Recorded real Horizons responses

Two small cache records contain unmodified NASA/JPL Horizons API JSON responses
for Sun and Earth, retrieved on 14 November 2026. Each envelope records the exact
request, acquisition time, source SHA-256 and full raw response. Its filename is
the cache identity hash. Hashes detect accidental corruption, not malicious
replacement of both source and checksum.

The **development observer** is a specified mathematical point: planetocentric
latitude -89°, longitude 0° east, radial surface elevation 0 m above a 1,737,400 m
lunar sphere, and 2 m observer height. It is **not a DEM-verified landing site**,
and no terrain coverage, visibility or safety claim is attached to it. Member B
must supply verified real-site coordinates before site-specific integration.

The period is 2026-11-15 00:00 UTC through 2026-11-29 00:00 UTC, inclusive, with
30-minute spacing: 673 records per body. Horizons quantities 4, 13 and 20 supply
airless apparent body-centre azimuth/elevation, equatorial disc diameter in
arcseconds, and apparent range in kilometres. The parser converts diameter to
degrees. Source output identifies the translational ephemeris (currently DE441)
separately from the lunar mean-Earth orientation; these are not interchangeable
frame labels.

These are real NASA computations for explicit development inputs, not synthetic
fixtures and not observations of terrain. Unit tests make no live network calls.
The cache reader verifies the hash, request identity, source metadata, units and
complete time grid before replaying them. The raw payload does not contain the
derived terrain or mission metrics required by a complete analysis response.

Sources:

- https://ssd-api.jpl.nasa.gov/doc/horizons.html
- https://ssd.jpl.nasa.gov/horizons/manual.html (Lunar Mean-Earth Frame of DE421)
- https://ssd.jpl.nasa.gov/api/horizons.api (full query parameters are in each record)
