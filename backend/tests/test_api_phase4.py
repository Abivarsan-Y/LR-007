"""Phase 4 FastAPI science endpoints, contract compliance and export verification."""

from __future__ import annotations

import copy
import csv
import io
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app
from backend.engine.ephemeris import HorizonsUnavailable, InvalidCache, InvalidResponse
from scripts.validate_fixtures import validate_document

SITE01_FIXTURES = Path(__file__).parent / "fixtures/science/site01"
HORIZONS_FIXTURES = Path(__file__).parent / "fixtures/horizons"


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("HORIZON_OPS_CORS_ORIGINS", raising=False)
    settings = Settings(
        sites_paths=(SITE01_FIXTURES / "site.json",),
        horizon_paths=(SITE01_FIXTURES / "horizon.json",),
        ephemeris_cache_dirs=(SITE01_FIXTURES / "ephemeris", HORIZONS_FIXTURES),
        analyses_cache_dir=SITE01_FIXTURES / "absent-analysis-cache",
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def assert_recorded_analysis(actual: dict, expected: dict) -> None:
    """Allow platform libm roundoff in disc area; compare every other field exactly."""
    normalized = copy.deepcopy(actual)
    for got, recorded in zip(normalized["samples"], expected["samples"], strict=True):
        value = recorded["sun"]["illumination_fraction"]
        if value is not None:
            assert got["sun"]["illumination_fraction"] == pytest.approx(value, abs=1e-14, rel=0)
            got["sun"]["illumination_fraction"] = value
    assert normalized == expected


def _nominal_analysis() -> dict:
    return json.loads((SITE01_FIXTURES / "analysis_nominal.json").read_text())


def _delay48h_analysis() -> dict:
    return json.loads((SITE01_FIXTURES / "analysis_delay48h.json").read_text())


def _delay48h_diff() -> dict:
    return json.loads((SITE01_FIXTURES / "diff_delay48h.json").read_text())


def test_get_sites_returns_only_contract_verified_sites(client: TestClient):
    response = client.get("/api/sites")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"

    sites = response.json()
    assert isinstance(sites, list)
    assert len(sites) >= 1
    for site in sites:
        validate_document("site", site)

    by_id = {site["site_id"]: site for site in sites}
    assert "nasa-site01-observation" in by_id
    assert by_id["nasa-site01-observation"] == json.loads(
        (SITE01_FIXTURES / "site.json").read_text()
    )

    filtered = client.get("/api/sites", params={"site_id": "nasa-site01-observation"})
    assert filtered.status_code == 200
    assert filtered.json() == [by_id["nasa-site01-observation"]]


def test_get_site_by_id_and_reject_legacy_unverified_id(client: TestClient):
    ok = client.get("/api/sites/nasa-site01-observation")
    assert ok.status_code == 200
    validate_document("site", ok.json())

    legacy = client.get("/api/sites/site01_connecting_ridge")
    assert legacy.status_code == 404
    assert "verified" in legacy.json()["detail"].lower()


def test_post_analyze_nominal_and_delay48h_offline_match_fixtures(client: TestClient):
    nominal_resp = client.post(
        "/api/analyze",
        json={
            "site_id": "nasa-site01-observation",
            "start_utc": "2026-11-15T00:00:00Z",
            "duration_hours": 336,
            "sample_minutes": 30,
            "observer_height_m": 2.0,
            "online": False,
        },
    )
    assert nominal_resp.status_code == 200
    nominal = nominal_resp.json()
    validate_document("analysis", nominal)
    expected_nominal = _nominal_analysis()
    assert_recorded_analysis(nominal, expected_nominal)
    assert nominal["provenance"]["data_kind"] == "cached_real"
    assert len(nominal["samples"]) == 673
    assert nominal["metrics"]["sunlight_hours"] == pytest.approx(249.06378983523817)
    assert nominal["metrics"]["earth_visible_hours"] == 246.5

    delay_resp = client.post(
        "/api/analyze",
        json={
            "site_id": "nasa-site01-observation",
            "start_utc": "2026-11-17T00:00:00Z",
            "duration_hours": 336,
            "sample_minutes": 30,
            "observer_height_m": 2.0,
            "online": False,
        },
    )
    assert delay_resp.status_code == 200
    delay = delay_resp.json()
    validate_document("analysis", delay)
    assert_recorded_analysis(delay, _delay48h_analysis())


def test_post_analyze_accepts_explicit_observer_and_slope(client: TestClient):
    site = json.loads((SITE01_FIXTURES / "site.json").read_text())
    response = client.post(
        "/api/analyze",
        json={
            "observer": {
                "site_id": site["site_id"],
                "observer_height_m": 2.0,
                **site["coordinates"],
            },
            "start_utc": "2026-11-15T00:00:00Z",
            "duration_hours": 336,
            "sample_minutes": 30,
            "slope_deg": 4.25,
        },
    )
    assert response.status_code == 200
    body = response.json()
    validate_document("analysis", body)
    assert body["slope"] == {"angle_deg": 4.25, "screening_status": "SAFE"}


def test_post_analyze_inline_synthetic_horizon_with_cached_dev_ephemeris(
    client: TestClient,
):
    response = client.post(
        "/api/analyze",
        json={
            "observer": {
                "site_id": "development-observer",
                "latitude_deg": -89,
                "longitude_deg": 0,
                "elevation_m": 0,
                "observer_height_m": 2,
            },
            "start_utc": "2026-11-15T00:00:00Z",
            "duration_hours": 336,
            "sample_minutes": 30,
            "horizon_profile": {
                "observer": {
                    "site_id": "development-observer",
                    "latitude_deg": -89,
                    "longitude_deg": 0,
                    "elevation_m": 0,
                    "observer_height_m": 2,
                },
                "points": [
                    {"azimuth_deg": 0, "elevation_deg": 0, "coverage": "complete"},
                    {"azimuth_deg": 90, "elevation_deg": 0, "coverage": "complete"},
                    {"azimuth_deg": 180, "elevation_deg": 0, "coverage": "complete"},
                    {"azimuth_deg": 270, "elevation_deg": 0, "coverage": "complete"},
                ],
                "provenance": {
                    "data_kind": "synthetic",
                    "model_version": "flat-test-horizon-v1",
                    "sources": [],
                    "assumptions": ["Synthetic flat horizon for integration test."],
                },
                "method": "flat-synthetic-test",
                "parameters": {},
            },
        },
    )
    assert response.status_code == 200
    body = response.json()
    validate_document("analysis", body)
    assert body["provenance"]["data_kind"] == "synthetic"
    assert len(body["samples"]) == 673


def test_post_analyze_offline_cache_miss_and_validation_errors(client: TestClient):
    uncached = client.post(
        "/api/analyze",
        json={
            "site_id": "nasa-site01-observation",
            "start_utc": "2026-12-01T00:00:00Z",
            "duration_hours": 336,
            "sample_minutes": 30,
            "online": False,
        },
    )
    assert uncached.status_code == 404

    live_disabled = client.post(
        "/api/analyze",
        json={
            "site_id": "nasa-site01-observation",
            "start_utc": "2026-12-01T00:00:00Z",
            "duration_hours": 336,
            "sample_minutes": 30,
            "online": True,
        },
    )
    assert live_disabled.status_code == 404
    assert "disabled" in live_disabled.json()["detail"].lower()

    missing_height = client.post(
        "/api/analyze",
        json={
            "site_id": "nasa-site01-observation",
            "start_utc": "2026-11-15T00:00:00Z",
            "observer_height_m": 5.0,
        },
    )
    assert missing_height.status_code == 404

    equatorial = client.post(
        "/api/analyze",
        json={
            "observer": {
                "site_id": "equator-bad",
                "latitude_deg": 10.0,
                "longitude_deg": 0.0,
                "elevation_m": 0.0,
            },
            "start_utc": "2026-11-15T00:00:00Z",
        },
    )
    assert equatorial.status_code == 422

    negative_duration = client.post(
        "/api/analyze",
        json={
            "site_id": "nasa-site01-observation",
            "start_utc": "2026-11-15T00:00:00Z",
            "duration_hours": -24,
        },
    )
    assert negative_duration.status_code == 422

    mismatched_observer = client.post(
        "/api/analyze",
        json={
            "site_id": "nasa-site01-observation",
            "observer": {
                "site_id": "nasa-site01-observation",
                "latitude_deg": -89.0,
                "longitude_deg": 0.0,
                "elevation_m": 0.0,
            },
            "start_utc": "2026-11-15T00:00:00Z",
        },
    )
    assert mismatched_observer.status_code == 422


@pytest.mark.parametrize(
    ("exc", "expected_status"),
    [
        (HorizonsUnavailable("upstream timeout"), 503),
        (InvalidResponse("bad ephemeris payload"), 502),
        (InvalidCache("corrupt sha256"), 422),
    ],
)
def test_post_analyze_maps_ephemeris_errors_to_http_status(
    monkeypatch: pytest.MonkeyPatch, exc: Exception, expected_status: int
):
    from backend.engine.ephemeris import HorizonsClient

    def boom(self, request, *, offline=False):
        raise exc

    monkeypatch.setattr(HorizonsClient, "get_ephemeris", boom)
    settings = Settings(
        sites_paths=(SITE01_FIXTURES / "site.json",),
        horizon_paths=(SITE01_FIXTURES / "horizon.json",),
        ephemeris_cache_dirs=(SITE01_FIXTURES / "ephemeris", HORIZONS_FIXTURES),
        analyses_cache_dir=SITE01_FIXTURES / "absent-analysis-cache",
    )
    with TestClient(create_app(settings)) as test_client:
        resp = test_client.post(
            "/api/analyze",
            json={
                "site_id": "nasa-site01-observation",
                "start_utc": "2026-11-15T00:00:00Z",
                "duration_hours": 336,
                "sample_minutes": 30,
            },
        )
    assert resp.status_code == expected_status
    assert str(exc) in resp.json()["detail"]


def test_post_diff_by_id_inline_requests_and_analysis_objects(client: TestClient):
    expected_diff = _delay48h_diff()
    nominal = _nominal_analysis()
    delay = _delay48h_analysis()

    by_id = client.post(
        "/api/diff",
        json={
            "scenario_a": nominal["analysis_id"],
            "scenario_b": delay["analysis_id"],
        },
    )
    assert by_id.status_code == 200
    body = by_id.json()
    validate_document("diff", body)
    assert body == expected_diff
    assert body["deltas"]["sunlight_hours"] == pytest.approx(-46.21115146930509)
    assert body["deltas"]["earth_visible_hours"] == 10.0
    assert len(body["diagnostic_intervals"]) == 6

    by_convenience_ids = client.post(
        "/api/diff",
        json={
            "scenario_a_id": nominal["analysis_id"],
            "scenario_b_id": delay["analysis_id"],
        },
    )
    assert by_convenience_ids.status_code == 200
    assert by_convenience_ids.json() == expected_diff

    by_inline_requests = client.post(
        "/api/diff",
        json={
            "scenario_a": {
                "site_id": "nasa-site01-observation",
                "start_utc": "2026-11-15T00:00:00Z",
                "duration_hours": 336,
                "sample_minutes": 30,
                "observer_height_m": 2.0,
            },
            "scenario_b": {
                "site_id": "nasa-site01-observation",
                "start_utc": "2026-11-17T00:00:00Z",
                "duration_hours": 336,
                "sample_minutes": 30,
                "observer_height_m": 2.0,
            },
        },
    )
    assert by_inline_requests.status_code == 200
    assert by_inline_requests.json() == expected_diff

    by_analysis_dicts = client.post(
        "/api/diff",
        json={"scenario_a": nominal, "scenario_b": delay},
    )
    assert by_analysis_dicts.status_code == 200
    assert by_analysis_dicts.json() == expected_diff


def test_post_diff_error_handling(client: TestClient):
    missing_id = client.post(
        "/api/diff",
        json={
            "scenario_a": "analysis-does-not-exist",
            "scenario_b": "analysis-bdfc2955855d1a12daf3cbec",
        },
    )
    assert missing_id.status_code == 404

    short_b = copy.deepcopy(_delay48h_analysis())
    short_b["samples"] = short_b["samples"][:-1]
    short_b["end_utc"] = short_b["samples"][-1]["utc"]
    mismatched_duration = client.post(
        "/api/diff",
        json={"scenario_a": _nominal_analysis(), "scenario_b": short_b},
    )
    assert mismatched_duration.status_code == 422

    malformed_inline = client.post(
        "/api/diff",
        json={
            "scenario_a": {"samples": [{"utc": "bad"}], "schema_version": "0.1.0"},
            "scenario_b": _nominal_analysis(),
        },
    )
    assert malformed_inline.status_code == 422


def test_post_recommend_honest_unavailable_and_configured_fixture(
    client: TestClient, tmp_path: Path
):
    unpopulated = client.post(
        "/api/recommend",
        json={
            "origin_site_id": "nasa-site01-observation",
            "search_radius_m": 500,
        },
    )
    assert unpopulated.status_code == 501
    assert "not available" in unpopulated.json()["detail"].lower()

    unknown_origin = client.post(
        "/api/recommend",
        json={"origin_site_id": "unknown-site", "search_radius_m": 500},
    )
    assert unknown_origin.status_code == 404

    site = json.loads((SITE01_FIXTURES / "site.json").read_text())
    rec_doc = {
        "schema_version": "0.1.0",
        "provenance": {
            "data_kind": "synthetic",
            "model_version": "test-recommender-v1",
            "sources": [],
            "assumptions": ["Synthetic recommendation fixture for API test."],
        },
        "origin_site_id": site["site_id"],
        "search_radius_m": 500,
        "candidates": [
            {
                "site_id": "candidate-north-120m",
                "coordinates": {
                    "latitude_deg": -89.459,
                    "longitude_deg": -137.5,
                    "elevation_m": 1948.5,
                    "frame": "MOON_ME_DE421",
                    "reference_radius_m": 1737400,
                },
                "distance_m": 120.0,
                "bearing_deg": 0.0,
                "slope_deg": 4.5,
                "sunlight_fraction_delta": 0.03,
            }
        ],
    }
    rec_path = tmp_path / "site01-rec.json"
    rec_path.write_text(json.dumps(rec_doc))

    configured = Settings(recommendations_paths=(rec_path,))
    with TestClient(create_app(configured)) as configured_client:
        ok = configured_client.post(
            "/api/recommend",
            json={"origin_site_id": site["site_id"], "search_radius_m": 500},
        )
    assert ok.status_code == 200
    validate_document("recommend", ok.json())
    assert ok.json() == rec_doc

    real_rec = client.post(
        "/api/recommend",
        json={
            "origin_site_id": "nasa-site01-observation",
            "search_radius_m": 1152.0,
        },
    )
    assert real_rec.status_code == 200
    real_body = real_rec.json()
    validate_document("recommend", real_body)
    assert real_body["origin_site_id"] == "nasa-site01-observation"
    assert len(real_body["candidates"]) == 3


def test_export_json_and_csv_get_and_post(client: TestClient):
    nominal = _nominal_analysis()
    analysis_id = nominal["analysis_id"]

    json_resp = client.get(
        "/api/export",
        params={"analysis_id": analysis_id, "format": "json"},
        headers={"Origin": "http://localhost:5173"},
    )
    assert json_resp.status_code == 200
    assert json_resp.headers["content-type"].startswith("application/json")
    assert (
        json_resp.headers["content-disposition"]
        == f'attachment; filename="{analysis_id}.json"'
    )
    assert json_resp.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert (
        "content-disposition"
        in json_resp.headers.get("access-control-expose-headers", "").lower()
    )
    exported_json = json.loads(json_resp.text)
    validate_document("analysis", exported_json)
    assert exported_json == nominal

    csv_resp = client.post(
        "/api/export",
        json={
            "site_id": "nasa-site01-observation",
            "start_utc": "2026-11-15T00:00:00Z",
            "duration_hours": 336,
            "sample_minutes": 30,
            "observer_height_m": 2.0,
            "format": "csv",
        },
    )
    assert csv_resp.status_code == 200
    assert csv_resp.headers["content-type"].startswith("text/csv")
    assert (
        csv_resp.headers["content-disposition"]
        == f'attachment; filename="{analysis_id}.csv"'
    )

    lines = csv_resp.text.splitlines()
    comment_lines = [line for line in lines if line.startswith("#")]
    data_lines = [line for line in lines if not line.startswith("#")]

    assert any(line == f"# analysis_id: {analysis_id}" for line in comment_lines)
    assert any(line == "# site_id: nasa-site01-observation" for line in comment_lines)
    assert any(line == "# provenance.data_kind: cached_real" for line in comment_lines)
    assert any(line.startswith("# source: jpl-horizons-sun:") for line in comment_lines)
    assert any(line.startswith("# assumption: ") for line in comment_lines)
    assert any(
        line.startswith("# metrics: sunlight_hours=249.06378983523817")
        for line in comment_lines
    )

    rows = list(csv.DictReader(io.StringIO("\n".join(data_lines))))
    assert len(rows) == 673
    assert rows[0]["utc"] == "2026-11-15T00:00:00Z"
    assert rows[0]["sun_visible"] == "true"
    assert rows[0]["earth_visible"] == "false"
    assert rows[-1]["utc"] == "2026-11-29T00:00:00Z"
    assert float(rows[-1]["met_hours"]) == 336.0

    inline_get_json = client.get(
        "/api/export",
        params={
            "site_id": "nasa-site01-observation",
            "start_utc": "2026-11-15T00:00:00Z",
            "format": "json",
        },
    )
    assert inline_get_json.status_code == 200
    assert_recorded_analysis(json.loads(inline_get_json.text), nominal)

    missing_target = client.get("/api/export", params={"format": "csv"})
    assert missing_target.status_code == 422

    preflight = client.options(
        "/api/analyze",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == "http://localhost:5173"
