"""
Core split-ticketing engine — two-phase adaptive hub discovery.

Phase 1 — Probe: test all hub candidates on a single date to rank them by price.
Phase 2 — Matrix: run full date-range search for top-K discovered hubs.

Budget example (ori=2, dest=5, days=3, candidates=24, top_k=5):
  Phase 1: 2×24×1     =  48  (probe all candidates, 1 day)
  Phase 2 LH: 5×2×2   =  20  (remaining dates, selected hubs only)
  Phase 2 EU: 5×5×3   =  75  (all dates, hub→dest)
  Direct: 2×5×3       =  30
  Total               = 173  ✓ ≤ 200

top_k auto-scales with remaining budget so the limit is never breached.
"""
import asyncio
import logging
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Callable

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
    # Direct flight baseline
    direct_price: Decimal | None = None
    direct_airline: str = ""
    direct_duration_minutes: int = 0
    direct_connections: int = 0
    direct_departure_time: str = ""


PriceMatrix = dict[str, dict[str, dict[str, MatrixEntry]]]


@dataclass
class SearchRequest:
    origins: list[str]
    destinations: list[str]
    hub_candidates: list[str]      # full pool to probe in phase 1
    date_from: date
    date_to: date
    max_connections: int = 1
    max_duration_hours: int = 36
    top_k_hubs: int = 5            # how many hubs to select after probe
    markup_fn: MarkupFn = field(default=lambda p: p)


class SplitTicketingEngine:
    def __init__(self, log_fn: LogFn | None = None, partial_fn: PartialFn | None = None):
        self._client = GoogleFlightsClient()
        self._log_fn = log_fn or (lambda msg: log.info(msg))
        self._partial_fn = partial_fn
        self._sem = asyncio.Semaphore(CONCURRENT_SEARCHES)
        self._request_lock = asyncio.Lock()

    def _emit(self, msg: str) -> None:
        self._log_fn(msg)

    async def compute(self, req: SearchRequest) -> PriceMatrix:
        date_range = _date_range(req.date_from, req.date_to)
        probe_date = date_range[0]
        remaining_dates = date_range[1:]

        self._emit(
            f"[start] descoberta em {len(req.hub_candidates)} candidatos · "
            f"{len(date_range)} dia(s) · top-{req.top_k_hubs} hubs · {CONCURRENT_SEARCHES} paralelo"
        )

        # ── Phase 1: probe all candidates on probe_date ──────────────────────
        self._emit(f"[fase 1] testando {len(req.hub_candidates)} candidatos em {probe_date.strftime('%d/%m')}…")
        probe_combos = [(origin, hub) for origin in req.origins for hub in req.hub_candidates]
        probe_results = await asyncio.gather(*[
            self._throttled_fetch(origin, hub, probe_date, req.max_connections, req.max_duration_hours)
            for origin, hub in probe_combos
        ])

        # Rank hubs by cheapest price from any origin
        hub_best: dict[str, Decimal] = {}
        probe_slices: dict[tuple, list[OfferSlice]] = {}
        for (origin, hub), slices in zip(probe_combos, probe_results):
            probe_slices[(origin, hub)] = slices
            if slices:
                best = min(slices, key=lambda s: s.price).price
                if hub not in hub_best or best < hub_best[hub]:
                    hub_best[hub] = best

        selected_hubs = sorted(hub_best, key=lambda h: hub_best[h])[:req.top_k_hubs]
        if not selected_hubs:
            # Fallback: no probe results — use first K candidates
            selected_hubs = req.hub_candidates[:req.top_k_hubs]
            self._emit(f"  ⚠ probe sem resultados — usando fallback: {selected_hubs}")
        else:
            summary = " · ".join(f"{h} R${int(hub_best[h])}" for h in selected_hubs)
            self._emit(f"[hubs selecionados] {summary}")

        # ── Collect probe slices for selected hubs (reuse phase 1 data) ──────
        all_lh_slices: list[OfferSlice] = []
        for hub in selected_hubs:
            for origin in req.origins:
                slices = probe_slices.get((origin, hub), [])
                all_lh_slices.extend(slices)
                if slices:
                    best = min(slices, key=lambda s: s.price)
                    self._emit(
                        f"  ✓ {origin}→{hub} {probe_date.strftime('%d/%m')} · "
                        f"{best.airline or '—'} · {_fmt_duration(best.duration_minutes)} · R${int(best.price)}"
                    )
                else:
                    self._emit(f"  – {origin}→{hub} {probe_date.strftime('%d/%m')} sem resultado")

        all_eu_slices: list[OfferSlice] = []
        all_direct_slices: list[OfferSlice] = []

        # ── Phase 2: full matrix for selected hubs ───────────────────────────
        for hub in selected_hubs:
            # Long-haul: remaining dates (probe_date already done above)
            if remaining_dates:
                lh_combos = [(origin, hub, d) for origin in req.origins for d in remaining_dates]
                lh_results = await asyncio.gather(*[
                    self._throttled_fetch(origin, hub, d, req.max_connections, req.max_duration_hours)
                    for origin, hub, d in lh_combos
                ])
                for (origin, _, d), slices in zip(lh_combos, lh_results):
                    all_lh_slices.extend(slices)
                    if slices:
                        best = min(slices, key=lambda s: s.price)
                        self._emit(
                            f"  ✓ {origin}→{hub} {d.strftime('%d/%m')} · "
                            f"{best.airline or '—'} · {_fmt_duration(best.duration_minutes)} · R${int(best.price)}"
                        )
                    else:
                        self._emit(f"  – {origin}→{hub} {d.strftime('%d/%m')} sem resultado")

            # Intra-EU: all dates
            eu_combos = [(hub, dest, d) for dest in req.destinations for d in date_range]
            self._emit(f"[hub {hub}] intra: {len(eu_combos)} buscas")
            eu_results = await asyncio.gather(*[
                self._throttled_fetch(hub, dest, d, req.max_connections, req.max_duration_hours)
                for hub, dest, d in eu_combos
            ])
            for (_, dest, d), slices in zip(eu_combos, eu_results):
                all_eu_slices.extend(slices)
                if slices:
                    best = min(slices, key=lambda s: s.price)
                    self._emit(
                        f"  ✓ {hub}→{dest} {d.strftime('%d/%m')} · "
                        f"{best.airline or '—'} · {_fmt_duration(best.duration_minutes)} · R${int(best.price)}"
                    )
                else:
                    self._emit(f"  – {hub}→{dest} {d.strftime('%d/%m')} sem resultado")

            # Emit partial after each hub
            if self._partial_fn:
                partial = _build_matrix(
                    req.origins, req.destinations, selected_hubs, date_range,
                    all_lh_slices, all_eu_slices, all_direct_slices,
                    req.max_duration_hours, req.markup_fn,
                )
                self._partial_fn(partial)
                entries = sum(len(dates) for dests in partial.values() for dates in dests.values())
                self._emit(f"[hub {hub}] ✓ concluído · {entries} combos na matrix parcial")

        # ── Direct searches ───────────────────────────────────────────────────
        direct_combos = [
            (origin, dest, d)
            for origin in req.origins
            for dest in req.destinations
            for d in date_range
        ]
        if direct_combos:
            self._emit(f"[direto] {len(direct_combos)} buscas")
            direct_results = await asyncio.gather(*[
                self._throttled_fetch(origin, dest, d, req.max_connections, req.max_duration_hours)
                for origin, dest, d in direct_combos
            ])
            for (origin, dest, d), slices in zip(direct_combos, direct_results):
                all_direct_slices.extend(slices)
                if slices:
                    best = min(slices, key=lambda s: s.price)
                    self._emit(
                        f"  ✓ {origin}→{dest} {d.strftime('%d/%m')} direto · "
                        f"{best.airline or '—'} · {_fmt_duration(best.duration_minutes)} · R${int(best.price)}"
                    )
                else:
                    self._emit(f"  – {origin}→{dest} {d.strftime('%d/%m')} sem direto")

        return _build_matrix(
            req.origins, req.destinations, selected_hubs, date_range,
            all_lh_slices, all_eu_slices, all_direct_slices,
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
    lh_slices, eu_slices, direct_slices,
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

    best_direct: dict[tuple, OfferSlice] = {}
    for s in direct_slices:
        key = (s.origin, s.destination, s.departure_date)
        if key not in best_direct or s.price < best_direct[key].price:
            best_direct[key] = s

    matrix: PriceMatrix = {}
    for origin in origins:
        matrix[origin] = {}
        for dest in destinations:
            matrix[origin][dest] = {}
            for d in date_range:
                best_split: MatrixEntry | None = None

                for hub in hubs:
                    lh = best_lh.get((origin, hub, d))
                    eu = best_eu.get((hub, dest, d))
                    if lh is None or eu is None:
                        continue
                    combined = markup_fn(lh.price + eu.price)
                    if best_split is None or combined < best_split.total_price:
                        best_split = MatrixEntry(
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

                direct = best_direct.get((origin, dest, d))

                if best_split is not None:
                    if direct is not None:
                        best_split.direct_price = direct.price
                        best_split.direct_airline = direct.airline
                        best_split.direct_duration_minutes = direct.duration_minutes
                        best_split.direct_connections = direct.connections
                        best_split.direct_departure_time = direct.departure_time
                    matrix[origin][dest][d.isoformat()] = best_split

                elif direct is not None:
                    matrix[origin][dest][d.isoformat()] = MatrixEntry(
                        total_price=markup_fn(direct.price),
                        longhaul_price=Decimal(0),
                        intraeu_price=Decimal(0),
                        hub="DIRECT",
                        currency=direct.currency,
                        longhaul_offer_id="",
                        intraeu_offer_id="",
                        direct_price=direct.price,
                        direct_airline=direct.airline,
                        direct_duration_minutes=direct.duration_minutes,
                        direct_connections=direct.connections,
                        direct_departure_time=direct.departure_time,
                    )

    return matrix


def _date_range(start: date, end: date) -> list[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def _fmt_duration(minutes: int) -> str:
    return f"{minutes // 60}h{minutes % 60:02d}m"
