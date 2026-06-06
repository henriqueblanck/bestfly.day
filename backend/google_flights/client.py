"""Google Flights client via fli (reverse-engineered API)."""
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

log = logging.getLogger(__name__)

_STOPS_MAP = {0: MaxStops.NON_STOP, 1: MaxStops.ONE_STOP_OR_FEWER, 2: MaxStops.TWO_OR_FEWER_STOPS}


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
            log.warning("Airport not in fli enum: %s", origin)
            return []
        try:
            dest_airport = Airport[destination]
        except KeyError:
            log.warning("Airport not in fli enum: %s", destination)
            return []

        max_stops = _STOPS_MAP.get(max_connections, MaxStops.ANY)

        def _search() -> list[OfferSlice]:
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

            try:
                results = searcher.search(filters, top_n=10, currency="BRL")
            except Exception as inner_exc:
                log.error(
                    "fli.search raised %s→%s %s: %s",
                    origin, destination, departure_date, inner_exc,
                )
                raise

            if results is None:
                log.warning("fli returned None for %s→%s %s", origin, destination, departure_date)
                return []

            log.info("fli %s→%s %s: %d result(s)", origin, destination, departure_date, len(results))

            slices = []
            for i, r in enumerate(results):
                if r.price is None:
                    log.debug("skipping result %d: price=None", i)
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

        try:
            return await asyncio.to_thread(_search)
        except Exception as exc:
            log.error(
                "Google Flights error %s→%s %s: %s",
                origin, destination, departure_date, exc,
            )
            return []
