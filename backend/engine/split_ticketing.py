"""
Core split-ticketing engine.

Hub-by-hub execution: for each hub, run all long-haul legs then all intra-EU
legs, then emit a partial matrix. This way partial results are available as
soon as the first hub is fully scanned.
"""
import asyncio
import logging
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Callable

from config import settings
from google_flights.client import GoogleFlightsClient, OfferSlice

log = logging.getLogger(__name__)

MarkupFn = Callable[[Decimal], Decimal]
LogFn = Callable[[str], None]
PartialFn = Callable[["PriceMatrix"], None]


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


PriceMatrix = dict[str, dict[str, dict[str, MatrixEntry]]]


@dataclass
class SearchRequest:
    origins: list[str]
    destinations: list[str]
    hubs: list[str]
    date_from: date
    date_to: date
    max_connections: int = 1
    max_duration_hours: int = 20
    markup_fn: MarkupFn = field(default=lambda p: p)


SEARCH_DELAY_SECONDS = 2.0


class SplitTicketingEngine:
    def __init__(self, log_fn: LogFn | None = None, partial_fn: PartialFn | None = None):
        self._client = GoogleFlightsClient()
        self._log_fn = log_fn or (lambda msg: log.info(msg))
        self._partial_fn = partial_fn

    def _emit(self, msg: str) -> None:
        self._log_fn(msg)

    async def compute(self, req: SearchRequest) -> PriceMatrix:
        date_range = _date_range(req.date_from, req.date_to)
        all_lh_slices: list[OfferSlice] = []
        all_eu_slices: list[OfferSlice] = []

        total_searches = (len(req.origins) * len(req.hubs) + len(req.hubs) * len(req.destinations)) * len(date_range)
        self._emit(f"[start] {total_searches} buscas · {len(req.hubs)} hub(s) · {len(date_range)} dia(s)")

        for hub in req.hubs:
            self._emit(f"[hub {hub}] long-haul: {len(req.origins) * len(date_range)} buscas")

            for origin in req.origins:
                for d in date_range:
                    self._emit(f"→ {origin} → {hub} · {d.strftime('%d/%m')}")
                    slices = await self._fetch(origin, hub, d, req.max_connections, req.max_duration_hours)
                    all_lh_slices.extend(slices)
                    if slices:
                        best = min(slices, key=lambda s: s.price)
                        self._emit(f"  ✓ {best.airline or '—'} · {_fmt_duration(best.duration_minutes)} · R${int(best.price)}")
                    else:
                        self._emit(f"  – sem resultado")
                    await asyncio.sleep(SEARCH_DELAY_SECONDS)

            self._emit(f"[hub {hub}] intra-EU: {len(req.destinations) * len(date_range)} buscas")

            for dest in req.destinations:
                for d in date_range:
                    self._emit(f"→ {hub} → {dest} · {d.strftime('%d/%m')}")
                    slices = await self._fetch(hub, dest, d, req.max_connections, req.max_duration_hours)
                    all_eu_slices.extend(slices)
                    if slices:
                        best = min(slices, key=lambda s: s.price)
                        self._emit(f"  ✓ {best.airline or '—'} · {_fmt_duration(best.duration_minutes)} · R${int(best.price)}")
                    else:
                        self._emit(f"  – sem resultado")
                    await asyncio.sleep(SEARCH_DELAY_SECONDS)

            # Emit partial matrix after each hub completes both legs
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

    async def _fetch(
        self,
        origin: str,
        destination: str,
        d: date,
        max_connections: int,
        max_duration_hours: int,
    ) -> list[OfferSlice]:
        offers = await self._client.search_one_way(origin, destination, d, max_connections)
        return [
            o for o in offers
            if o.duration_minutes <= max_duration_hours * 60
            and o.connections <= max_connections
        ]


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
                        )
                if best_entry:
                    matrix[origin][dest][d.isoformat()] = best_entry

    return matrix


def _date_range(start: date, end: date) -> list[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def _flatten(nested):
    return [item for sublist in nested for item in sublist]


def _fmt_duration(minutes: int) -> str:
    return f"{minutes // 60}h{minutes % 60:02d}m"
