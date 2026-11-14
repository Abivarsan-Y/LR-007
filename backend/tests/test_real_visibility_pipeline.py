"""Offline integration of recorded NASA positions and a source-derived skyline."""

import hashlib
import json
import subprocess
import sys
from pathlib import Path

from backend.engine.analysis import build_analysis
from backend.engine.ephemeris import EphemerisRequest, HorizonsClient
from backend.engine.lunadiff import calculate_luna_diff
from backend.engine.visibility import HorizonProfile
from scripts.validate_fixtures import validate_document

FIXTURES = Path(__file__).parent / "fixtures/science/site01"


def no_network(parameters):
    raise AssertionError("Real visibility regression must run offline")


def test_real_inputs_analysis_and_launch_delay_compare_without_network():
    manifest = json.loads((FIXTURES / "manifest.json").read_text())
    for name, digest in manifest["sha256"].items():
        assert hashlib.sha256((FIXTURES / name).read_bytes()).hexdigest() == digest
    horizon = HorizonProfile(**json.loads((FIXTURES / "horizon.json").read_text()))
    assert len(horizon.points) == 1440
    assert horizon.parameters["max_radius_m"] == 150000
    assert all(point.coverage == "complete" for point in horizon.points)
    analyses = []
    for raw in json.loads((FIXTURES / "requests.json").read_text()):
        request = EphemerisRequest(**raw)
        series = HorizonsClient(
            FIXTURES / "ephemeris", transport=no_network
        ).get_ephemeris(request, offline=True)
        analysis = build_analysis(series, horizon)
        validate_document("analysis", analysis)
        assert analysis["provenance"]["data_kind"] == "cached_real"
        assert 0 < analysis["metrics"]["sunlight_hours"] < 336
        assert 0 < analysis["metrics"]["max_darkness_hours"] < 336
        assert (
            analysis["metrics"]["both_visible_hours"]
            <= analysis["metrics"]["earth_visible_hours"]
        )
        assert any(sample["sun"]["visible"] for sample in analysis["samples"])
        assert any(sample["sun"]["visible"] is False for sample in analysis["samples"])
        # Fully exposed/fully blocked samples must saturate the disc fraction.
        for sample in analysis["samples"]:
            sun = sample["sun"]
            clearance = sun["elevation_deg"] - sun["horizon_deg"]
            radius = sun["angular_diameter_deg"] / 2
            if clearance >= radius:
                assert sun["illumination_fraction"] == 1
            if clearance <= -radius:
                assert sun["illumination_fraction"] == 0
        analyses.append(analysis)
    result = calculate_luna_diff(*analyses)
    validate_document("diff", result)
    assert result["deltas"]["sunlight_hours"] < 0
    assert result["deltas"]["earth_visible_hours"] > 0
    assert any(
        item["type"] == "LOST_SUNLIGHT" for item in result["diagnostic_intervals"]
    )


def test_real_site_matches_horizon_observer():
    site = json.loads((FIXTURES / "site.json").read_text())
    validate_document("site", site)
    horizon = HorizonProfile(**json.loads((FIXTURES / "horizon.json").read_text()))
    assert site["coordinates"] == horizon.observer.model_dump(
        exclude={"site_id", "observer_height_m"}
    )


def test_real_offline_analysis_and_diff_commands(tmp_path):
    outputs = []
    root = Path(__file__).resolve().parents[2]
    for filename in ["request_nominal.json", "request_delay48h.json"]:
        output = tmp_path / filename
        subprocess.run(
            [
                sys.executable,
                "-m",
                "backend.engine.mission",
                "analyze",
                "--ephemeris",
                str(FIXTURES / filename),
                "--horizon",
                str(FIXTURES / "horizon.json"),
                "--cache-dir",
                str(FIXTURES / "ephemeris"),
                "--output",
                str(output),
            ],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
            timeout=30,
        )
        validate_document("analysis", json.loads(output.read_text()))
        outputs.append(output)
    output = tmp_path / "diff.json"
    subprocess.run(
        [
            sys.executable,
            "-m",
            "backend.engine.mission",
            "diff",
            "--scenario-a",
            str(outputs[0]),
            "--scenario-b",
            str(outputs[1]),
            "--output",
            str(output),
        ],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    result = json.loads(output.read_text())
    validate_document("diff", result)
    assert result["duration_hours"] == 336
