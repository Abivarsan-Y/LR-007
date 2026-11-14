"""Health contract, compatible with the existing starter's connection check."""

from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict


class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok"] = "ok"
    service: Literal["lunar-navigator-api"] = "lunar-navigator-api"
    version: str
    timestamp: AwareDatetime
