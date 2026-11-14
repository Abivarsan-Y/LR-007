# Member A — Phase 1 backend

FastAPI foundation for HORIZON OPS. Requires **Python 3.14**. The only application
endpoint in this phase is `GET /api/health`; astronomy and terrain integration
belong to later phases. No NASA service or dataset is needed to start the API.

## Install, run and test

Run these commands from the repository root. With [uv](https://docs.astral.sh/uv/):

```bash
uv python install 3.14
uv sync --project backend --extra dev --locked
uv run --project backend --locked python -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

In a second terminal at the repository root:

```bash
uv run --project backend --locked python -m pytest backend/tests/ -v
curl http://127.0.0.1:8000/api/health
```

Alternatively, with Python 3.14 and pip:

```bash
python3.14 -m venv backend/.venv
backend/.venv/bin/python -m pip install -e './backend[dev]'
backend/.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
backend/.venv/bin/python -m pytest backend/tests/ -v
```

The pip instructions apply the version ranges in `pyproject.toml`; the uv
instructions reproduce the exact dependency resolution in `uv.lock`.

OpenAPI documentation is available at `http://127.0.0.1:8000/docs` while running.
The app factory `create_app(settings)` allows tests or future deployments to
create separate instances with explicit configuration.

## Health contract

```json
{
  "status": "ok",
  "service": "lunar-navigator-api",
  "version": "0.1.0",
  "timestamp": "2026-11-14T00:00:00Z"
}
```

The timestamp above is illustrative; each request returns the current UTC time.
Responses use `Cache-Control: no-store`. `status` and `service` preserve the
connection check used by the unmerged `jahsan/lunar-mvp` frontend. A healthy
process does **not** assert that ephemerides, terrain, or analyses are ready.

## Browser configuration

Default CORS origins are `http://localhost:5173` and `http://127.0.0.1:5173`.
Only configured origins receive browser permission; cookie credentials are
disabled. Replace the defaults using a JSON array in the environment:

```bash
HORIZON_OPS_CORS_ORIGINS='["https://mission.example"]' uv run --project backend --locked python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Origins must include the scheme and optional port, without paths, trailing
slashes, credentials or wildcards. An empty array disables cross-origin access.
Environment variables are read when the app is created; `.env` files are not
loaded automatically. Same-origin requests through Vite's `/api` proxy do not
require CORS permission.

## Team handoff

- **C:** preserve the existing `/api` proxy target at `http://127.0.0.1:8000`, or
  configure a frontend origin using the setting above. The existing health check
  remains compatible; no frontend files were imported or changed.
- **D:** run `uv sync --project backend --extra dev --locked`, then
  `uv run --project backend --locked python -m pytest backend/tests/ -v` with
  Python 3.14. The backend dependency file is separate from D's root contract-test
  requirements. This phase does not modify D's schemas, fixtures or workflows.
- **B:** `backend/terrain/` and terrain-specific test files remain your workstream.
  `backend/engine/` is reserved for A's later science modules.

Health tests cover response compatibility, live UTC timestamps, allowed/rejected
CORS origins, and environment configuration. Scientific endpoints and their
shared request/response schemas are deliberately left for the agreed contracts.
