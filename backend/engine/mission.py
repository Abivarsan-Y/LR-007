"""Reproducible local horizon, analysis and LunaDiff commands for Phase 3."""

import argparse
import hashlib
import json
from pathlib import Path

import rasterio

from backend.engine.analysis import build_analysis, combine_provenance
from backend.engine.ephemeris import (
    EphemerisError,
    EphemerisRequest,
    HorizonsClient,
    Observer,
)
from backend.engine.lunadiff import calculate_luna_diff
from backend.engine.terrain_horizon import RasterTerrain, compute_horizon
from backend.engine.visibility import HorizonProfile


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def prepare_raster_horizon(
    site: dict,
    dem_paths: list[Path],
    manifest: dict,
    *,
    source_root: Path,
    observer_height_m: float = 2,
    max_radius_m: float = 100000,
    azimuth_step_deg: float = 0.5,
) -> HorizonProfile:
    """Validate exact source artifacts and site elevation before tracing rays."""
    observer = Observer(
        site_id=site["site_id"],
        observer_height_m=observer_height_m,
        **site["coordinates"],
    )
    sources = []
    for path in dem_paths:
        entry = manifest.get(path.name)
        if entry is None or (source_root / entry["path"]).resolve() != path.resolve():
            raise ValueError(f"DEM missing from the source manifest: {path}")
        if path.stat().st_size != entry["bytes"]:
            raise ValueError(f"Source byte count changed: {path}")
        with path.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        if digest != entry["sha256"]:
            raise ValueError(f"Source checksum mismatch: {path}")
        sources.append(
            {"id": "dem-" + path.stem, "uri": entry["url"], "sha256": digest}
        )
    provenance = combine_provenance(
        site["provenance"],
        {"data_kind": "cached_real", "sources": sources, "assumptions": []},
        model_version="native-raster-horizon-v1",
        assumptions=[
            "DEMs use the NASA-documented lunar mean-Earth frame, metres and a 1737400 m sphere.",
            "Sample preferred local terrain first, falling back only to valid source heights in the broader DEM.",
            "Terrain sampling is bilinear; the finite radial/azimuth grid can miss subgrid or more distant obstructions.",
            "Any unresolved sample makes the entire sampled ray unknown; no edge clipping or median-filled nodata.",
            f"Search radius {max_radius_m:g} m; azimuth spacing {azimuth_step_deg:g} deg; near/far radial spacing 5/20 m.",
            "Complete coverage describes the configured sampled rays, not all possible terrain directions or distances.",
        ],
    )
    with RasterTerrain(dem_paths) as terrain:
        height = float(terrain.sample(observer.longitude_deg, observer.latitude_deg))
        if not abs(height - observer.elevation_m) <= 0.01:
            raise ValueError(
                "Observer elevation does not match the preferred native DEM (0.01 m tolerance)"
            )
        return compute_horizon(
            observer,
            terrain.sample,
            provenance=provenance,
            max_radius_m=max_radius_m,
            azimuth_step_deg=azimuth_step_deg,
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    horizon = commands.add_parser(
        "horizon", help="Trace a source-verified native-raster skyline"
    )
    horizon.add_argument("--site", type=Path, required=True)
    horizon.add_argument(
        "--dem",
        type=Path,
        action="append",
        required=True,
        help="Preferred DEM first, fallback DEM last",
    )
    horizon.add_argument("--source-manifest", type=Path, required=True)
    horizon.add_argument("--source-root", type=Path, default=Path.cwd())
    horizon.add_argument("--observer-height-m", type=float, default=2)
    horizon.add_argument("--max-radius-km", type=float, default=100)
    horizon.add_argument("--azimuth-step-deg", type=float, default=0.5)
    analyze = commands.add_parser(
        "analyze", help="Replay a real ephemeris cache and apply a matching skyline"
    )
    analyze.add_argument(
        "--ephemeris",
        type=Path,
        required=True,
        help="Phase 2 bundle supplying the exact request",
    )
    analyze.add_argument("--horizon", type=Path, required=True)
    analyze.add_argument("--cache-dir", type=Path, default=Path("data/cache/ephemeris"))
    analyze.add_argument(
        "--online",
        action="store_true",
        help="Permit NASA requests for missing real records",
    )
    analyze.add_argument("--slope-deg", type=float)
    diff = commands.add_parser(
        "diff", help="Compare two completed analyses on elapsed time"
    )
    diff.add_argument("--scenario-a", type=Path, required=True)
    diff.add_argument("--scenario-b", type=Path, required=True)
    for command in (horizon, analyze, diff):
        command.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "horizon":
            result = prepare_raster_horizon(
                read_json(args.site),
                args.dem,
                read_json(args.source_manifest),
                source_root=args.source_root,
                observer_height_m=args.observer_height_m,
                max_radius_m=args.max_radius_km * 1000,
                azimuth_step_deg=args.azimuth_step_deg,
            ).model_dump(mode="json")
        elif args.command == "analyze":
            request = EphemerisRequest(**read_json(args.ephemeris)["request"])
            ephemeris = HorizonsClient(args.cache_dir).get_ephemeris(
                request, offline=not args.online
            )
            result = build_analysis(
                ephemeris,
                HorizonProfile(**read_json(args.horizon)),
                slope_deg=args.slope_deg,
            )
        else:
            result = calculate_luna_diff(
                read_json(args.scenario_a), read_json(args.scenario_b)
            )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8"
        )
        print(f"Wrote {args.command}: {args.output}")
    except (
        ValueError,
        KeyError,
        OSError,
        EphemerisError,
        rasterio.errors.RasterioError,
    ) as error:
        parser.exit(1, f"Mission calculation unavailable: {error}\n")


if __name__ == "__main__":
    main()
