"""
Duffel API v2 async client.
Uses /air/offer_requests (synchronous) — results return immediately.
Concurrency is handled at the engine layer via asyncio.gather + Semaphore.
"""
import logging
import re
from decimal import Decimal
from datetime import date

import httpx
from pydantic import BaseModel

from ..config import settings

log = logging.getLogger(__name__)


class OfferSlice(BaseModel):
    origin: str
    destination: str
    departure_date: date
    price: Decimal
    currency: str
    offer_id: str
    duration_minutes: int
    connections: int


class DuffelClient:
    BASE = settings.DUFFEL_API_BASE

    def __init__(self, http: httpx.AsyncClient):
        self._http = http

    async def search_one_way(
        self,
        origin: str,
        destination: str,
        departure_date: date,
        max_connections: int = 1,
    ) -> list[OfferSlice]:
        payload = {
            "data": {
                "slices": [
                    {
                        "origin": origin,
                        "destination": destination,
                        "departure_date": departure_date.isoformat(),
                    }
                ],
                "passengers": [{"type": "adult"}],
                "cabin_class": "economy",
                "max_connections": max_connections,
            }
        }
        resp = await self._http.post(
            f"{self.BASE}/air/offer_requests",
            json=payload,
            params={"return_offers": "true"},
        )
        resp.raise_for_status()
        body = resp.json()
        raw_offers = body.get("data", {}).get("offers", [])
        log.debug(
            "%s→%s %s: %d offers",
            origin, destination, departure_date, len(raw_offers)
        )
        return _parse_offers(raw_offers, origin, destination, departure_date)


# ------------------------------------------------------------------ #
# Parsing                                                              #
# ------------------------------------------------------------------ #

def _parse_offers(
    raw: list[dict],
    origin: str,
    destination: str,
    departure_date: date,
) -> list[OfferSlice]:
    results: list[OfferSlice] = []
    for offer in raw:
        try:
            slices = offer.get("slices", [])
            if not slices:
                continue
            sl = slices[0]
            duration_min = _iso_duration_to_minutes(sl.get("duration", "PT0M"))
            connections = max(0, len(sl.get("segments", [])) - 1)
            results.append(
                OfferSlice(
                    origin=origin,
                    destination=destination,
                    departure_date=departure_date,
                    price=Decimal(offer["total_amount"]),
                    currency=offer["total_currency"],
                    offer_id=offer["id"],
                    duration_minutes=duration_min,
                    connections=connections,
                )
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("Skipping malformed offer: %s", exc)
    return results


def _iso_duration_to_minutes(iso: str) -> int:
    """PT14H30M → 870"""
    h = int(m.group(1)) if (m := re.search(r"(\d+)H", iso)) else 0
    mins = int(m.group(1)) if (m := re.search(r"(\d+)M", iso)) else 0
    return h * 60 + mins
