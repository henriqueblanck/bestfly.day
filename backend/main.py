"""FastAPI entrypoint."""
import uuid
import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import date
from decimal import Decimal
from typing import Any

import httpx
from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator

from config import settings
from engine.split_ticketing import SearchRequest, SplitTicketingEngine, PriceMatrix

log = logging.getLogger(__name__)

# ------------------------------------------------------------------ #
# In-memory job store (swap for Redis in prod)                        #
# ------------------------------------------------------------------ #

jobs: dict[str, dict[str, Any]] = {}

# Shared HTTP client (connection pool)
http_client: httpx.AsyncClient | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global http_client
    http_client = httpx.AsyncClient(
        headers={
            "Authorization": f"Bearer {settings.DUFFEL_API_TOKEN}",
            "Duffel-Version": "v2",
            "Content-Type": "application/json",
        },
        limits=httpx.Limits(max_connections=50, max_keepalive_connections=20),
        timeout=30.0,
    )
    yield
    await http_client.aclose()


app = FastAPI(title="Flight Price Matrix", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------ #
# Request / Response schemas                                          #
# ------------------------------------------------------------------ #

class SearchInput(BaseModel):
    origins: list[str]
    destinations: list[str]
    hubs: list[str] = ["MAD", "LIS"]
    date_from: date
    date_to: date
    max_connections: int = 1
    max_duration_hours: int = 20
    markup_percent: float = 0.0  # e.g. 5.0 = add 5%

    @field_validator("origins")
    @classmethod
    def max_two_origins(cls, v: list[str]) -> list[str]:
        if len(v) > 2:
            raise ValueError("Max 2 origins")
        return [x.upper() for x in v]

    @field_validator("destinations")
    @classmethod
    def max_ten_destinations(cls, v: list[str]) -> list[str]:
        if len(v) > 10:
            raise ValueError("Max 10 destinations")
        return [x.upper() for x in v]

    @field_validator("date_to")
    @classmethod
    def max_ten_day_range(cls, v: date, info) -> date:
        if "date_from" in info.data:
            if (v - info.data["date_from"]).days > 9:
                raise ValueError("Date range must be ≤ 10 days")
        return v


class JobResponse(BaseModel):
    job_id: str
    status: str
    matrix: dict | None = None
    error: str | None = None


# ------------------------------------------------------------------ #
# Background task                                                      #
# ------------------------------------------------------------------ #

async def _run_search(job_id: str, req: SearchInput):
    jobs[job_id]["status"] = "running"
    try:
        markup_fn = (
            (lambda p: p * Decimal(str(1 + req.markup_percent / 100)))
            if req.markup_percent
            else (lambda p: p)
        )
        engine = SplitTicketingEngine(http=http_client)
        search = SearchRequest(
            origins=req.origins,
            destinations=req.destinations,
            hubs=req.hubs,
            date_from=req.date_from,
            date_to=req.date_to,
            max_connections=req.max_connections,
            max_duration_hours=req.max_duration_hours,
            markup_fn=markup_fn,
        )
        matrix = await engine.compute(search)
        jobs[job_id]["status"] = "complete"
        jobs[job_id]["matrix"] = _serialize_matrix(matrix)
    except Exception as exc:  # noqa: BLE001
        log.exception("Search job %s failed", job_id)
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"] = str(exc)


def _serialize_matrix(matrix: PriceMatrix) -> dict:
    out: dict = {}
    for origin, dests in matrix.items():
        out[origin] = {}
        for dest, dates in dests.items():
            out[origin][dest] = {}
            for d_iso, entry in dates.items():
                out[origin][dest][d_iso] = {
                    "total_price": float(entry.total_price),
                    "longhaul_price": float(entry.longhaul_price),
                    "intraeu_price": float(entry.intraeu_price),
                    "hub": entry.hub,
                    "currency": entry.currency,
                    "longhaul_offer_id": entry.longhaul_offer_id,
                    "intraeu_offer_id": entry.intraeu_offer_id,
                }
    return out


# ------------------------------------------------------------------ #
# Routes                                                               #
# ------------------------------------------------------------------ #

@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/search", response_model=JobResponse, status_code=202)
async def start_search(body: SearchInput, background: BackgroundTasks):
    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "queued", "matrix": None, "error": None}
    background.add_task(_run_search, job_id, body)
    return JobResponse(job_id=job_id, status="queued")


@app.get("/api/search/{job_id}", response_model=JobResponse)
async def get_result(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobResponse(
        job_id=job_id,
        status=job["status"],
        matrix=job.get("matrix"),
        error=job.get("error"),
    )
