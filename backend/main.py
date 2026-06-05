"""FastAPI entrypoint."""
import uuid
import asyncio
import logging
from datetime import date
from decimal import Decimal
from typing import Any

from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator

from config import settings
from engine.split_ticketing import SearchRequest, SplitTicketingEngine

log = logging.getLogger(__name__)

jobs: dict[str, dict[str, Any]] = {}

app = FastAPI(title="BestFly — Flight Price Matrix")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class SearchInput(BaseModel):
    origins: list[str]
    destinations: list[str]
    hubs: list[str] = ["MAD", "LIS"]
    date_from: date
    date_to: date
    max_connections: int = 1
    max_duration_hours: int = 20
    markup_percent: float = 0.0

    @field_validator("origins")
    @classmethod
    def max_two_origins(cls, v):
        if len(v) > 2:
            raise ValueError("Max 2 origins")
        return [x.upper() for x in v]

    @field_validator("destinations")
    @classmethod
    def max_five_destinations(cls, v):
        if len(v) > 5:
            raise ValueError("Max 5 destinations")
        return [x.upper() for x in v]

    @field_validator("date_to")
    @classmethod
    def combo_limit(cls, v, info):
        if "date_from" in info.data and "destinations" in info.data:
            days = (v - info.data["date_from"]).days + 1
            dests = len(info.data["destinations"])
            if days > 10:
                raise ValueError("Date range must be ≤ 10 days")
            if dests * days > 25:
                raise ValueError(f"destinations × days must be ≤ 25 (currently {dests} × {days} = {dests*days})")
        return v


class JobResponse(BaseModel):
    job_id: str
    status: str
    matrix: dict | None = None
    error: str | None = None


async def _run_search(job_id: str, req: SearchInput):
    jobs[job_id]["status"] = "running"
    try:
        markup_fn = (
            (lambda p: p * Decimal(str(1 + req.markup_percent / 100)))
            if req.markup_percent
            else (lambda p: p)
        )
        engine = SplitTicketingEngine()
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
    except Exception as exc:
        log.exception("Search job %s failed", job_id)
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"] = str(exc)


def _serialize_matrix(matrix) -> dict:
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
                    "longhaul_airline": entry.longhaul_airline,
                    "intraeu_airline": entry.intraeu_airline,
                    "longhaul_duration_minutes": entry.longhaul_duration_minutes,
                    "intraeu_duration_minutes": entry.intraeu_duration_minutes,
                }
    return out


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
