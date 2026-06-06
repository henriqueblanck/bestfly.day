"""Google Flights client via fli (reverse-engineered API)."""
import asyncio
import logging
import time
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

log = logging.getLogger(__name__)

_STOPS_MAP = {0: MaxStops.NON_STOP, 1: MaxStops.ONE_STOP_OR_FEWER, 2: MaxStops.TWO_OR_FEWER_STOPS}

_RETRY_ATTEMPTS = 3
_RETRY_BACKOFF = [3.0, 6.0]  # seconds between retries


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


class GoogleFlightsClient:
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
            results = searcher.search(filters, top_n=10, currency="BRL")
            if not results:
                return None

            log.info("fli %s→%s %s: %d result(s)", origin, destination, departure_date, len(results))
            slices = []
            for i, r in enumerate(results):
                if r.price is None:
                    continue
                airline = ""
                if r.legs:
                    airline = r.legs[0].airline.value if r.legs[0].airline else ""
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
                    )
                )
            return slices

        last_exc: Exception | None = None
        for attempt in range(_RETRY_ATTEMPTS):
            try:
                result = await asyncio.to_thread(_search)
                if result is not None:
                    return result
                # Google returned empty — retry in case of transient rate limit
                if attempt < _RETRY_ATTEMPTS - 1:
                    wait = _RETRY_BACKOFF[attempt]
                    log.warning(
                        "fli returned empty for %s→%s %s, retry %d/%d in %.0fs",
                        origin, destination, departure_date, attempt + 1, _RETRY_ATTEMPTS, wait,
                    )
                    await asyncio.sleep(wait)
            except UnknownAirportError:
                raise
            except Exception as exc:
                last_exc = exc
                log.error(
                    "fli error %s→%s %s (attempt %d): %s",
                    origin, destination, departure_date, attempt + 1, exc,
                )
                if attempt < _RETRY_ATTEMPTS - 1:
                    await asyncio.sleep(_RETRY_BACKOFF[attempt])

        if last_exc:
            raise last_exc
        return []
