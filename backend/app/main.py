"""FastAPI entry point: run from the repository root with Uvicorn."""

from datetime import UTC, datetime
from typing import Any

from fastapi import FastAPI, Query, Response
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from backend import __version__
from backend.app.config import Settings
from backend.app.schemas.health import HealthResponse
from backend.app.schemas.science import (
    AnalyzeScenarioRequest,
    DiffRequest,
    ExportFormat,
    ExportRequest,
    RecommendRequest,
)
from backend.app.services import (
    RecommendationUnavailableError,
    ResourceNotFoundError,
    ScienceService,
)
from backend.engine.ephemeris import (
    CacheMiss,
    HorizonsUnavailable,
    InvalidCache,
    InvalidResponse,
)


def _error_response(status_code: int, detail: Any) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"detail": detail})


def _register_exception_handlers(application: FastAPI) -> None:
    @application.exception_handler(ResourceNotFoundError)
    async def handle_not_found(_request: Any, exc: ResourceNotFoundError) -> JSONResponse:
        return _error_response(404, str(exc))

    @application.exception_handler(CacheMiss)
    async def handle_cache_miss(_request: Any, exc: CacheMiss) -> JSONResponse:
        return _error_response(404, str(exc))

    @application.exception_handler(RecommendationUnavailableError)
    async def handle_recommend_unavailable(
        _request: Any, exc: RecommendationUnavailableError
    ) -> JSONResponse:
        return _error_response(501, str(exc))

    @application.exception_handler(InvalidCache)
    async def handle_invalid_cache(_request: Any, exc: InvalidCache) -> JSONResponse:
        return _error_response(422, str(exc))

    @application.exception_handler(InvalidResponse)
    async def handle_invalid_response(_request: Any, exc: InvalidResponse) -> JSONResponse:
        return _error_response(502, str(exc))

    @application.exception_handler(HorizonsUnavailable)
    async def handle_horizons_unavailable(
        _request: Any, exc: HorizonsUnavailable
    ) -> JSONResponse:
        return _error_response(503, str(exc))

    @application.exception_handler(ValidationError)
    async def handle_validation_error(_request: Any, exc: ValidationError) -> JSONResponse:
        return _error_response(422, jsonable_encoder(exc.errors()))

    @application.exception_handler(ValueError)
    async def handle_value_error(_request: Any, exc: ValueError) -> JSONResponse:
        return _error_response(422, str(exc))


def _build_export_response(service: ScienceService, request: ExportRequest) -> Response:
    analysis = service.resolve_export_analysis(request)
    content, media_type, filename = service.export_payload(analysis, request.format)
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings if settings is not None else Settings()
    service = ScienceService(config)

    application = FastAPI(
        title="HORIZON OPS API",
        version=__version__,
        description=(
            "Lunar south-polar illumination, Earth-visibility, LunaDiff comparison, "
            "and reproducible mission telemetry export API."
        ),
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(config.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
        expose_headers=["Content-Disposition"],
    )
    _register_exception_handlers(application)

    @application.get("/api/health", response_model=HealthResponse, tags=["health"])
    def health(response: Response) -> HealthResponse:
        """Check this API process; no terrain or ephemeris readiness is implied."""
        response.headers["Cache-Control"] = "no-store"
        return HealthResponse(version=__version__, timestamp=datetime.now(UTC))

    @application.get("/api/sites", tags=["sites"])
    def list_sites(
        response: Response, site_id: str | None = None
    ) -> list[dict[str, Any]]:
        """Return contract-verified lunar south-polar sites."""
        response.headers["Cache-Control"] = "no-store"
        return service.list_sites(site_id=site_id)

    @application.get("/api/sites/{site_id}", tags=["sites"])
    def get_site(site_id: str, response: Response) -> dict[str, Any]:
        """Return a single contract-verified lunar south-polar site."""
        response.headers["Cache-Control"] = "no-store"
        return service.get_site(site_id)

    @application.post("/api/analyze", tags=["science"])
    def analyze(
        payload: AnalyzeScenarioRequest, response: Response
    ) -> dict[str, Any]:
        """Run terrain-aware Sun/Earth visibility and mission metrics for a scenario."""
        response.headers["Cache-Control"] = "no-store"
        return service.run_analysis(payload)

    @application.post("/api/diff", tags=["science"])
    def diff(payload: DiffRequest, response: Response) -> dict[str, Any]:
        """Compare two scenarios on mission elapsed time via LunaDiff."""
        response.headers["Cache-Control"] = "no-store"
        return service.run_diff(payload)

    @application.post("/api/recommend", tags=["science"])
    def recommend(
        payload: RecommendRequest, response: Response
    ) -> dict[str, Any]:
        """Return verified nearby DEM landing candidates, or 501 if unpopulated."""
        response.headers["Cache-Control"] = "no-store"
        return service.run_recommend(payload)

    @application.get("/api/export", tags=["export"])
    def export_get(
        analysis_id: str | None = None,
        site_id: str | None = None,
        start_utc: datetime | None = None,
        duration_hours: int = 336,
        sample_minutes: int = 30,
        observer_height_m: float = 2.0,
        slope_deg: float | None = None,
        online: bool = False,
        export_format: ExportFormat = Query(default="json", alias="format"),
    ) -> Response:
        """Export an analyzed scenario as downloadable JSON or metadata-headered CSV."""
        request = ExportRequest(
            analysis_id=analysis_id,
            site_id=site_id,
            start_utc=start_utc,
            duration_hours=duration_hours,
            sample_minutes=sample_minutes,
            observer_height_m=observer_height_m,
            slope_deg=slope_deg,
            online=online,
            format=export_format,
        )
        return _build_export_response(service, request)

    @application.post("/api/export", tags=["export"])
    def export_post(payload: ExportRequest) -> Response:
        """Export an analyzed scenario from POST parameters as JSON or CSV."""
        return _build_export_response(service, payload)

    return application


app = create_app()
