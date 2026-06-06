"""
Core split-ticketing engine.

Hub-by-hub execution with controlled parallelism:
- Within each hub, long-haul and intra-EU searches fire concurrently
- A shared semaphore (CONCURRENT_SEARCHES) caps simultaneous fli calls
- A per-request delay prevents burst spikes even within the semaphore
- Cache hits (from SQLite) bypass the semaphore entirely (instant)
- Partial matrix emitted after each hub completes both legs
"""
import asyncio
import logging
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Callable

from config import settings
from google_flights.client import GoogleFlightsClient, OfferSlice, UnknownAirportError

log = logging.getLogger(__name__)

MarkupFn = Callable[[Decimal], Decimal]
LogFn = Callable[[str], None]
PartialFn = Callable[["PriceMatrix"], None]

CONCURRENT_SEARCHES = 3      # max simultaneous fli calls
INTER_REQUEST_DELAY = 1.0    # seconds between each semaphore acquisition


@dataclass
class MatrixEntry:
    total_price: Decimal
    longhaul_price: Decimal
    intraeu_price: Decimal
    hub: str
    currency: str
    longhaul_offer_id: str
    intraeu_offer_id: str
    longhaul_airline: str = ""
    intraeu_airline: str = ""
    longhaul_duration_minutes: int = 0
    intraeu_duration_minutes: int = 0
    longhaul_departure_time: str = ""
    intraeu_departure_time: str = ""
    longhaul_connections: int = 0
    intraeu_connections: int = 0


PriceMatrix = dict[str, dict[str, dict[str, MatrixEntry]]]


@dataclass
class SearchRequest:
    origins: list[str]
    destinations: list[str]
    hubs: list[str]
    date_from: date
    date_to: date
    max_connections: int = 1
    max_duration_hours: int = 36
    markup_fn: MarkupFn = field(default=lambda p: p)


class SplitTicketingEngine:
    def __init__(self, log_fn: LogFn | None = None, partial_fn: PartialFn | None = None):
        self._client = GoogleFlightsClient()
        self._log_fn = log_fn or (lambda msg: log.info(msg))
        self._partial_fn = partial_fn
        self._sem = asyncio.Semaphore(CONCURRENT_SEARCHES)
        self._request_lock = asyncio.Lock()  # serialise semaphore acquisitions for the delay

    def _emit(self, msg: str) -> None:
        self._log_fn(msg)

    async def compute(self, req: SearchRequest) -> PriceMatrix:
        date_range = _date_range(req.date_from, req.date_to)
        all_lh_slices: list[OfferSlice] = []
        all_eu_slices: list[OfferSlice] = []

        total_searches = (
            len(req.origins) * len(req.hubs) + len(req.hubs) * len(req.destinations)
        ) * len(date_range)
        self._emit(
            f"[start] {total_searches} buscas · {len(req.hubs)} hub(s) · "
            f"{len(date_range)} dia(s) · {CONCURRENT_SEARCHES} em paralelo"
        )

        for hub in req.hubs:
            # ── Long-haul searches for this hub (all in parallel, capped by semaphore) ──
            lh_combos = [(origin, hub, d) for origin in req.origins for d in date_range]
            self._emit(f"[hub {hub}] long-haul: {len(lh_combos)} buscas")
            lh_results = await asyncio.gather(
                *[
                    self._throttled_fetch(origin, hub, d, req.max_connections, req.max_duration_hours)
                    for origin, hub, d in lh_combos
                ]
            )
            for (origin, _, d), slices in zip(lh_combos, lh_results):
                all_lh_slices.extend(slices)
                if slices:
                    best = min(slices, key=lambda s: s.price)
                    self._emit(f"  ✓ {origin}→{hub} {d.strftime('%d/%m')} · {best.airline or '—'} · {_fmt_duration(best.duration_minutes)} · R${int(best.price)}")
                else:
                    self._emit(f"  – {origin}→{hub} {d.strftime('%d/%m')} sem resultado")

            # ── Intra-EU searches for this hub ──
            eu_combos = [(hub, dest, d) for dest in req.destinations for d in date_range]
            self._emit(f"[hub {hub}] intra-EU: {len(eu_combos)} buscas")
            eu_results = await asyncio.gather(
                *[
                    self._throttled_fetch(hub, dest, d, req.max_connections, req.max_duration_hours)
                    for hub, dest, d in eu_combos
                ]
            )
            for (_, dest, d), slices in zip(eu_combos, eu_results):
                all_eu_slices.extend(slices)
                if slices:
                    best = min(slices, key=lambda s: s.price)
                    self._emit(f"  ✓ {hub}→{dest} {d.strftime('%d/%m')} · {best.airline or '—'} · {_fmt_duration(best.duration_minutes)} · R${int(best.price)}")
                else:
                    self._emit(f"  – {hub}→{dest} {d.strftime('%d/%m')} sem resultado")

            # Emit partial matrix after each hub
            if self._partial_fn:
                partial = _build_matrix(
                    req.origins, req.destinations, req.hubs, date_range,
                    all_lh_slices, all_eu_slices,
                    req.max_duration_hours, req.markup_fn,
                )
                self._partial_fn(partial)
                entries = sum(len(dates) for dests in partial.values() for dates in dests.values())
                self._emit(f"[hub {hub}] ✓ concluído · {entries} combos na matrix parcial")

        return _build_matrix(
            req.origins, req.destinations, req.hubs, date_range,
            all_lh_slices, all_eu_slices,
            req.max_duration_hours, req.markup_fn,
        )

    async def _throttled_fetch(
        self,
        origin: str,
        destination: str,
        d: date,
        max_connections: int,
        max_duration_hours: int,
    ) -> list[OfferSlice]:
        # Serialise semaphore acquisition + delay to prevent bursts
        async with self._request_lock:
            await self._sem.acquire()
            await asyncio.sleep(INTER_REQUEST_DELAY)

        try:
            return await self._fetch(origin, destination, d, max_connections, max_duration_hours)
        finally:
            self._sem.release()

    async def _fetch(
        self,
        origin: str,
        destination: str,
        d: date,
        max_connections: int,
        max_duration_hours: int,
    ) -> list[OfferSlice]:
        try:
            offers = await self._client.search_one_way(origin, destination, d, max_connections)
        except UnknownAirportError as e:
            self._emit(f"  ✗ {e}")
            return []
        except Exception as exc:
            self._emit(f"  ✗ erro: {exc}")
            return []

        filtered = [
            o for o in offers
            if o.duration_minutes <= max_duration_hours * 60
            and o.connections <= max_connections
        ]
        if offers and not filtered:
            self._emit(f"  – {len(offers)} resultado(s) filtrados (duração/escalas)")
        return filtered


def _build_matrix(
    origins, destinations, hubs, date_range,
    lh_slices, eu_slices,
    max_duration_hours, markup_fn,
) -> PriceMatrix:
    best_lh: dict[tuple, OfferSlice] = {}
    for s in lh_slices:
        key = (s.origin, s.destination, s.departure_date)
        if key not in best_lh or s.price < best_lh[key].price:
            best_lh[key] = s

    best_eu: dict[tuple, OfferSlice] = {}
    for s in eu_slices:
        key = (s.origin, s.destination, s.departure_date)
        if key not in best_eu or s.price < best_eu[key].price:
            best_eu[key] = s

    matrix: PriceMatrix = {}
    for origin in origins:
        matrix[origin] = {}
        for dest in destinations:
            matrix[origin][dest] = {}
            for d in date_range:
                best_entry = None
                for hub in hubs:
                    lh = best_lh.get((origin, hub, d))
                    eu = best_eu.get((hub, dest, d))
                    if lh is None or eu is None:
                        continue
                    combined = markup_fn(lh.price + eu.price)
                    if best_entry is None or combined < best_entry.total_price:
                        best_entry = MatrixEntry(
                            total_price=combined,
                            longhaul_price=lh.price,
                            intraeu_price=eu.price,
                            hub=hub,
                            currency=lh.currency,
                            longhaul_offer_id=lh.offer_id,
                            intraeu_offer_id=eu.offer_id,
                            longhaul_airline=lh.airline,
                            intraeu_airline=eu.airline,
                            longhaul_duration_minutes=lh.duration_minutes,
                            intraeu_duration_minutes=eu.duration_minutes,
                            longhaul_departure_time=lh.departure_time,
                            intraeu_departure_time=eu.departure_time,
                            longhaul_connections=lh.connections,
                            intraeu_connections=eu.connections,
                        )
                if best_entry:
                    matrix[origin][dest][d.isoformat()] = best_entry

    return matrix


def _date_range(start: date, end: date) -> list[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def _fmt_duration(minutes: int) -> str:
    return f"{minutes // 60}h{minutes % 60:02d}m"
