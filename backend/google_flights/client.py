"""Google Flights client via fli (reverse-engineered API) with SQLite cache."""
import asyncio
import logging
from datetime import date
from decimal import Decimal

from fli.models import (
    Airport,
    FlightSearchFilters,
    FlightSegment,
    MaxStops,
    PassengerInfo,
    TripType,
)
from fli.search.flights import SearchFlights
from pydantic import BaseModel

import db

log = logging.getLogger(__name__)

_STOPS_MAP = {0: MaxStops.NON_STOP, 1: MaxStops.ONE_STOP_OR_FEWER, 2: MaxStops.TWO_OR_FEWER_STOPS}

_RETRY_ATTEMPTS = 3
_RETRY_BACKOFF = [3.0, 6.0]


class UnknownAirportError(ValueError):
    pass


class OfferSlice(BaseModel):
    origin: str
    destination: str
    departure_date: date
    price: Decimal
    currency: str
    offer_id: str
    duration_minutes: int
    connections: int
    airline: str = ""
    departure_time: str = ""


def _rows_to_slices(rows: list[dict], origin: str, destination: str, departure_date: date) -> list[OfferSlice]:
    return [
        OfferSlice(
            origin=origin,
            destination=destination,
            departure_date=departure_date,
            price=Decimal(str(r["price"])),
            currency=r.get("currency") or "BRL",
            offer_id=r.get("offer_id") or "",
            duration_minutes=r.get("duration_minutes") or 0,
            connections=r.get("connections") or 0,
            airline=r.get("airline") or "",
            departure_time=r.get("departure_time") or "",
        )
        for r in rows
    ]


class RoundTripOffer(BaseModel):
    outbound_price: Decimal
    return_price: Decimal
    total_price: Decimal
    currency: str
    outbound_airline: str = ""
    return_airline: str = ""
    outbound_duration_minutes: int = 0
    return_duration_minutes: int = 0
    outbound_connections: int = 0
    return_connections: int = 0


class GoogleFlightsClient:
    async def search_round_trip(
        self,
        origin: str,
        destination: str,
        outbound_date: date,
        return_date: date,
        max_connections: int = 1,
    ) -> RoundTripOffer | None:
        try:
            origin_airport = Airport[origin]
        except KeyError:
            raise UnknownAirportError(f"código não reconhecido pelo fli: {origin}")
        try:
            dest_airport = Airport[destination]
        except KeyError:
            raise UnknownAirportError(f"código não reconhecido pelo fli: {destination}")

        max_stops = _STOPS_MAP.get(max_connections, MaxStops.ANY)

        def _search() -> RoundTripOffer | None:
            searcher = SearchFlights()
            filters = FlightSearchFilters(
                trip_type=TripType.ROUND_TRIP,
                passenger_info=PassengerInfo(adults=1),
                flight_segments=[
                    FlightSegment(
                        departure_airport=[[origin_airport, 0]],
                        arrival_airport=[[dest_airport, 0]],
                        travel_date=outbound_date.isoformat(),
                        max_stops=max_stops,
                    ),
                    FlightSegment(
                        departure_airport=[[dest_airport, 0]],
                        arrival_airport=[[origin_airport, 0]],
                        travel_date=return_date.isoformat(),
                        max_stops=max_stops,
                    ),
                ],
            )
            results = searcher.search(filters, top_n=10, currency="BRL")
            if not results:
                return None

            best = min(results, key=lambda r: r.price or float("inf"))
            if best.price is None:
                return None

            total = Decimal(str(best.price))
            # Split evenly if no per-leg breakdown
            legs = best.legs or []
            if len(legs) >= 2:
                out_airline = legs[0].airline.value if legs[0].airline else ""
                ret_airline = legs[1].airline.value if legs[1].airline else ""
                out_dur = getattr(legs[0], "duration", 0) or 0
                ret_dur = getattr(legs[1], "duration", 0) or 0
                out_conn = getattr(legs[0], "stops", 0) or 0
                ret_conn = getattr(legs[1], "stops", 0) or 0
            else:
                out_airline = ret_airline = (legs[0].airline.value if legs and legs[0].airline else "")
                out_dur = ret_dur = (getattr(legs[0], "duration", 0) or 0) if legs else 0
                out_conn = ret_conn = 0

            half = (total / 2).quantize(Decimal("0.01"))
            return RoundTripOffer(
                outbound_price=half,
                return_price=total - half,
                total_price=total,
                currency=best.currency or "BRL",
                outbound_airline=out_airline,
                return_airline=ret_airline,
                outbound_duration_minutes=out_dur,
                return_duration_minutes=ret_dur,
                outbound_connections=out_conn,
                return_connections=ret_conn,
            )

        for attempt in range(_RETRY_ATTEMPTS):
            try:
                result = await asyncio.to_thread(_search)
                if result is not None:
                    log.info("round-trip %s↔%s %s/%s: R$%s", origin, destination, outbound_date, return_date, result.total_price)
                    return result
                if attempt < _RETRY_ATTEMPTS - 1:
                    await asyncio.sleep(_RETRY_BACKOFF[attempt])
            except UnknownAirportError:
                raise
            except Exception as exc:
                log.error("round-trip error %s↔%s (attempt %d): %s", origin, destination, attempt + 1, exc)
                if attempt < _RETRY_ATTEMPTS - 1:
                    await asyncio.sleep(_RETRY_BACKOFF[attempt])
        return None

    async def search_one_way(
        self,
        origin: str,
        destination: str,
        departure_date: date,
        max_connections: int = 1,
    ) -> list[OfferSlice]:
        try:
            origin_airport = Airport[origin]
        except KeyError:
            raise UnknownAirportError(f"código não reconhecido pelo fli: {origin}")
        try:
            dest_airport = Airport[destination]
        except KeyError:
            raise UnknownAirportError(f"código não reconhecido pelo fli: {destination}")

        # Cache hit?
        cached = await asyncio.to_thread(db.get_cached, origin, destination, departure_date)
        if cached is not None:
            log.info("cache hit %s→%s %s (%d slices)", origin, destination, departure_date, len(cached))
            return _rows_to_slices(cached, origin, destination, departure_date)

        max_stops = _STOPS_MAP.get(max_connections, MaxStops.ANY)

        def _search() -> list[OfferSlice] | None:
            searcher = SearchFlights()
            filters = FlightSearchFilters(
                trip_type=TripType.ONE_WAY,
                passenger_info=PassengerInfo(adults=1),
                flight_segments=[
                    FlightSegment(
                        departure_airport=[[origin_airport, 0]],
                        arrival_airport=[[dest_airport, 0]],
                        travel_date=departure_date.isoformat(),
                        max_stops=max_stops,
                    )
                ],
            )
            results = searcher.search(filters, top_n=30, currency="BRL")
            if not results:
                return None

            log.info("fli %s→%s %s: %d result(s)", origin, destination, departure_date, len(results))
            slices = []
            for i, r in enumerate(results):
                if r.price is None:
                    continue
                airline = ""
                dep_time = ""
                if r.legs:
                    leg0 = r.legs[0]
                    airline = leg0.airline.value if leg0.airline else ""
                    raw_dt = getattr(leg0, "departure_time", None) or getattr(r, "departure_time", None)
                    if raw_dt is not None:
                        try:
                            dep_time = raw_dt.strftime("%H:%M") if hasattr(raw_dt, "strftime") else str(raw_dt)[:5]
                        except Exception:
                            pass
                slices.append(
                    OfferSlice(
                        origin=origin,
                        destination=destination,
                        departure_date=departure_date,
                        price=Decimal(str(r.price)),
                        currency=r.currency or "BRL",
                        offer_id=f"{origin}-{destination}-{departure_date}-{i}",
                        duration_minutes=r.duration or 0,
                        connections=r.stops or 0,
                        airline=airline,
                        departure_time=dep_time,
                    )
                )
            return slices or None

        last_exc: Exception | None = None
        for attempt in range(_RETRY_ATTEMPTS):
            try:
                result = await asyncio.to_thread(_search)
                if result is not None:
                    # Persist to cache
                    await asyncio.to_thread(
                        db.save_slices,
                        origin, destination, departure_date,
                        [s.model_dump(mode="json") for s in result],
                    )
                    return result
                if attempt < _RETRY_ATTEMPTS - 1:
                    wait = _RETRY_BACKOFF[attempt]
                    log.warning(
                        "fli empty %s→%s %s, retry %d in %.0fs",
                        origin, destination, departure_date, attempt + 1, wait,
                    )
                    await asyncio.sleep(wait)
            except UnknownAirportError:
                raise
            except Exception as exc:
                last_exc = exc
                log.error("fli error %s→%s %s (attempt %d): %s", origin, destination, departure_date, attempt + 1, exc)
                if attempt < _RETRY_ATTEMPTS - 1:
                    await asyncio.sleep(_RETRY_BACKOFF[attempt])

        if last_exc:
            raise last_exc
        return []
