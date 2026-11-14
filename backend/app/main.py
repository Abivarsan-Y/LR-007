"""FastAPI entry point: run from the repository root with Uvicorn."""

from datetime import UTC, datetime

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware

from backend import __version__
from backend.app.config import Settings
from backend.app.schemas.health import HealthResponse


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings if settings is not None else Settings()
    application = FastAPI(
        title="HORIZON OPS API",
        version=__version__,
        description="Phase 1 backend foundation. Health reports API availability only.",
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(config.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    @application.get("/api/health", response_model=HealthResponse, tags=["health"])
    def health(response: Response) -> HealthResponse:
        """Check this API process; no terrain or ephemeris readiness is implied."""
        response.headers["Cache-Control"] = "no-store"
        return HealthResponse(version=__version__, timestamp=datetime.now(UTC))

    return application


app = create_app()
