"""Exercise the public health response and browser integration boundary."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend import __version__
from backend.app.config import Settings
from backend.app.main import create_app


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("HORIZON_OPS_CORS_ORIGINS", raising=False)
    with TestClient(create_app()) as test_client:
        yield test_client


def test_health_preserves_starter_contract_and_adds_version_and_utc_time(client):
    before = datetime.now(UTC)
    response = client.get("/api/health")
    after = datetime.now(UTC)

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "lunar-navigator-api"
    assert body["version"] == __version__
    timestamp = datetime.fromisoformat(body["timestamp"])
    assert timestamp.utcoffset() == timedelta(0)
    assert before <= timestamp <= after


@pytest.mark.parametrize("origin", ["http://localhost:5173", "http://127.0.0.1:5173"])
def test_vite_origins_can_preflight_and_read_health(client, origin):
    preflight = client.options(
        "/api/health",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == origin

    response = client.get("/api/health", headers={"Origin": origin})
    assert response.headers["access-control-allow-origin"] == origin
    assert "access-control-allow-credentials" not in response.headers


def test_unconfigured_origin_does_not_receive_browser_permission(client):
    response = client.options(
        "/api/health",
        headers={
            "Origin": "https://unconfigured.example",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_environment_can_replace_development_origins(monkeypatch):
    monkeypatch.setenv("HORIZON_OPS_CORS_ORIGINS", '["https://mission.example"]')
    with TestClient(create_app()) as configured_client:
        allowed = configured_client.get(
            "/api/health", headers={"Origin": "https://mission.example"}
        )
        previous_default = configured_client.get(
            "/api/health", headers={"Origin": "http://localhost:5173"}
        )
    assert allowed.headers["access-control-allow-origin"] == "https://mission.example"
    assert "access-control-allow-origin" not in previous_default.headers


@pytest.mark.parametrize(
    "origin",
    ["*", "https://mission.example/path", "https://user:pass@mission.example", "http://localhost:99999"],
)
def test_invalid_cors_configuration_fails_early(origin):
    with pytest.raises(ValidationError):
        Settings(cors_origins=(origin,))
