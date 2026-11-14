"""Airless lunar-observer ephemerides, with verified real-response cache replay.

Horizons observer quantities 4, 13 and 20 provide apparent azimuth/elevation,
equatorial angular diameter (arcseconds), and apparent range (kilometres).
This module calculates no terrain visibility or landing-site safety.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import re
import tempfile
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

API_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"
CACHE_VERSION = "1"
TARGETS = {"sun": ("10", "Sun"), "earth": ("399", "Earth")}
Body = Literal["sun", "earth"]


class EphemerisError(Exception):
    """An unavailable or invalid ephemeris must not become invented data."""


class HorizonsUnavailable(EphemerisError):
    """A bounded upstream request failed."""


class InvalidResponse(EphemerisError):
    """The source response does not match the requested scientific inputs."""


class CacheMiss(EphemerisError):
    """No real recording exists for the exact offline request."""


class InvalidCache(EphemerisError):
    """A cache record is damaged or belongs to different inputs."""


class Observer(BaseModel):
    model_config = ConfigDict(
        frozen=True, extra="forbid", allow_inf_nan=False, validate_default=True
    )

    site_id: str = Field(min_length=1, max_length=100)
    latitude_deg: float = Field(gt=-90, lt=90)
    longitude_deg: float = Field(ge=-180, le=180)
    elevation_m: float
    observer_height_m: float = Field(default=2, ge=0)
    frame: Literal["MOON_ME_DE421"] = "MOON_ME_DE421"
    reference_radius_m: Literal[1737400] = 1737400

    @model_validator(mode="after")
    def positive_radius(self):
        if self.reference_radius_m + self.elevation_m + self.observer_height_m <= 0:
            raise ValueError("Observer radius must be positive")
        return self


class EphemerisRequest(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    observer: Observer
    start_utc: AwareDatetime
    duration_hours: int = Field(ge=1, le=672)
    sample_minutes: int = Field(default=30, ge=1, le=60)

    @field_validator("start_utc")
    @classmethod
    def utc_minute_boundary(cls, value: datetime) -> datetime:
        value = value.astimezone(UTC)
        if value.second or value.microsecond:
            raise ValueError("Start must be on a whole UTC minute")
        return value

    @model_validator(mode="after")
    def supported_window(self):
        if self.start_utc.year < 1972 or self.end_utc > datetime(
            2100, 1, 1, tzinfo=UTC
        ):
            raise ValueError("Supported UTC windows are 1972 through the start of 2100")
        if self.duration_hours * 60 % self.sample_minutes:
            raise ValueError(
                "Duration must contain a whole number of sampling intervals"
            )
        if self.sample_count > 10000:
            raise ValueError("At most 10,000 samples per body are supported")
        return self

    @property
    def end_utc(self) -> datetime:
        return self.start_utc + timedelta(hours=self.duration_hours)

    @property
    def sample_count(self) -> int:
        return self.duration_hours * 60 // self.sample_minutes + 1

    def times(self) -> list[datetime]:
        return [
            self.start_utc + timedelta(minutes=i * self.sample_minutes)
            for i in range(self.sample_count)
        ]


class Position(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)

    utc: AwareDatetime
    azimuth_deg: float = Field(ge=0, lt=360)
    elevation_deg: float = Field(ge=-90, le=90)
    angular_diameter_deg: float = Field(gt=0, le=180)
    range_km: float = Field(gt=0)


class BodySeries(BaseModel):
    model_config = ConfigDict(frozen=True)

    body: Body
    data_kind: Literal["cached_real", "live_real"]
    retrieved_utc: AwareDatetime
    raw_sha256: str
    request_parameters: dict[str, str]
    api_signature: dict[str, str]
    source_header: dict[str, str]
    positions: tuple[Position, ...]


def request_parameters(request: EphemerisRequest, body: Body) -> dict[str, str]:
    """Use cylindrical coordinates to preserve planetocentric lat/radial height."""
    observer = request.observer
    radius_km = (
        observer.reference_radius_m + observer.elevation_m + observer.observer_height_m
    ) / 1000
    latitude = math.radians(observer.latitude_deg)
    coordinates = f"{observer.longitude_deg:.12f},{radius_km * math.cos(latitude):.12f},{radius_km * math.sin(latitude):.12f}"
    values = {
        "COMMAND": TARGETS[body][0],
        "MAKE_EPHEM": "YES",
        "EPHEM_TYPE": "OBSERVER",
        "CENTER": "coord@301",
        "COORD_TYPE": "CYLINDRICAL",
        "SITE_COORD": coordinates,
        "START_TIME": request.start_utc.strftime("%Y-%m-%d %H:%M:%S"),
        "STOP_TIME": request.end_utc.strftime("%Y-%m-%d %H:%M:%S"),
        "STEP_SIZE": f"{request.sample_minutes} min",
        "QUANTITIES": "4,13,20",
        "CSV_FORMAT": "YES",
        "TIME_TYPE": "UT",
        "TIME_DIGITS": "SECONDS",
        "CAL_FORMAT": "CAL",
        "CAL_TYPE": "GREGORIAN",
        "RANGE_UNITS": "KM",
        "SUPPRESS_RANGE_RATE": "YES",
        "APPARENT": "AIRLESS",
        "ANG_FORMAT": "DEG",
        "EXTRA_PREC": "YES",
        "ELEV_CUT": "-90",
        "SKIP_DAYLT": "NO",
    }
    return {"format": "json", **{key: f"'{value}'" for key, value in values.items()}}


def cache_key(request: EphemerisRequest, body: Body) -> str:
    identity = {
        "cache_version": CACHE_VERSION,
        "request": request.model_dump(mode="json"),
        "body": body,
        "parameters": request_parameters(request, body),
    }
    return hashlib.sha256(
        json.dumps(identity, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def fetch_horizons(
    parameters: dict[str, str], *, timeout: float = 20, attempts: int = 3
) -> bytes:
    """Retry transport failures/429/5xx, but never retry malformed query results."""
    if not 1 <= attempts <= 5 or not math.isfinite(timeout) or timeout <= 0:
        raise ValueError("Use 1–5 attempts and a positive finite timeout")
    url = API_URL + "?" + urlencode(parameters)
    for attempt in range(attempts):
        try:
            with urlopen(
                Request(url, headers={"User-Agent": "HORIZON-OPS/0.1"}), timeout=timeout
            ) as response:
                raw = response.read(8 * 1024 * 1024 + 1)
            if len(raw) > 8 * 1024 * 1024:
                raise InvalidResponse("Horizons response exceeds the supported size")
            return raw
        except HTTPError as error:
            if error.code != 429 and error.code < 500:
                raise HorizonsUnavailable(
                    f"Horizons returned HTTP {error.code}"
                ) from error
            failure = error
        except (URLError, TimeoutError, ConnectionError) as error:
            failure = error
        if attempt + 1 < attempts:
            time.sleep(0.25 * 2**attempt)
    raise HorizonsUnavailable(
        f"Horizons unavailable after {attempts} attempts"
    ) from failure


def _source_header(
    result: str, request: EphemerisRequest, body: Body
) -> dict[str, str]:
    header = {}
    for key in [
        "Target body name",
        "Center body name",
        "Center geodetic",
        "Center pole/equ",
        "Center radii",
        "Atmos refraction",
    ]:
        match = re.search(r"^" + re.escape(key) + r"\s*:\s*(.+)$", result, re.MULTILINE)
        if not match:
            raise InvalidResponse(f"Missing Horizons metadata: {key}")
        header[key] = match.group(1).strip()
    target_id, target_name = TARGETS[body]
    if not re.match(
        re.escape(target_name) + rf"\s+\({target_id}\)", header["Target body name"]
    ):
        raise InvalidResponse("Horizons returned the wrong target")
    if not re.match(r"Moon\s+\(301\)", header["Center body name"]):
        raise InvalidResponse("Horizons returned the wrong observing body")
    if not header["Center pole/equ"].startswith(("MEAN_ME", "MOON_ME")):
        raise InvalidResponse("Expected the documented lunar mean-Earth orientation")
    if "AIRLESS" not in header["Atmos refraction"]:
        raise InvalidResponse("Expected airless apparent coordinates")
    if not re.match(r"1737\.4,\s*1737\.4,\s*1737\.4\s+km", header["Center radii"]):
        raise InvalidResponse("Unexpected lunar reference sphere")
    site = re.match(r"([^,]+),\s*([^,]+),\s*([^\s{]+)", header["Center geodetic"])
    if not site:
        raise InvalidResponse("Missing observing-site coordinates")
    longitude, latitude, altitude_km = map(float, site.groups())
    observer = request.observer
    longitude_error = (longitude - observer.longitude_deg + 180) % 360 - 180
    # Header coordinates are rounded, unlike the requested cylindrical inputs.
    if (
        not all(math.isfinite(value) for value in [longitude, latitude, altitude_km])
        or abs(longitude_error) > 1e-4
        or abs(latitude - observer.latitude_deg) > 1e-4
        or abs(altitude_km - (observer.elevation_m + observer.observer_height_m) / 1000)
        > 1e-3
    ):
        raise InvalidResponse("Horizons returned a different observing site")
    if not re.search(r"'delta,'\s*=.*?Units:\s*KM\b", result, re.DOTALL):
        raise InvalidResponse("Expected range in kilometres")
    if not re.search(r"'Ang-diam,'\s*=.*?Units:\s*ARCSECONDS\b", result, re.DOTALL):
        raise InvalidResponse("Expected angular diameter in arcseconds")
    return header


def parse_response(
    raw: bytes,
    request: EphemerisRequest,
    body: Body,
    *,
    retrieved_utc: datetime,
    data_kind: Literal["cached_real", "live_real"],
) -> BodySeries:
    """Reject missing/reordered timestamps and unavailable or non-finite numbers."""
    try:
        payload = json.loads(raw)
        if not isinstance(payload, dict) or payload.get("error"):
            raise InvalidResponse(
                "Horizons rejected the request or returned an invalid payload"
            )
        signature = payload["signature"]
        if (
            not isinstance(signature, dict)
            or signature.get("source") != "NASA/JPL Horizons API"
            or not signature.get("version")
        ):
            raise InvalidResponse("Unexpected source signature")
        result = payload["result"]
        source_header = _source_header(result, request, body)
        if result.count("$$SOE") != 1 or result.count("$$EOE") != 1:
            raise InvalidResponse("Expected exactly one Horizons observer table")
        preamble, table = result.split("$$SOE")
        table, _ = table.split("$$EOE")
        header_line = next(
            line
            for line in preamble.splitlines()
            if "Date__(UT)" in line and "Azimuth_(a-app)" in line
        )
        columns = [column.strip() for column in next(csv.reader([header_line]))]
        indices = [
            columns.index(label)
            for label in ["Azimuth_(a-app)", "Elevation_(a-app)", "Ang-diam", "delta"]
        ]
        rows = list(csv.reader(line for line in table.splitlines() if line.strip()))
        if len(rows) != request.sample_count:
            raise InvalidResponse(
                "Horizons sample count differs from the requested window"
            )
        positions = []
        months = {
            name: index
            for index, name in enumerate(
                [
                    "Jan",
                    "Feb",
                    "Mar",
                    "Apr",
                    "May",
                    "Jun",
                    "Jul",
                    "Aug",
                    "Sep",
                    "Oct",
                    "Nov",
                    "Dec",
                ],
                1,
            )
        }
        for row, expected in zip(rows, request.times(), strict=True):
            if len(row) != len(columns):
                raise InvalidResponse("Unexpected Horizons CSV row shape")
            match = re.fullmatch(
                r"\s*(\d{4})-([A-Z][a-z]{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\s*", row[0]
            )
            if not match:
                raise InvalidResponse("Unexpected UTC timestamp format")
            year, month, day, hour, minute, second = match.groups()
            utc = datetime(
                int(year),
                months[month],
                int(day),
                int(hour),
                int(minute),
                int(second),
                tzinfo=UTC,
            )
            if utc != expected:
                raise InvalidResponse(
                    "Horizons timestamps do not match the requested UTC grid"
                )
            azimuth, elevation, diameter_arcsec, range_km = [
                float(row[index]) for index in indices
            ]
            if not math.isfinite(azimuth) or not 0 <= azimuth <= 360:
                raise InvalidResponse("Invalid azimuth")
            positions.append(
                Position(
                    utc=utc,
                    azimuth_deg=azimuth % 360,
                    elevation_deg=elevation,
                    angular_diameter_deg=diameter_arcsec / 3600,
                    range_km=range_km,
                )
            )
        return BodySeries(
            body=body,
            data_kind=data_kind,
            retrieved_utc=retrieved_utc,
            raw_sha256=hashlib.sha256(raw).hexdigest(),
            request_parameters=request_parameters(request, body),
            api_signature=signature,
            source_header=source_header,
            positions=tuple(positions),
        )
    except InvalidResponse:
        raise
    except (KeyError, IndexError, TypeError, ValueError, StopIteration) as error:
        raise InvalidResponse(
            "Malformed or unavailable Horizons observer data"
        ) from error


class HorizonsClient:
    def __init__(
        self,
        cache_dir: Path | str = "data/cache/ephemeris",
        *,
        transport: Callable[[dict[str, str]], bytes] = fetch_horizons,
    ):
        self.cache_dir = Path(cache_dir)
        self.transport = transport

    def get_body(
        self, request: EphemerisRequest, body: Body, *, offline: bool = False
    ) -> BodySeries:
        if body not in TARGETS:
            raise ValueError("Only Sun and Earth ephemerides are supported")
        key = cache_key(request, body)
        path = self.cache_dir / f"{key}.json"
        if path.exists():
            try:
                record = json.loads(path.read_text(encoding="utf-8"))
                if (
                    record["cache_version"] != CACHE_VERSION
                    or record["cache_key"] != key
                    or record["request"] != request.model_dump(mode="json")
                    or record["body"] != body
                ):
                    raise InvalidCache("Cache identity does not match the request")
                if not isinstance(record["raw_response"], str) or not isinstance(
                    record["retrieved_utc"], str
                ):
                    raise InvalidCache("Invalid cache payload or acquisition time")
                raw = record["raw_response"].encode("utf-8")
                if hashlib.sha256(raw).hexdigest() != record["raw_sha256"]:
                    raise InvalidCache("Cached response checksum mismatch")
                retrieved = datetime.fromisoformat(record["retrieved_utc"])
                if retrieved.tzinfo is None:
                    raise InvalidCache("Cached acquisition time must have a timezone")
                return parse_response(
                    raw, request, body, retrieved_utc=retrieved, data_kind="cached_real"
                )
            except InvalidCache:
                raise
            except (OSError, KeyError, TypeError, ValueError, EphemerisError) as error:
                raise InvalidCache(
                    "Cannot validate cached real ephemeris; remove the damaged record to refetch"
                ) from error
        if offline:
            raise CacheMiss(f"No real offline cache for {body}: {key}")
        raw = self.transport(request_parameters(request, body))
        retrieved = datetime.now(UTC)
        series = parse_response(
            raw, request, body, retrieved_utc=retrieved, data_kind="live_real"
        )
        record = {
            "cache_version": CACHE_VERSION,
            "cache_key": key,
            "request": request.model_dump(mode="json"),
            "body": body,
            "retrieved_utc": retrieved.isoformat().replace("+00:00", "Z"),
            "raw_sha256": series.raw_sha256,
            "raw_response": raw.decode("utf-8"),
        }
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=self.cache_dir, delete=False
        ) as handle:
            temporary = Path(handle.name)
            try:
                json.dump(record, handle, indent=2, allow_nan=False)
                handle.write("\n")
                handle.close()
                os.replace(temporary, path)
            finally:
                temporary.unlink(missing_ok=True)
        return series

    def get_ephemeris(
        self, request: EphemerisRequest, *, offline: bool = False
    ) -> dict:
        bodies = {
            body: self.get_body(request, body, offline=offline) for body in TARGETS
        }
        samples = []
        for index, utc in enumerate(request.times()):
            sample = {
                "utc": utc.isoformat().replace("+00:00", "Z"),
                "met_hours": (utc - request.start_utc).total_seconds() / 3600,
            }
            for body, series in bodies.items():
                position = series.positions[index]
                sample[body] = {
                    field: getattr(position, field)
                    for field in [
                        "azimuth_deg",
                        "elevation_deg",
                        "angular_diameter_deg",
                    ]
                }
                sample[body].update(horizon_deg=None, visible=None)
                if body == "sun":
                    sample[body]["illumination_fraction"] = None
            samples.append(sample)
        return {
            "request": request.model_dump(mode="json"),
            "provenance": {
                "data_kind": "cached_real"
                if all(series.data_kind == "cached_real" for series in bodies.values())
                else "live_real",
                "model_version": "horizons-observer-v1",
                "sources": [
                    {
                        "id": f"jpl-horizons-{body}",
                        "uri": API_URL + "?" + urlencode(series.request_parameters),
                        "sha256": series.raw_sha256,
                    }
                    for body, series in bodies.items()
                ],
                "assumptions": [
                    "Airless apparent body-centre positions; angular diameter is the equatorial full-disc width.",
                    "Input latitude is planetocentric; radial elevation uses a 1737400 m sphere in MOON_ME_DE421.",
                    "Horizons documents lunar mean-Earth orientation relative to DE421; actual source headers are retained.",
                    "Terrain visibility, illumination fraction and site safety have not been calculated.",
                    "Future UTC uses Horizons' current leap-second assumptions; cached acquisitions are not automatically refreshed.",
                ],
            },
            "sources": {
                body: series.model_dump(mode="json", exclude={"positions"})
                for body, series in bodies.items()
            },
            "ranges_km": {
                body: [position.range_km for position in series.positions]
                for body, series in bodies.items()
            },
            "samples": samples,
        }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site-id", required=True)
    parser.add_argument("--latitude", type=float, required=True)
    parser.add_argument("--longitude", type=float, required=True)
    parser.add_argument("--elevation-m", type=float, required=True)
    parser.add_argument("--observer-height-m", type=float, default=2)
    parser.add_argument("--start-utc", required=True)
    parser.add_argument("--duration-hours", type=int, default=336)
    parser.add_argument("--sample-minutes", type=int, default=30)
    parser.add_argument("--cache-dir", type=Path, default=Path("data/cache/ephemeris"))
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        request = EphemerisRequest(
            observer=Observer(
                site_id=args.site_id,
                latitude_deg=args.latitude,
                longitude_deg=args.longitude,
                elevation_m=args.elevation_m,
                observer_height_m=args.observer_height_m,
            ),
            start_utc=args.start_utc,
            duration_hours=args.duration_hours,
            sample_minutes=args.sample_minutes,
        )
        result = HorizonsClient(args.cache_dir).get_ephemeris(
            request, offline=args.offline
        )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8"
        )
        print(
            f"Wrote {len(result['samples'])} paired samples ({result['provenance']['data_kind']}) to {args.output}"
        )
    except (ValueError, EphemerisError, OSError) as error:
        parser.exit(1, f"Ephemeris unavailable: {error}\n")


if __name__ == "__main__":
    main()
