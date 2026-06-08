"""FastAPI entrypoint."""
import uuid
import asyncio
import logging
import time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Literal

from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator, model_validator

from config import settings
from engine.split_ticketing import SearchRequest, SplitTicketingEngine
from google_flights.client import GoogleFlightsClient, UnknownAirportError
import db

log = logging.getLogger(__name__)

jobs: dict[str, dict[str, Any]] = {}
_JOB_TTL_SECONDS = 3600

# Candidate pool — engine probes all of these and picks the best for each search
HUB_CANDIDATES = [
    # Europe — primary transatlantic hubs (major flag carriers)
    "MAD", "LIS", "CDG", "FRA", "LHR", "AMS", "MUC", "FCO", "ZRH",
    # Europe — secondary + low-cost bases (Ryanair, easyJet, Vueling, Wizz)
    "BCN", "VIE", "BRU", "DUB", "IST", "ATH",
    "ORY", "LGW", "BER", "WAW", "OPO",
    # Middle East — Qatar / Emirates / Etihad global connectors
    "DOH", "DXB", "AUH",
    # North America — full major alliance coverage
    "YUL", "YYZ",            # Air Canada
    "JFK", "EWR", "ORD",     # United / multiple carriers
    "ATL", "IAD", "DFW",     # Delta GRU-ATL, United GRU-IAD, American GRU-DFW
    # Latin America — Aeromexico, Copa, Avianca, LATAM hubs
    "MEX", "PTY", "BOG", "MIA", "LIM", "SCL",
    # Africa — Ethiopian Airlines (ADD does GRU→ADD→Europe directly)
    "ADD", "CMN",
    # Asia — selective long-shots (Korean Air, Singapore Airlines)
    "ICN", "SIN",
]

MAX_SEARCHES = 1000

# Hub candidates specifically for RT probing: routes that tend to have
# cheap round-trip fares from/to Brazil and to European destinations.
RT_HUB_CANDIDATES = [
    # LATAM — best RT fares from Brazil
    "BOG", "PTY", "MEX", "MIA", "YYZ", "SCL", "LIM",
    # Europe — transatlantic RT hubs
    "MAD", "LIS", "FCO", "AMS", "FRA", "LHR", "BCN", "CDG",
    # Middle East — Emirates / Qatar / Etihad
    "DOH", "DXB",
    # Africa
    "ADD",
]

app = FastAPI(title="BestFly — Flight Price Matrix")


@app.on_event("startup")
async def startup():
    db.init_db()
    jobs.update(db.load_jobs(_JOB_TTL_SECONDS))
    log.info("Restored %d jobs from SQLite", len(jobs))
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
        top_k = max(4, min(8, (MAX_SEARCHES - probe - direct) // phase2_per_hub)) if phase2_per_hub > 0 else 4
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
    roundtrip_direct: dict | None = None
    split_rt: dict | None = None
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
        top_k = max(4, min(8, (MAX_SEARCHES - probe - direct) // phase2_per_hub)) if phase2_per_hub > 0 else 4

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
        serialized_out = _serialize_matrix(matrix)
        serialized_out = await _enrich_with_stats(serialized_out)
        jobs[job_id]["matrix"] = serialized_out
        await asyncio.to_thread(db.save_job, job_id, jobs[job_id])

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
            serialized_ret = _serialize_matrix(return_matrix)
            serialized_ret = await _enrich_with_stats(serialized_ret)
            jobs[job_id]["return_matrix"] = serialized_ret

            # Matrix ready — mark complete so the frontend can render immediately.
            # Round-trip Playwright searches run as a background task (heavy).
            jobs[job_id]["status"] = "complete"
            await asyncio.to_thread(db.save_job, job_id, jobs[job_id])

            # ── Round-trip direct baseline (background) ──
            # Fase 1: GetCalendarGraph → preços por dia do mês (1 chamada/par).
            # Fase 2: expansão two-step apenas para as N datas mais baratas.
            def _fli_rt_sync(orig: str, dst: str, od, rd) -> dict | None:
                """Synchronous fli round-trip search — returns processed dict or None."""
                from fli.models import (
                    Airport, FlightSearchFilters, FlightSegment,
                    MaxStops, PassengerInfo, TripType,
                )
                from fli.search.flights import SearchFlights
                try:
                    orig_ap = Airport[orig]
                    dst_ap = Airport[dst]
                except KeyError:
                    return None
                stops_map = {0: MaxStops.NON_STOP, 1: MaxStops.ONE_STOP_OR_FEWER, 2: MaxStops.TWO_OR_FEWER_STOPS}
                max_stops = stops_map.get(req.max_connections, MaxStops.ONE_STOP_OR_FEWER)
                filters = FlightSearchFilters(
                    trip_type=TripType.ROUND_TRIP,
                    passenger_info=PassengerInfo(adults=1),
                    flight_segments=[
                        FlightSegment(
                            departure_airport=[[orig_ap, 0]],
                            arrival_airport=[[dst_ap, 0]],
                            travel_date=od.isoformat(),
                            max_stops=max_stops,
                        ),
                        FlightSegment(
                            departure_airport=[[dst_ap, 0]],
                            arrival_airport=[[orig_ap, 0]],
                            travel_date=rd.isoformat(),
                            max_stops=max_stops,
                        ),
                    ],
                )
                # fli returns list[tuple[FlightResult, FlightResult]] for round-trip
                results = SearchFlights().search(filters, top_n=1, currency="BRL")
                if not results:
                    return None
                best: dict | None = None
                best_total = float("inf")
                for pair in results:
                    if not isinstance(pair, (tuple, list)) or len(pair) < 2:
                        continue
                    out, ret = pair[0], pair[1]
                    # fli exposes the full RT price on out.price (total both directions).
                    # ret.price is the same total — do NOT sum them (would double-count).
                    if out.price is None:
                        continue
                    total = float(out.price)
                    if total < best_total:
                        best_total = total
                        out_airline = out.legs[0].airline.value if out.legs and out.legs[0].airline else ""
                        ret_airline = ret.legs[0].airline.value if ret.legs and ret.legs[0].airline else ""
                        best = {
                            "total": total,
                            "outbound": total / 2,
                            "return": total / 2,
                            "out_airline": out_airline,
                            "ret_airline": ret_airline,
                            "out_dur": int(out.duration or 0),
                            "ret_dur": int(ret.duration or 0),
                            "out_stops": out.stops or 0,
                            "ret_stops": ret.stops or 0,
                        }
                return best

            async def _run_rt_bg():
                try:
                    async with asyncio.timeout(180):
                        out_mid = req.date_from + (req.date_to - req.date_from) // 2
                        ret_mid = req.return_date_from + (ret_end - req.return_date_from) // 2

                        # ── Phase 1: RT(origin↔hub) for all RT hub candidates ──
                        _ph1_sem = asyncio.Semaphore(10)

                        async def _probe_lh(origin: str, hub: str) -> tuple | None:
                            async with _ph1_sem:
                                try:
                                    r = await asyncio.wait_for(
                                        asyncio.to_thread(_fli_rt_sync, origin, hub, out_mid, ret_mid),
                                        timeout=20,
                                    )
                                    if r:
                                        on_log(f"  [lh] RT {origin}↔{hub} R${int(r['total'])}")
                                        return (origin, hub, r)
                                except asyncio.TimeoutError:
                                    pass
                                except Exception as exc:
                                    on_log(f"  ✗ [lh] {origin}↔{hub}: {exc}")
                                return None

                        ph1_combos = [(o, h) for o in req.origins for h in RT_HUB_CANDIDATES]
                        on_log(f"[split-rt] fase 1 — {len(ph1_combos)} probes RT(ori↔hub)…")
                        ph1_raw = await asyncio.gather(*[_probe_lh(o, h) for o, h in ph1_combos])

                        # ph1_offers[origin][hub] = offer_dict
                        ph1_offers: dict[str, dict[str, dict]] = {}
                        for item in ph1_raw:
                            if item is None:
                                continue
                            origin, hub, offer = item
                            ph1_offers.setdefault(origin, {})[hub] = offer

                        # Top 4 cheapest hubs per origin (by RT total)
                        top_hubs_by_origin: dict[str, list[str]] = {}
                        for origin in req.origins:
                            ranked = sorted(ph1_offers.get(origin, {}).items(), key=lambda x: x[1]["total"])
                            top = [h for h, _ in ranked[:4]]
                            top_hubs_by_origin[origin] = top
                            if top:
                                on_log("  [lh] top hubs de " + origin + ": " +
                                       " · ".join(f"{h} R${int(ph1_offers[origin][h]['total'])}" for h in top))

                        # ── Phase 2: RT(hub↔dest) + direct RT(ori↔dest) in parallel ──
                        _ph2_sem = asyncio.Semaphore(8)

                        async def _probe_eu(origin: str, dest: str, hub: str) -> tuple | None:
                            async with _ph2_sem:
                                try:
                                    r = await asyncio.wait_for(
                                        asyncio.to_thread(_fli_rt_sync, hub, dest, out_mid, ret_mid),
                                        timeout=20,
                                    )
                                    if r:
                                        lh = ph1_offers[origin][hub]
                                        total = lh["total"] + r["total"]
                                        await asyncio.to_thread(db.save_rt_price, origin, dest, total, "BRL", hub)
                                        stats = await asyncio.to_thread(db.get_rt_stats, origin, dest, hub)
                                        deal_pct = round((1 - total / stats["avg"]) * 100, 1) if stats["avg"] else None
                                        on_log(f"  ✓ split-rt {origin}↔{hub}↔{dest} R${int(total)}")
                                        return (origin, dest, hub, {
                                            "total": total,
                                            "lh_total": lh["total"],
                                            "eu_total": r["total"],
                                            "hub": hub,
                                            "lh_airline": lh["out_airline"],
                                            "eu_airline": r["out_airline"],
                                            "outbound_date": out_mid.isoformat(),
                                            "return_date": ret_mid.isoformat(),
                                            "hist_avg": stats["avg"],
                                            "deal_pct": deal_pct,
                                            "hist_obs": stats["obs"],
                                        })
                                except asyncio.TimeoutError:
                                    on_log(f"  ✗ split-rt {origin}↔{hub}↔{dest}: timeout")
                                except Exception as exc:
                                    on_log(f"  ✗ split-rt {origin}↔{hub}↔{dest}: {exc}")
                                return None

                        async def _probe_direct_rt(origin: str, dest: str) -> tuple | None:
                            async with _ph2_sem:
                                try:
                                    r = await asyncio.wait_for(
                                        asyncio.to_thread(_fli_rt_sync, origin, dest, out_mid, ret_mid),
                                        timeout=20,
                                    )
                                    if r:
                                        await asyncio.to_thread(db.save_rt_price, origin, dest, r["total"])
                                        stats = await asyncio.to_thread(db.get_rt_stats, origin, dest)
                                        deal_pct = round((1 - r["total"] / stats["avg"]) * 100, 1) if stats["avg"] else None
                                        on_log(f"  ✓ rt direto {origin}↔{dest} R${int(r['total'])}")
                                        return (origin, dest, out_mid.isoformat(), {
                                            "total": r["total"],
                                            "outbound": r["outbound"],
                                            "return": r["return"],
                                            "outbound_airline": r["out_airline"],
                                            "return_airline": r["ret_airline"],
                                            "outbound_duration_minutes": r["out_dur"],
                                            "return_duration_minutes": r["ret_dur"],
                                            "outbound_connections": r["out_stops"],
                                            "return_connections": r["ret_stops"],
                                            "outbound_date": out_mid.isoformat(),
                                            "return_date": ret_mid.isoformat(),
                                            "hist_avg": stats["avg"],
                                            "deal_pct": deal_pct,
                                            "hist_obs": stats["obs"],
                                            "trend": stats["trend"],
                                        })
                                except asyncio.TimeoutError:
                                    on_log(f"  ✗ rt direto {origin}↔{dest}: timeout")
                                except Exception as exc:
                                    on_log(f"  ✗ rt direto {origin}↔{dest}: {exc}")
                                return None

                        ph2_combos = [
                            (o, d, hub)
                            for o in req.origins
                            for d in req.destinations
                            for hub in top_hubs_by_origin.get(o, [])
                        ]
                        direct_combos = [(o, d) for o in req.origins for d in req.destinations]
                        on_log(f"[split-rt] fase 2 — {len(ph2_combos)} split + {len(direct_combos)} direto…")

                        ph2_raw, direct_raw = await asyncio.gather(
                            asyncio.gather(*[_probe_eu(*c) for c in ph2_combos]),
                            asyncio.gather(*[_probe_direct_rt(*c) for c in direct_combos]),
                        )

                        # Best split-RT per (origin, dest)
                        split_rt: dict[str, dict[str, Any]] = {}
                        for item in ph2_raw:
                            if item is None:
                                continue
                            o, d, hub, offer = item
                            existing = split_rt.get(o, {}).get(d)
                            if existing is None or offer["total"] < existing["total"]:
                                split_rt.setdefault(o, {})[d] = offer
                        jobs[job_id]["split_rt"] = split_rt

                        # Direct RT per (origin, dest, date)
                        rt_direct: dict[str, dict[str, Any]] = {}
                        for item in direct_raw:
                            if item is None:
                                continue
                            o, d, date_iso, offer = item
                            rt_direct.setdefault(o, {}).setdefault(d, {})[date_iso] = offer
                        jobs[job_id]["roundtrip_direct"] = rt_direct

                        await asyncio.to_thread(db.save_job, job_id, jobs[job_id])
                except asyncio.TimeoutError:
                    on_log("[split-rt] timeout — exibindo resultados parciais")
                    if jobs[job_id].get("roundtrip_direct") is None:
                        jobs[job_id]["roundtrip_direct"] = {}
                    if jobs[job_id].get("split_rt") is None:
                        jobs[job_id]["split_rt"] = {}
                    await asyncio.to_thread(db.save_job, job_id, jobs[job_id])

            asyncio.create_task(_run_rt_bg())
    except Exception as exc:
        log.exception("Search job %s failed", job_id)
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["error"] = str(exc)
        await asyncio.to_thread(db.save_job, job_id, jobs[job_id])


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
                    "split_price": float(entry.split_price) if entry.split_price is not None else None,
                    "split_hub": entry.split_hub or None,
                    "hist_avg": None,
                    "deal_pct": None,
                    "trend": None,
                    "hist_obs": 0,
                }
    return out


async def _enrich_with_stats(serialized: dict) -> dict:
    """Annotate matrix entries with historical price stats and record hub wins."""
    routes: list[tuple[str, str, str]] = []
    for origin, dests in serialized.items():
        for dest, dates in dests.items():
            for d_iso in dates:
                routes.append((origin, dest, d_iso))

    if not routes:
        return serialized

    stats = await asyncio.to_thread(db.get_bulk_stats, routes)

    wins: list[dict] = []
    for origin, dests in serialized.items():
        for dest, dates in dests.items():
            for d_iso, entry in dates.items():
                key = f"{origin}|{dest}|{d_iso}"
                s = stats.get(key)
                if s and s["avg_price"] and s["observations"] >= 3:
                    avg = s["avg_price"]
                    deal_pct = round((avg - entry["total_price"]) / avg * 100, 1)
                    entry["hist_avg"] = round(avg, 2)
                    entry["deal_pct"] = deal_pct
                    entry["trend"] = s["trend"]
                    entry["hist_obs"] = s["observations"]
                else:
                    entry["hist_avg"] = None
                    entry["deal_pct"] = None
                    entry["trend"] = None
                    entry["hist_obs"] = 0

                wins.append({
                    "origin": origin,
                    "destination": dest,
                    "flight_date": d_iso,
                    "hub": entry["hub"],
                    "price": entry["total_price"],
                })

    if wins:
        asyncio.create_task(asyncio.to_thread(db.record_hub_wins, wins))

    return serialized


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


@app.get("/api/stats/hubs")
async def hub_stats(days_back: int = 30):
    rows = await asyncio.to_thread(db.get_hub_win_rates, days_back)
    return {"days_back": days_back, "hubs": rows}


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
        "internal_hubs": _HUB_CANDIDATES,
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
    to_delete = []
    for jid, j in jobs.items():
        if j["status"] not in ("complete", "failed"):
            continue
        ca = j.get("created_at", 0)
        if isinstance(ca, str):
            try:
                ca = datetime.fromisoformat(ca).timestamp()
            except Exception:
                ca = 0
        if ca < cutoff:
            to_delete.append(jid)
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
        "roundtrip_direct": None,
        "split_rt": None,
        "logs": [],
        "error": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await asyncio.to_thread(db.save_job, job_id, jobs[job_id])
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
        roundtrip_direct=job.get("roundtrip_direct"),
        split_rt=job.get("split_rt"),
        logs=job.get("logs", []),
        error=job.get("error"),
    )
