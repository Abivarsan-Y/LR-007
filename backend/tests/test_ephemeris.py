"""Recorded-real parser, cache, transport and D-contract compatibility checks."""

import csv
import io
import json
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import HTTPError, URLError

import jsonschema
import pytest
from pydantic import ValidationError

from backend.engine import ephemeris as module
from backend.engine.ephemeris import (
    CacheMiss,
    EphemerisRequest,
    HorizonsClient,
    HorizonsUnavailable,
    InvalidCache,
    InvalidResponse,
    Observer,
    cache_key,
    fetch_horizons,
    parse_response,
    request_parameters,
)

REPOSITORY = Path(__file__).resolve().parents[2]
RECORDINGS = Path(__file__).parent / "fixtures" / "horizons"


@pytest.fixture
def request_spec():
    return EphemerisRequest(
        observer=Observer(
            site_id="development-observer",
            latitude_deg=-89,
            longitude_deg=0,
            elevation_m=0,
        ),
        start_utc="2026-11-15T00:00:00Z",
        duration_hours=336,
        sample_minutes=30,
    )


def recording(request, body):
    return json.loads((RECORDINGS / f"{cache_key(request, body)}.json").read_text())


def raw_response(request, body="sun"):
    return recording(request, body)["raw_response"].encode()


def parse(raw, request, body="sun"):
    return parse_response(
        raw, request, body, retrieved_utc=datetime.now(UTC), data_kind="cached_real"
    )


def no_network(parameters):
    pytest.fail("This test must not access the network")


def test_real_fourteen_day_recordings_and_unit_conversion(request_spec):
    sun = parse(raw_response(request_spec), request_spec)
    earth = parse(raw_response(request_spec, "earth"), request_spec, "earth")
    assert len(sun.positions) == len(earth.positions) == 673
    assert sun.positions[0].utc == request_spec.start_utc
    assert sun.positions[-1].utc == request_spec.end_utc
    assert sun.positions[0].azimuth_deg == pytest.approx(114.452763823)
    assert sun.positions[0].angular_diameter_deg == pytest.approx(1941.613 / 3600)
    assert sun.positions[0].range_km > 140_000_000
    assert 300_000 < earth.positions[0].range_km < 450_000
    assert 1.5 < earth.positions[0].angular_diameter_deg < 2.5
    assert "ME" in sun.source_header["Center pole/equ"]


def test_cylindrical_observer_uses_surface_plus_mast_height(request_spec):
    parameters = request_parameters(request_spec, "sun")
    _, equatorial_radius, polar_height = map(
        float, parameters["SITE_COORD"].strip("'").split(",")
    )
    assert (equatorial_radius**2 + polar_height**2) ** 0.5 == pytest.approx(1737.402)
    assert parameters["CENTER"] == "'coord@301'"
    assert parameters["COMMAND"] == "'10'"
    assert parameters["QUANTITIES"] == "'4,13,20'"
    assert parameters["ELEV_CUT"] == "'-90'"
    assert request_parameters(request_spec, "earth")["COMMAND"] == "'399'"


def test_equivalent_utc_offsets_have_identical_cache_identity(request_spec):
    same = EphemerisRequest(
        **{**request_spec.model_dump(), "start_utc": "2026-11-15T05:30:00+05:30"}
    )
    assert cache_key(same, "sun") == cache_key(request_spec, "sun")


@pytest.mark.parametrize(
    "field,value",
    [
        ("latitude_deg", -88),
        ("longitude_deg", 1),
        ("elevation_m", 1),
        ("observer_height_m", 5),
    ],
)
def test_cache_separates_observer_inputs(request_spec, field, value):
    values = request_spec.model_dump()
    values["observer"][field] = value
    changed = EphemerisRequest(**values)
    assert cache_key(changed, "sun") != cache_key(request_spec, "sun")


@pytest.mark.parametrize(
    "field,value",
    [
        ("sample_minutes", 60),
        ("duration_hours", 168),
        ("start_utc", "2026-11-16T00:00:00Z"),
    ],
)
def test_cache_separates_time_inputs(request_spec, field, value):
    changed = EphemerisRequest(**{**request_spec.model_dump(), field: value})
    assert cache_key(changed, "sun") != cache_key(request_spec, "sun")


@pytest.mark.parametrize(
    "changes",
    [
        {"start_utc": "2026-11-15T00:00:00"},
        {"start_utc": "2026-11-15T00:00:01Z"},
        {"start_utc": "1960-11-15T00:00:00Z"},
        {"duration_hours": 0},
        {"duration_hours": 673},
        {"sample_minutes": 0},
        {"duration_hours": 1, "sample_minutes": 7},
        {"sample_minutes": 1},
    ],
)
def test_invalid_request_windows_fail_before_fetch(request_spec, changes):
    with pytest.raises(ValidationError):
        EphemerisRequest(**{**request_spec.model_dump(), **changes})


@pytest.mark.parametrize(
    "changes",
    [
        {"latitude_deg": -90},
        {"longitude_deg": 222},
        {"elevation_m": float("nan")},
        {"observer_height_m": -1},
        {"frame": "MOON_PA"},
    ],
)
def test_invalid_observers_are_rejected(request_spec, changes):
    with pytest.raises(ValidationError):
        Observer(**{**request_spec.observer.model_dump(), **changes})


def mutate_result(request, transform):
    payload = json.loads(raw_response(request))
    payload["result"] = transform(payload["result"])
    return json.dumps(payload).encode()


@pytest.mark.parametrize(
    "transform",
    [
        lambda value: value.replace(
            "Target body name: Sun (10)", "Target body name: Mars (499)"
        ),
        lambda value: value.replace(
            "Center body name: Moon (301)", "Center body name: Earth (399)"
        ),
        lambda value: value.replace("$$SOE", "$$MISSING"),
        lambda value: value.replace("MEAN_ME (high precision)", "IAU_MOON"),
        lambda value: value.replace("Units: KM", "Units: AU"),
    ],
)
def test_wrong_target_frame_units_or_missing_table_is_rejected(request_spec, transform):
    with pytest.raises(InvalidResponse):
        parse(mutate_result(request_spec, transform), request_spec)


def test_wrong_observing_site_is_rejected(request_spec):
    values = request_spec.model_dump()
    values["observer"]["latitude_deg"] = -88
    with pytest.raises(InvalidResponse, match="different observing site"):
        parse(raw_response(request_spec), EphemerisRequest(**values))


@pytest.mark.parametrize("kind", ["missing", "duplicate", "unavailable", "nonfinite"])
def test_invalid_or_incomplete_table_is_rejected(request_spec, kind):
    def change(result):
        before, rest = result.split("$$SOE")
        table, after = rest.split("$$EOE")
        rows = list(csv.reader(line for line in table.splitlines() if line.strip()))
        if kind == "missing":
            rows.pop()
        elif kind == "duplicate":
            rows[1][0] = rows[0][0]
        else:
            rows[0][5] = "n.a." if kind == "unavailable" else "NaN"
        stream = io.StringIO()
        csv.writer(stream).writerows(rows)
        return before + "$$SOE\n" + stream.getvalue() + "$$EOE" + after

    with pytest.raises(InvalidResponse):
        parse(mutate_result(request_spec, change), request_spec)


def test_api_error_is_not_saved_or_substituted(request_spec, tmp_path):
    client = HorizonsClient(
        tmp_path, transport=lambda parameters: b'{"error":"Invalid query"}'
    )
    with pytest.raises(InvalidResponse):
        client.get_body(request_spec, "sun")
    assert list(tmp_path.iterdir()) == []


def test_malformed_signature_is_reported_as_invalid_response(request_spec):
    payload = json.loads(raw_response(request_spec))
    payload["signature"] = None
    with pytest.raises(InvalidResponse, match="source signature"):
        parse(json.dumps(payload).encode(), request_spec)


def test_fetch_then_offline_replay_preserves_real_samples_and_provenance(
    request_spec, tmp_path
):
    calls = []

    def transport(parameters):
        calls.append(parameters["COMMAND"])
        return raw_response(
            request_spec, "sun" if parameters["COMMAND"] == "'10'" else "earth"
        )

    live = HorizonsClient(tmp_path, transport=transport).get_ephemeris(request_spec)
    offline = HorizonsClient(tmp_path, transport=no_network).get_ephemeris(
        request_spec, offline=True
    )
    assert calls == ["'10'", "'399'"]
    assert live["provenance"]["data_kind"] == "live_real"
    assert offline["provenance"]["data_kind"] == "cached_real"
    assert live["samples"] == offline["samples"]
    assert live["provenance"]["sources"] == offline["provenance"]["sources"]
    assert len(list(tmp_path.iterdir())) == 2


def test_recorded_ephemeris_samples_match_d_schema_without_fabricating_visibility(
    request_spec,
):
    result = HorizonsClient(RECORDINGS, transport=no_network).get_ephemeris(
        request_spec, offline=True
    )
    schema = json.loads((REPOSITORY / "contracts" / "analysis.schema.json").read_text())
    jsonschema.Draft202012Validator(
        schema["properties"]["samples"], format_checker=jsonschema.FormatChecker()
    ).validate(result["samples"])
    jsonschema.Draft202012Validator(
        schema["properties"]["provenance"], format_checker=jsonschema.FormatChecker()
    ).validate(result["provenance"])
    assert all(
        sample["sun"]["visible"] is None
        and sample["earth"]["visible"] is None
        and sample["sun"]["illumination_fraction"] is None
        for sample in result["samples"]
    )


def test_offline_cache_miss_never_calls_network(request_spec, tmp_path):
    with pytest.raises(CacheMiss):
        HorizonsClient(tmp_path, transport=no_network).get_body(
            request_spec, "sun", offline=True
        )
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize(
    "damage", ["checksum", "identity", "json", "timestamp", "payload_type"]
)
def test_corrupt_cache_fails_closed_without_network(request_spec, tmp_path, damage):
    path = tmp_path / f"{cache_key(request_spec, 'sun')}.json"
    entry = recording(request_spec, "sun")
    if damage == "checksum":
        entry["raw_response"] += "corruption"
    elif damage == "identity":
        entry["request"]["observer"]["observer_height_m"] = 5
    elif damage == "timestamp":
        entry["retrieved_utc"] = "2026-11-14T00:00:00"
    elif damage == "payload_type":
        entry["raw_response"] = 123
    path.write_text("broken" if damage == "json" else json.dumps(entry))
    with pytest.raises(InvalidCache):
        HorizonsClient(tmp_path, transport=no_network).get_body(request_spec, "sun")


def test_atomic_write_failure_leaves_no_partial_cache(
    request_spec, tmp_path, monkeypatch
):
    def fail_replace(source, destination):
        raise OSError("simulated write failure")

    monkeypatch.setattr(module.os, "replace", fail_replace)
    with pytest.raises(OSError):
        HorizonsClient(
            tmp_path, transport=lambda parameters: raw_response(request_spec)
        ).get_body(request_spec, "sun")
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize(
    "failure",
    [
        URLError("unavailable"),
        HTTPError(module.API_URL, 429, "busy", {}, None),
        HTTPError(module.API_URL, 503, "busy", {}, None),
    ],
)
def test_transient_transport_errors_retry_with_bound(monkeypatch, failure):
    calls = []

    def fetch(*args, **kwargs):
        calls.append(1)
        if len(calls) < 3:
            raise failure
        return io.BytesIO(b"recorded response")

    monkeypatch.setattr(module, "urlopen", fetch)
    monkeypatch.setattr(module.time, "sleep", lambda delay: None)
    assert fetch_horizons({}, attempts=3) == b"recorded response"
    assert len(calls) == 3


def test_permanent_http_error_is_not_retried(monkeypatch):
    calls = []

    def fetch(*args, **kwargs):
        calls.append(1)
        raise HTTPError(module.API_URL, 400, "bad request", {}, None)

    monkeypatch.setattr(module, "urlopen", fetch)
    with pytest.raises(HorizonsUnavailable, match="400"):
        fetch_horizons({})
    assert len(calls) == 1


def test_transport_retries_stop_and_report_unavailable(monkeypatch):
    calls = []

    def fetch(*args, **kwargs):
        calls.append(1)
        raise URLError("unavailable")

    monkeypatch.setattr(module, "urlopen", fetch)
    monkeypatch.setattr(module.time, "sleep", lambda delay: None)
    with pytest.raises(HorizonsUnavailable, match="after 3 attempts"):
        fetch_horizons({})
    assert len(calls) == 3


def test_offline_cli_uses_real_recordings(request_spec, tmp_path):
    output = tmp_path / "ephemeris.json"
    run = subprocess.run(
        [
            sys.executable,
            "-m",
            "backend.engine.ephemeris",
            "--site-id",
            "development-observer",
            "--latitude",
            "-89",
            "--longitude",
            "0",
            "--elevation-m",
            "0",
            "--start-utc",
            "2026-11-15T00:00:00Z",
            "--duration-hours",
            "336",
            "--cache-dir",
            str(RECORDINGS),
            "--offline",
            "--output",
            str(output),
        ],
        cwd=REPOSITORY,
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    assert run.returncode == 0, run.stderr
    assert "673 paired samples (cached_real)" in run.stdout
    assert json.loads(output.read_text())["samples"][-1]["met_hours"] == 336
