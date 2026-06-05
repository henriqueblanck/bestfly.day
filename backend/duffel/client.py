"""
Duffel API v2 async client.
All I/O goes through this module — swap for Amadeus etc. by replacing DuffelClient.
"""
import asyncio
import logging
from decimal import Decimal
from typing import Any
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

    # ------------------------------------------------------------------ #
    # Batch Offer Requests                                                 #
    # ------------------------------------------------------------------ #

    async def create_batch_offer_request(
        self,
        slices: list[dict],
        cabin_class: str = "economy",
        max_connections: int = 1,
    ) -> str:
        """Submit a batch offer request and return the batch_id."""
        payload = {
            "data": {
                "cabin_class": cabin_class,
                "slices": slices,
                "passengers": [{"type": "adult"}],
                "max_connections": max_connections,
            }
        }
        resp = await self._http.post(
            f"{self.BASE}/air/batch_offer_requests",
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()["data"]["id"]

    async def poll_batch_offer_request(self, batch_id: str) -> list[dict]:
        """Poll until complete; return raw offers list."""
        deadline = asyncio.get_event_loop().time() + settings.POLL_TIMEOUT_SECONDS
        while asyncio.get_event_loop().time() < deadline:
            resp = await self._http.get(
                f"{self.BASE}/air/batch_offer_requests/{batch_id}"
            )
            resp.raise_for_status()
            body = resp.json()["data"]
            if body["status"] == "complete":
                return body.get("offers", [])
            if body["status"] == "failed":
                raise RuntimeError(f"Batch {batch_id} failed: {body}")
            await asyncio.sleep(settings.POLL_INTERVAL_SECONDS)
        raise TimeoutError(f"Batch {batch_id} timed out")

    # ------------------------------------------------------------------ #
    # Single offer request (fallback / granular)                          #
    # ------------------------------------------------------------------ #

    async def search_one_way(
        self,
        origin: str,
        destination: str,
        departure_date: date,
        max_connections: int = 1,
    ) -> list[OfferSlice]:
        slices = [
            {
                "origin": origin,
                "destination": destination,
                "departure_date": departure_date.isoformat(),
            }
        ]
        batch_id = await self.create_batch_offer_request(
            slices, max_connections=max_connections
        )
        raw_offers = await self.poll_batch_offer_request(batch_id)
        return _parse_offers(raw_offers, origin, destination, departure_date)


# ------------------------------------------------------------------ #
# Parsing helpers                                                      #
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
            total = Decimal(offer["total_amount"])
            currency = offer["total_currency"]
            offer_id = offer["id"]
            slices = offer.get("slices", [])
            if not slices:
                continue
            seg = slices[0]
            duration_min = _iso_duration_to_minutes(seg.get("duration", "PT0M"))
            connections = len(seg.get("segments", [])) - 1
            results.append(
                OfferSlice(
                    origin=origin,
                    destination=destination,
                    departure_date=departure_date,
                    price=total,
                    currency=currency,
                    offer_id=offer_id,
                    duration_minutes=duration_min,
                    connections=connections,
                )
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("Skipping malformed offer: %s", exc)
    return results


def _iso_duration_to_minutes(iso: str) -> int:
    """PT14H30M → 870"""
    import re
    h = int(m.group(1)) if (m := re.search(r"(\d+)H", iso)) else 0
    mins = int(m.group(1)) if (m := re.search(r"(\d+)M", iso)) else 0
    return h * 60 + mins
