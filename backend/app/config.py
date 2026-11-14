"""Environment configuration shared by local and deployed API instances."""

from pathlib import Path
from urllib.parse import urlsplit

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]
SCIENCE_SITE01_DIR = REPO_ROOT / "backend/tests/fixtures/science/site01"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="HORIZON_OPS_", frozen=True)

    cors_origins: tuple[str, ...] = (
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    )
    sites_paths: tuple[Path, ...] = (
        REPO_ROOT / "data/cache/sites",
        SCIENCE_SITE01_DIR / "site.json",
    )
    horizon_paths: tuple[Path, ...] = (
        REPO_ROOT / "data/cache/horizons",
        SCIENCE_SITE01_DIR / "horizon.json",
    )
    ephemeris_cache_dirs: tuple[Path, ...] = (
        REPO_ROOT / "data/cache/ephemeris",
        SCIENCE_SITE01_DIR / "ephemeris",
        REPO_ROOT / "backend/tests/fixtures/horizons",
    )
    analyses_cache_dir: Path = REPO_ROOT / "data/cache/analyses"
    precomputed_analyses_paths: tuple[Path, ...] = (
        SCIENCE_SITE01_DIR / "analysis_nominal.json",
        SCIENCE_SITE01_DIR / "analysis_delay48h.json",
    )
    recommendations_paths: tuple[Path, ...] = (
        REPO_ROOT / "data/processed",
        REPO_ROOT / "data/cache/recommendations",
    )
    allow_live_horizons: bool = False

    @field_validator("cors_origins")
    @classmethod
    def validate_origins(cls, origins: tuple[str, ...]) -> tuple[str, ...]:
        for origin in origins:
            parsed = urlsplit(origin)
            if (
                parsed.scheme not in {"http", "https"}
                or not parsed.hostname
                or parsed.username is not None
                or parsed.password is not None
                or parsed.path
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError("CORS entries must be HTTP(S) origins without paths or credentials")
            # Accessing port also validates its format and range.
            _ = parsed.port
        return tuple(dict.fromkeys(origins))
