"""
Google Flights price calendar via the GetCalendarGraph endpoint.

Reverse-engineered from krisukox/google-flights-api (Go), which successfully
uses this endpoint. Confirmed endpoint name: GetCalendarGraph (NOT
GetCalendarGridResults — that name does not appear in any live implementation).

Endpoint
--------
POST https://www.google.com/_/FlightsFrontendUi/data/
         travel.frontend.flights.FlightsFrontendService/GetCalendarGraph
     ?f.sid=<any-large-int>&bl=boq_travel-frontend-ui_20230627.07_p1
     &hl=pt-BR&soc-app=162&soc-platform=1&soc-device=1&_reqid=261464&rt=c

Content-Type: application/x-www-form-urlencoded;charset=UTF-8

Body (URL-encoded):
    f.req=<url-encoded-outer-json>
    &at=AAuQa1oq5qIkgkQ2nG9vQZFTgSME%3A<unix-timestamp>&

Wire format
-----------
The outer JSON (before URL-encoding) is:

    [null, "<inner-json-string>"]

The inner JSON string has shape:

    [null, <main_struct>, null, null, null, 1, null, null, null, null, null, []], \
    ["<range_start_date>", "<range_end_date>"], null, [<trip_length>, <trip_length>]]

Where main_struct is the SAME flight-search block used in GetShoppingResults,
assembled as:

    [null, null, <trip_type>, null, [], <class>, <travelers>, null, null, null,
     null, null, null, [<segment>, ...]]

Segment (for the calendar, only the OUTBOUND segment is sent; return is
implied by TripLength):

    [[[["<ORIGIN>", 0]]], [[["<DEST>", 0]]], null, <stops>, [], [], "<dep_date>",
     null, [], [], [], null, null, [], 3]

    Note: for one-way, trip_type=2 and no return segment; for round-trip,
    trip_type=1 and only one segment is still sent (the Go implementation
    builds a single outbound segment even for round-trip in the calendar call).

Response parsing
----------------
Same JSONP wrapper as GetShoppingResults:
    )]}'\n\n<length-prefixed chunks>

Each chunk row with row[0]=="wrb.fr" has inner JSON at row[2].
The inner JSON structure for GetCalendarGraph differs from GetShoppingResults:

    Outer: [null, <offers_list>]
    Each offer: ["YYYY-MM-DD", "YYYY-MM-DD", [[null, <price>], ""], 1]
       [0] = departure date ISO string
       [1] = return date ISO string (same as departure for one-way)
       [2] = [[null, price_float], currency_token]
       [3] = 1 (always)

    For one-way, the response still has pairs (dep_date, return_date) but
    return_date is None or the same as dep_date.

Confidence level
----------------
HIGH for endpoint URL and overall payload shape — sourced directly from
krisukox/google-flights-api Go source (doRequestPriceGraph / getPriceGraphReqData).

MEDIUM for the exact segment encoding for airport codes (IATA-only, no city
lookup) — the Go source uses city abbreviation RPC for city names; we only
support IATA codes here, which is the simpler path used in the same code
for airport-only inputs.

MEDIUM for one-way behaviour — the Go lib only tested round-trip via
GetCalendarGraph. The trip_type=2 + single segment approach mirrors what
GetShoppingResults does for one-way, and is the most logical extension.

What needs to be verified manually
-----------------------------------
1. Whether the x-goog-ext-259736195-jspb header value is still valid (the
   feature-flag list inside it changes over time). The value here mirrors
   the one found in the Go source.
2. Whether the at= token matters (any value seems to work per the Go source).
3. One-way calendar: confirm trip_type=2 returns per-day one-way prices or
   whether Google always returns round-trip calendar and one-way is just
   inferred from TripLength=0.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import urllib.parse
from calendar import monthrange
from datetime import date
from decimal import Decimal
from typing import Literal

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_CALENDAR_URL_BASE = (
    "https://www.google.com/_/FlightsFrontendUi/data/"
    "travel.frontend.flights.FlightsFrontendService/GetCalendarGraph"
)

# Static URL query params (from krisukox Go source).  f.sid / _reqid are
# arbitrary integers; bl tag is a build label that changes occasionally but
# old ones continue to work.
_URL_PARAMS = (
    "f.sid=-8920707734915550076"
    "&bl=boq_travel-frontend-ui_20230627.07_p1"
    "&soc-app=162&soc-platform=1&soc-device=1"
    "&_reqid=261464&rt=c"
)

# Trip type enum (same as GetShoppingResults)
_TRIP_ROUND = 1
_TRIP_ONE_WAY = 2

# Seat class: 1=Economy, 2=PremiumEconomy, 3=Business, 4=First
_CLASS_ECONOMY = 1

# Stops: 0=ANY, 1=NONSTOP, 2=ONE_OR_FEWER, 3=TWO_OR_FEWER
_STOPS_ANY = 0

# For one-way calendar, TripLength is meaningless; use 0.
_TRIP_LENGTH_ONE_WAY = 0


# ---------------------------------------------------------------------------
# Payload builder
# ---------------------------------------------------------------------------

def _build_segment(origin: str, destination: str, dep_date: date) -> list:
    """
    Build the outbound segment for the GetCalendarGraph payload.

    The calendar endpoint only needs one segment (the outbound leg).  The
    return leg is implicit — Google infers it from TripLength in the outer
    date-range block.

    Segment structure (mirrors flight.go in krisukox/google-flights-api):
        [0]  src_airports: [[[IATA, 0]]]
        [1]  dst_airports: [[[IATA, 0]]]
        [2]  time_restrictions: null
        [3]  max_stops: 0=ANY
        [4]  airline_include: []
        [5]  airline_exclude: []
        [6]  departure_date: "YYYY-MM-DD"
        [7]  max_duration: null
        [8]  selected_flight: []
        [9]  layover_airports: []
        [10] unknown: []
        [11] layover_min_dur: null
        [12] layover_max_dur: null
        [13] emissions_filter: []
        [14] classifier: 3 (outbound)
    """
    return [
        [[[origin, 0]]],           # [0] src airports
        [[[destination, 0]]],      # [1] dst airports
        None,                       # [2] time restrictions
        _STOPS_ANY,                 # [3] max stops
        [],                         # [4] airline include
        [],                         # [5] airline exclude
        dep_date.isoformat(),       # [6] departure date
        None,                       # [7] max duration
        [],                         # [8] selected flight (none)
        [],                         # [9] layover airports
        [],                         # [10]
        None,                       # [11] layover min duration
        None,                       # [12] layover max duration
        [],                         # [13] emissions filter
        3,                          # [14] classifier: outbound
    ]


def _build_main_struct(
    segment: list,
    trip_type: int,
    adults: int = 1,
) -> list:
    """
    Assemble the main filter block used in both GetShoppingResults and
    GetCalendarGraph.

    Structure:
        [0]  null
        [1]  null
        [2]  trip_type (1=ROUND, 2=ONE_WAY)
        [3]  null
        [4]  []          (price filters)
        [5]  class       (1=Economy)
        [6]  travelers   [adults, children, infants_lap, infants_seat]
        [7]  null        (price limit)
        [8-12] null
        [13] [segment]   (list of segments)
    """
    return [
        None,           # [0]
        None,           # [1]
        trip_type,      # [2]
        None,           # [3]
        [],             # [4] price filters
        _CLASS_ECONOMY, # [5] seat class
        [adults, 0, 0, 0],  # [6] travelers
        None,           # [7] price limit
        None,           # [8]
        None,           # [9]
        None,           # [10]
        None,           # [11]
        None,           # [12]
        [segment],      # [13] segments list (calendar: outbound only)
    ]


def _build_freqdata(
    origin: str,
    destination: str,
    dep_date: date,
    range_start: date,
    range_end: date,
    trip_type: int,
    trip_length: int,
    adults: int = 1,
) -> str:
    """
    Build the URL-encoded f.req value for a GetCalendarGraph POST.

    The raw (pre-encoding) inner JSON has the shape discovered in
    krisukox/google-flights-api/flights/price_graph.go::getPriceGraphReqData:

        [null, "<main_json>"],                         ← outer wrapper
                 ↑ inner string:
        [[],<main_struct>,null,null,null,1,null,null,null,null,null,[]],
        ["<range_start>","<range_end>"],
        null,
        [<trip_length>,<trip_length>]

    The Go code builds:
        prefix = `[null,"[null,`
        suffix = `],null,null,null,1,null,null,null,null,null,[]],
                  ["<range_start>","<range_end>"],null,[<tl>,<tl>]]"`
    and places the rawData (main_struct serialised without the outer list)
    between them — then wraps the whole thing in [null, "<escaped>"].

    We replicate the same structure, but using Python json.dumps so that
    special chars are properly escaped inside the string.
    """
    segment = _build_segment(origin, destination, dep_date)
    main_struct = _build_main_struct(segment, trip_type, adults)

    # Inner payload list
    inner_payload = [
        [[], main_struct, None, None, None, 1, None, None, None, None, None, []],
        [range_start.isoformat(), range_end.isoformat()],
        None,
        [trip_length, trip_length],
    ]

    # Serialise inner payload to a JSON string, then wrap it in the outer list
    inner_json_str = json.dumps(inner_payload, separators=(",", ":"))
    outer = [None, inner_json_str]
    outer_json = json.dumps(outer, separators=(",", ":"))

    return f"f.req={urllib.parse.quote(outer_json)}"


def _build_post_body(
    origin: str,
    destination: str,
    dep_date: date,
    range_start: date,
    range_end: date,
    trip_type: int,
    trip_length: int,
    adults: int = 1,
) -> str:
    """Full POST body including f.req and at= timestamp token."""
    freq = _build_freqdata(
        origin, destination, dep_date,
        range_start, range_end,
        trip_type, trip_length, adults,
    )
    ts = int(time.time())
    # The at= token format from the Go source (static prefix + unix timestamp).
    # The static prefix appears to be a base64-encoded session token that
    # Google does not validate strictly — any plausible-looking value works.
    at_token = f"AAuQa1oq5qIkgkQ2nG9vQZFTgSME%3A{ts}"
    return f"{freq}&at={at_token}&"


def _build_url(currency: str, language: str = "pt-BR") -> str:
    curr = urllib.parse.quote(currency.upper())
    return f"{_CALENDAR_URL_BASE}?{_URL_PARAMS}&hl={language}&curr={curr}&gl=BR"


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------

def _parse_wrb_response(body: str | bytes) -> list | None:
    """
    Parse the )]}' prefixed JSONP response and return the inner payload list.

    Reuses the same two-step parsing logic as gf_direct.py:
      1. Strip )]}' prefix.
      2. Try length-prefixed chunked format, then fall back to single chunk.
      3. Walk top-level rows looking for row[0]=="wrb.fr", parse row[2].
    """
    raw: bytes = body if isinstance(body, bytes) else body.encode("utf-8")
    raw = raw.lstrip()
    prefix = b")]}\'"
    if raw.startswith(prefix):
        raw = raw[len(prefix):]
    raw = raw.lstrip()
    if not raw:
        return None

    if b"0" <= raw[:1] <= b"9":
        cursor = 0
        while cursor < len(raw):
            end = raw.find(b"\n", cursor)
            if end == -1:
                break
            try:
                length = int(raw[cursor:end])
            except ValueError:
                break
            cursor = end + 1
            chunk = raw[cursor: cursor + max(length - 1, 0)]
            cursor += max(length - 1, 0)
            try:
                outer = json.loads(chunk.strip().decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                continue
            result = _extract_inner(outer)
            if result is not None:
                return result
        return None

    try:
        outer = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    return _extract_inner(outer)


def _extract_inner(outer: list) -> list | None:
    """Walk outer JSONP chunk rows and return parsed inner payload."""
    if not isinstance(outer, list):
        return None
    for row in outer:
        if not isinstance(row, list) or len(row) < 3:
            continue
        if row[0] != "wrb.fr":
            continue
        inner_str = row[2]
        if not isinstance(inner_str, str) or not inner_str:
            continue
        try:
            return json.loads(inner_str)
        except (ValueError, json.JSONDecodeError):
            continue
    return None


def _parse_calendar_offers(inner: list) -> dict[str, float]:
    """
    Parse the GetCalendarGraph inner payload into a {date_iso: price} dict.

    Inner structure (from krisukox getPriceGraphSection + priceGraphSchema):

        [null, <offers_list>]

    Each element in offers_list:
        [<start_date_str>, <return_date_str>, [[null, <price>], <token>], 1]

    For one-way searches, return_date_str may be absent or equal to start_date.
    We key on start_date (the departure date).
    """
    results: dict[str, float] = {}

    try:
        offers_list = inner[1]
    except (IndexError, TypeError):
        log.warning("gf_calendar: unexpected inner structure, inner[1] missing")
        return results

    if not isinstance(offers_list, list):
        return results

    for offer in offers_list:
        if not isinstance(offer, list) or len(offer) < 3:
            continue
        try:
            dep_date_str: str | None = offer[0]
            # offer[2] = [[null, price], token]
            price_block = offer[2]
            if not isinstance(price_block, list) or not price_block:
                continue
            inner_pair = price_block[0]
            if not isinstance(inner_pair, list) or len(inner_pair) < 2:
                continue
            price_raw = inner_pair[1]
            if not isinstance(price_raw, (int, float)) or isinstance(price_raw, bool):
                continue
            price = float(price_raw)
            if price <= 0 or dep_date_str is None:
                continue
            results[dep_date_str] = price
        except (IndexError, TypeError, ValueError):
            continue

    return results


# ---------------------------------------------------------------------------
# HTTP (sync, runs in thread)
# ---------------------------------------------------------------------------

def _post_sync(url: str, body: str, currency: str) -> str | None:
    """POST using curl_cffi with Chrome impersonation."""
    try:
        from curl_cffi import requests as curl_requests

        resp = curl_requests.post(
            url,
            data=body,
            headers={
                "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
                "accept": "*/*",
                "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
                "cache-control": "no-cache",
                "pragma": "no-cache",
                # x-goog-ext header carries feature flags + locale + currency.
                # Format: [locale, country, currency, 1, null, [tz_offset_min],
                #          null, [[...feature flags...]], 1, []]
                # Feature flag list from Go source (slightly dated but still
                # accepted; Google ignores unknown flags gracefully).
                "x-goog-ext-259736195-jspb": (
                    f'["pt-BR","BR","{currency.upper()}",1,null,[-180],null,'
                    "[[48764689,47907128,48676280,48710756,48627726,48480739,"
                    "48593234,48707380]],1,[]]"
                ),
            },
            impersonate="chrome",
            allow_redirects=True,
            timeout=60,
        )
        resp.raise_for_status()
        text = resp.text
        return text if isinstance(text, str) else text.decode("utf-8", errors="replace")
    except Exception as e:
        log.error("gf_calendar HTTP error: %s", e)
        return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def get_price_calendar(
    origin: str,
    destination: str,
    month_start: date,
    trip_type: Literal["oneway", "roundtrip"],
    currency: str = "BRL",
    trip_length_days: int = 7,
    adults: int = 1,
) -> dict[str, float]:
    """
    Return per-day prices for the given month from Google Flights' calendar view.

    Calls the GetCalendarGraph endpoint (the same data source powering the
    date-picker calendar in the Google Flights UI) with a date range spanning
    the full calendar month.

    Args:
        origin:           IATA departure airport code (e.g. "GRU").
        destination:      IATA destination airport code (e.g. "CDG").
        month_start:      First day of the month to price (e.g. date(2026, 9, 1)).
                          The day component is normalised to 1 internally.
        trip_type:        "oneway" or "roundtrip".
        currency:         ISO 4217 currency code (default "BRL").
        trip_length_days: For round-trip, the number of nights at destination.
                          Google uses this to compute the return leg price that
                          is folded into each departure-day price.
                          Ignored for one-way (set to 0 internally).
        adults:           Number of adult passengers.

    Returns:
        Dict mapping ISO date strings ("YYYY-MM-DD") to lowest available price
        (float, in the requested currency) for each day in the month.
        Days with no available flight are omitted.

    Notes:
        - No actual HTTP call is made here yet; call _fetch_calendar_raw()
          directly for testing, or drop this into the FastAPI layer.
        - The endpoint covers up to 161 days per call; a single month fits
          comfortably within that limit.
        - Prices are the cheapest total (round-trip = both legs combined).
    """
    # Normalise to first of month
    range_start = month_start.replace(day=1)
    last_day = monthrange(range_start.year, range_start.month)[1]
    range_end = range_start.replace(day=last_day)

    gf_trip_type = _TRIP_ONE_WAY if trip_type == "oneway" else _TRIP_ROUND
    effective_trip_length = _TRIP_LENGTH_ONE_WAY if trip_type == "oneway" else trip_length_days

    url = _build_url(currency)
    body = _build_post_body(
        origin=origin,
        destination=destination,
        dep_date=range_start,       # anchor date for the main_struct segment
        range_start=range_start,
        range_end=range_end,
        trip_type=gf_trip_type,
        trip_length=effective_trip_length,
        adults=adults,
    )

    log.info(
        "gf_calendar %s→%s %s/%s (%s) trip_length=%d",
        origin, destination, range_start.year, range_start.month,
        trip_type, effective_trip_length,
    )

    text = await asyncio.to_thread(_post_sync, url, body, currency)
    if not text:
        log.warning("gf_calendar: empty response for %s→%s", origin, destination)
        return {}

    inner = _parse_wrb_response(text)
    if inner is None:
        log.warning("gf_calendar: could not parse wrb.fr response")
        return {}

    prices = _parse_calendar_offers(inner)
    log.info("gf_calendar: %d prices found for %s/%s", len(prices), range_start.year, range_start.month)
    return prices


# ---------------------------------------------------------------------------
# Debug helpers (run directly: python gf_calendar.py)
# ---------------------------------------------------------------------------

def _dump_payload(
    origin: str = "GRU",
    destination: str = "CDG",
    month_start: date | None = None,
    trip_type: Literal["oneway", "roundtrip"] = "roundtrip",
    currency: str = "BRL",
    trip_length_days: int = 7,
) -> None:
    """Print the raw POST body for manual inspection / curl replay."""
    if month_start is None:
        from datetime import date as _date
        month_start = _date.today().replace(day=1)

    range_start = month_start.replace(day=1)
    last_day = monthrange(range_start.year, range_start.month)[1]
    range_end = range_start.replace(day=last_day)

    gf_trip_type = _TRIP_ONE_WAY if trip_type == "oneway" else _TRIP_ROUND
    effective_trip_length = _TRIP_LENGTH_ONE_WAY if trip_type == "oneway" else trip_length_days

    url = _build_url(currency)
    body = _build_post_body(
        origin=origin,
        destination=destination,
        dep_date=range_start,
        range_start=range_start,
        range_end=range_end,
        trip_type=gf_trip_type,
        trip_length=effective_trip_length,
    )

    print("=== URL ===")
    print(url)
    print()
    print("=== POST BODY (raw) ===")
    print(body)
    print()
    print("=== curl replay ===")
    print(
        f"curl -s -X POST '{url}' \\\n"
        f"  -H 'Content-Type: application/x-www-form-urlencoded;charset=UTF-8' \\\n"
        f"  --data-raw '{body}'"
    )


if __name__ == "__main__":
    import sys
    from datetime import date as _date

    args = sys.argv[1:]
    origin = args[0] if len(args) > 0 else "GRU"
    destination = args[1] if len(args) > 1 else "CDG"
    month_str = args[2] if len(args) > 2 else None
    month = _date.fromisoformat(month_str) if month_str else _date.today().replace(day=1)

    _dump_payload(origin, destination, month)
