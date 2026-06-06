"""FastAPI entrypoint."""
import uuid
import asyncio
import logging
import time
from datetime import date
from decimal import Decimal
from typing import Any, Literal

from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator, model_validator

from config import settings
from engine.split_ticketing import SearchRequest, SplitTicketingEngine
import db

log = logging.getLogger(__name__)

jobs: dict[str, dict[str, Any]] = {}
_JOB_TTL_SECONDS = 3600

# Candidate pool — engine probes all of these and picks the best for each search
HUB_CANDIDATES = [
    # Europe — primary transatlantic hubs
    "MAD", "LIS", "CDG", "FRA", "LHR", "AMS", "MUC", "FCO", "ZRH",
    # Europe — secondary
    "BCN", "VIE", "BRU", "DUB", "IST", "ATH",
    # Middle East — strong global hubs
    "DOH", "DXB", "AUH",
    # North America — Air Canada / alliance connections (YUL/YYZ cheaper than direct)
    "YUL", "YYZ", "JFK", "ORD",
    # Latin America / Caribbean — non-obvious intermediate connections
    "MEX", "PTY", "BOG", "MIA",
    # Africa
    "ADD",
]

MAX_SEARCHES = 200

app = FastAPI(title="BestFly — Flight Price Matrix")


@app.on_event("startup")
async def startup():
    db.init_db()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class SearchInput(BaseModel):
    origins: list[str]
    destinations: list[str]
    date_from: date
    date_to: date
    trip_type: Literal["oneway", "roundtrip"] = "oneway"
    return_date_from: date | None = None
    return_date_to: date | None = None
    max_connections: int = 1
    max_duration_hours: int = 36
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

    @model_validator(mode="after")
    def combo_limit(self):
        C = len(HUB_CANDIDATES)
        origins = len(self.origins)
        dests = len(self.destinations)

        out_days = (self.date_to - self.date_from).days + 1
        if out_days > 10:
            raise ValueError("Date range must be ≤ 10 days")

        ret_days = 0
        if self.trip_type == "roundtrip":
            if self.return_date_from is None:
                raise ValueError("return_date_from is required for roundtrip")
            ret_end = self.return_date_to or self.return_date_from
            ret_days = (ret_end - self.return_date_from).days + 1
            if ret_days > 10:
                raise ValueError("Return date range must be ≤ 10 days")

        total_days = out_days + ret_days
        # Phase 1 probe (1 day × all candidates × origins) + direct + phase 2 (estimated with top_k=5)
        probe = origins * C
        direct = origins * dests * total_days
        phase2_per_hub = (origins + dests) * total_days
        top_k = max(2, min(6, (MAX_SEARCHES - probe - direct) // phase2_per_hub)) if phase2_per_hub > 0 else 2
        estimated = probe + direct + top_k * phase2_per_hub
        if estimated > MAX_SEARCHES:
            raise ValueError(
                f"Total de buscas estimado ({estimated}) excede {MAX_SEARCHES}. "
                f"Reduza destinos ou janela de datas."
            )
        return self


class JobResponse(BaseModel):
    job_id: str
    status: str
    matrix: dict | None = None
    return_matrix: dict | None = None
    logs: list[str] = []
    error: str | None = None


async def _run_search(job_id: str, req: SearchInput):
    jobs[job_id]["status"] = "running"
    try:
        markup_fn = (
            (lambda p: p * Decimal(str(1 + req.markup_percent / 100)))
            if req.markup_percent
            else (lambda p: p)
        )

        def on_log(msg: str):
            jobs[job_id]["logs"].append(msg)

        def on_partial(partial_matrix):
            serialized = _serialize_matrix(partial_matrix)
            if serialized:
                jobs[job_id]["matrix"] = serialized

        engine = SplitTicketingEngine(log_fn=on_log, partial_fn=on_partial)

        # Compute top_k from budget
        C = len(HUB_CANDIDATES)
        out_days = (req.date_to - req.date_from).days + 1
        ret_days = 0
        if req.trip_type == "roundtrip" and req.return_date_from:
            ret_end = req.return_date_to or req.return_date_from
            ret_days = (ret_end - req.return_date_from).days + 1
        total_days = out_days + ret_days
        origins = len(req.origins)
        dests = len(req.destinations)
        probe = origins * C
        direct = origins * dests * total_days
        phase2_per_hub = (origins + dests) * total_days
        top_k = max(2, min(6, (MAX_SEARCHES - probe - direct) // phase2_per_hub)) if phase2_per_hub > 0 else 2

        # ── Outbound ──
        outbound = SearchRequest(
            origins=req.origins,
            destinations=req.destinations,
            hub_candidates=HUB_CANDIDATES,
            date_from=req.date_from,
            date_to=req.date_to,
            max_connections=req.max_connections,
            max_duration_hours=req.max_duration_hours,
            top_k_hubs=top_k,
            markup_fn=markup_fn,
        )
        matrix = await engine.compute(outbound)
        jobs[job_id]["matrix"] = _serialize_matrix(matrix)

        # ── Return (roundtrip) ──
        if req.trip_type == "roundtrip" and req.return_date_from:
            on_log("[volta] iniciando busca de retorno…")
            ret_end = req.return_date_to or req.return_date_from
            ret_engine = SplitTicketingEngine(log_fn=on_log, partial_fn=None)
            return_req = SearchRequest(
                origins=req.destinations,   # flipped
                destinations=req.origins,   # flipped
                hub_candidates=HUB_CANDIDATES,
                date_from=req.return_date_from,
                date_to=ret_end,
                max_connections=req.max_connections,
                max_duration_hours=req.max_duration_hours,
                top_k_hubs=top_k,
                markup_fn=markup_fn,
            )
            return_matrix = await ret_engine.compute(return_req)
            jobs[job_id]["return_matrix"] = _serialize_matrix(return_matrix)

        jobs[job_id]["status"] = "complete"
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
                    "longhaul_departure_time": entry.longhaul_departure_time,
                    "intraeu_departure_time": entry.intraeu_departure_time,
                    "longhaul_connections": entry.longhaul_connections,
                    "intraeu_connections": entry.intraeu_connections,
                    "direct_price": float(entry.direct_price) if entry.direct_price is not None else None,
                    "direct_airline": entry.direct_airline,
                    "direct_duration_minutes": entry.direct_duration_minutes,
                    "direct_connections": entry.direct_connections,
                    "direct_departure_time": entry.direct_departure_time,
                }
    return out


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/hubs")
async def get_hubs():
    return {"candidates": HUB_CANDIDATES, "count": len(HUB_CANDIDATES)}


@app.get("/api/history")
async def price_history(origin: str, destination: str, flight_date: str, days_back: int = 30):
    from datetime import date as DateType
    try:
        d = DateType.fromisoformat(flight_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format, use YYYY-MM-DD")
    rows = await asyncio.to_thread(db.price_history, origin, destination, d, days_back)
    return {"origin": origin, "destination": destination, "flight_date": flight_date, "history": rows}


_HUB_CANDIDATES = [
    "MAD", "LIS", "CDG", "AMS", "FRA", "MUC", "LHR", "FCO", "MXP", "ZRH",
    "BCN", "ORY", "LGW", "DUS", "HAM", "BER", "VIE", "BRU", "DUB",
    "CPH", "ARN", "OSL", "HEL", "ATH", "WAW", "PRG", "BUD",
    "IST", "DXB", "DOH", "AUH",
    "ADD", "NBO", "JNB",
    "MEX", "BOG", "PTY", "EZE", "SCL", "LIM",
]


@app.get("/api/debug/hubs")
async def discover_hubs(origin: str = "GRU", date: str | None = None):
    """Test which hub candidates have flights from origin via fli."""
    from datetime import date as DateType, timedelta
    from fli.models import Airport, FlightSearchFilters, FlightSegment, MaxStops, PassengerInfo, TripType
    from fli.search.flights import SearchFlights

    test_date = DateType.fromisoformat(date) if date else DateType.today() + timedelta(days=30)

    async def test_hub(hub: str) -> dict:
        try:
            Airport[origin]
            Airport[hub]
        except KeyError as e:
            return {"hub": hub, "status": "unknown_iata", "detail": str(e)}

        def _search():
            try:
                searcher = SearchFlights()
                filters = FlightSearchFilters(
                    trip_type=TripType.ONE_WAY,
                    passenger_info=PassengerInfo(adults=1),
                    flight_segments=[FlightSegment(
                        departure_airport=[[Airport[origin], 0]],
                        arrival_airport=[[Airport[hub], 0]],
                        travel_date=test_date.isoformat(),
                        max_stops=MaxStops.ONE_STOP_OR_FEWER,
                    )],
                )
                results = searcher.search(filters, top_n=3, currency="BRL")
                if not results:
                    return {"hub": hub, "status": "no_results"}
                best = min(results, key=lambda r: r.price or float("inf"))
                airline = best.legs[0].airline.value if best.legs and best.legs[0].airline else "?"
                return {
                    "hub": hub,
                    "status": "ok",
                    "price_brl": best.price,
                    "duration_min": best.duration,
                    "stops": best.stops,
                    "airline": airline,
                }
            except Exception as e:
                return {"hub": hub, "status": "error", "detail": str(e)}

        return await asyncio.to_thread(_search)

    sem = asyncio.Semaphore(4)

    async def throttled(hub):
        async with sem:
            result = await test_hub(hub)
            await asyncio.sleep(1.0)
            return result

    results = await asyncio.gather(*[throttled(h) for h in _HUB_CANDIDATES])
    ok = [r for r in results if r["status"] == "ok"]
    other = [r for r in results if r["status"] != "ok"]
    ok.sort(key=lambda r: r.get("price_brl") or float("inf"))

    return {
        "origin": origin,
        "date": test_date.isoformat(),
        "internal_hubs": INTERNAL_HUBS,
        "found": len(ok),
        "hubs_with_flights": ok,
        "hubs_no_results": other,
    }


@app.get("/api/debug/fli")
async def debug_fli(origin: str = "GRU", destination: str = "MAD", date: str | None = None):
    """Quick diagnostic: test fli for one route."""
    from datetime import date as DateType, timedelta
    from fli.models import Airport, FlightSearchFilters, FlightSegment, MaxStops, PassengerInfo, TripType
    from fli.search.flights import SearchFlights

    test_date = DateType.fromisoformat(date) if date else DateType.today() + timedelta(days=30)

    try:
        origin_ap = Airport[origin]
    except KeyError:
        return {"ok": False, "error": f"Airport enum missing: {origin}"}
    try:
        dest_ap = Airport[destination]
    except KeyError:
        return {"ok": False, "error": f"Airport enum missing: {destination}"}

    def _test():
        searcher = SearchFlights()
        filters = FlightSearchFilters(
            trip_type=TripType.ONE_WAY,
            passenger_info=PassengerInfo(adults=1),
            flight_segments=[FlightSegment(
                departure_airport=[[origin_ap, 0]],
                arrival_airport=[[dest_ap, 0]],
                travel_date=test_date.isoformat(),
                max_stops=MaxStops.ONE_STOP_OR_FEWER,
            )],
        )
        try:
            results = searcher.search(filters, top_n=5, currency="BRL")
            if not results:
                return {"ok": False, "error": "fli returned None/empty"}
            return {
                "ok": True,
                "count": len(results),
                "first": {
                    "price": results[0].price,
                    "currency": results[0].currency,
                    "duration": results[0].duration,
                    "stops": results[0].stops,
                    "airline": results[0].legs[0].airline.value if results[0].legs and results[0].legs[0].airline else None,
                },
            }
        except Exception as e:
            return {"ok": False, "error": str(e), "type": type(e).__name__}

    return await asyncio.to_thread(_test)


def _purge_old_jobs() -> None:
    cutoff = time.time() - _JOB_TTL_SECONDS
    to_delete = [
        jid for jid, j in jobs.items()
        if j["status"] in ("complete", "failed") and j.get("created_at", 0) < cutoff
    ]
    for jid in to_delete:
        del jobs[jid]


@app.post("/api/search", response_model=JobResponse, status_code=202)
async def start_search(body: SearchInput, background: BackgroundTasks):
    _purge_old_jobs()
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "status": "queued",
        "matrix": None,
        "return_matrix": None,
        "logs": [],
        "error": None,
        "created_at": time.time(),
    }
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
        return_matrix=job.get("return_matrix"),
        logs=job.get("logs", []),
        error=job.get("error"),
    )
