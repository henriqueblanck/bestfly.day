"""
Core split-ticketing engine.

Step A: fire concurrent searches Origin → Hub (long-haul round-trips)
Step B: fire concurrent searches Hub → Destination (intra-EU round-trips)
Step C: combine cheapest A + cheapest B per (origin, destination, date)
"""
import asyncio
import logging
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Callable, Optional

import httpx

from config import settings
from duffel.client import DuffelClient, OfferSlice

log = logging.getLogger(__name__)

MarkupFn = Callable[[Decimal], Decimal]


@dataclass
class MatrixEntry:
    total_price: Decimal
    longhaul_price: Decimal
    intraeu_price: Decimal
    hub: str
    currency: str
    longhaul_offer_id: str
    intraeu_offer_id: str


# matrix[origin][destination][date_iso] = MatrixEntry
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


class SplitTicketingEngine:
    def __init__(self, http: Optional[httpx.AsyncClient] = None):
        self._owned_http = http is None
        self._http = http or httpx.AsyncClient(
            headers={
                "Authorization": f"Bearer {settings.DUFFEL_API_TOKEN}",
                "Duffel-Version": "v2",
                "Content-Type": "application/json",
            },
            timeout=30.0,
        )
        self._client = DuffelClient(self._http)
        self._sem = asyncio.Semaphore(settings.CONCURRENCY_LIMIT)

    async def close(self):
        if self._owned_http:
            await self._http.aclose()

    # ------------------------------------------------------------------ #

    async def compute(self, req: SearchRequest) -> PriceMatrix:
        date_range = _date_range(req.date_from, req.date_to)

        # Step A: long-haul origin → hub
        longhaul_tasks = [
            self._fetch_safe(origin, hub, d, req.max_connections, req.max_duration_hours)
            for origin in req.origins
            for hub in req.hubs
            for d in date_range
        ]

        # Step B: intra-EU hub → destination
        intraeu_tasks = [
            self._fetch_safe(hub, dest, d, req.max_connections, req.max_duration_hours)
            for hub in req.hubs
            for dest in req.destinations
            for d in date_range
        ]

        log.info(
            "Firing %d long-haul + %d intra-EU searches (semaphore=%d)",
            len(longhaul_tasks),
            len(intraeu_tasks),
            settings.CONCURRENCY_LIMIT,
        )

        all_results = await asyncio.gather(*longhaul_tasks, *intraeu_tasks)

        n_lh = len(longhaul_tasks)
        lh_slices = _flatten(all_results[:n_lh])
        eu_slices = _flatten(all_results[n_lh:])

        return _build_matrix(
            req.origins, req.destinations, req.hubs, date_range,
            lh_slices, eu_slices,
            req.max_duration_hours,
            req.markup_fn,
        )

    async def _fetch_safe(
        self,
        origin: str,
        destination: str,
        d: date,
        max_connections: int,
        max_duration_hours: int,
    ) -> list[OfferSlice]:
        async with self._sem:
            for attempt in range(settings.MAX_RETRIES):
                try:
                    offers = await self._client.search_one_way(
                        origin, destination, d, max_connections
                    )
                    return [
                        o for o in offers
                        if o.duration_minutes <= max_duration_hours * 60
                        and o.connections <= max_connections
                    ]
                except httpx.HTTPStatusError as exc:
                    if exc.response.status_code == 429:
                        wait = 2 ** attempt
                        log.warning("Rate-limited; retrying in %ds", wait)
                        await asyncio.sleep(wait)
                    else:
                        log.error("HTTP %s for %s→%s %s", exc.response.status_code, origin, destination, d)
                        return []
                except Exception as exc:  # noqa: BLE001
                    log.error("Unexpected error %s→%s %s: %s", origin, destination, d, exc)
                    return []
        return []


# ------------------------------------------------------------------ #
# Matrix assembly                                                      #
# ------------------------------------------------------------------ #

def _build_matrix(
    origins: list[str],
    destinations: list[str],
    hubs: list[str],
    date_range: list[date],
    lh_slices: list[OfferSlice],
    eu_slices: list[OfferSlice],
    max_duration_hours: int,
    markup_fn: MarkupFn,
) -> PriceMatrix:
    # cheapest[origin][hub][date] = best OfferSlice
    best_lh: dict[tuple, OfferSlice] = {}
    for s in lh_slices:
        key = (s.origin, s.destination, s.departure_date)
        if key not in best_lh or s.price < best_lh[key].price:
            best_lh[key] = s

    # cheapest[hub][dest][date] = best OfferSlice
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
                best_entry: MatrixEntry | None = None
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
                        )
                if best_entry:
                    matrix[origin][dest][d.isoformat()] = best_entry

    return matrix


# ------------------------------------------------------------------ #
# Helpers                                                              #
# ------------------------------------------------------------------ #

def _date_range(start: date, end: date) -> list[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def _flatten(nested: list[list[OfferSlice]]) -> list[OfferSlice]:
    return [item for sublist in nested for item in sublist]
