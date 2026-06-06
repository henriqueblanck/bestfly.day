"""
Direct HTTP client for Google Flights round-trip search.

Reverse-engineered from punitarani/fli v0.9.0 — calls the same
FlightsFrontendService/GetShoppingResults endpoint that fli uses, but
implements the two-step round-trip expansion directly (no Playwright).

Architecture
------------
Google Flights does NOT return a complete round-trip in a single API call.
The round-trip search works as follows:
  1. First call: send a ROUND_TRIP payload with two segments (outbound +
     return), no selected_flight on either. Google returns outbound
     candidates.
  2. For each outbound candidate (top_n), fire a second call with
     segment[0].selected_flight set to that candidate. Google then
     returns return-leg candidates for that specific outbound flight.
  3. Combine (outbound, return) pairs and return the combined results.

This is exactly what fli's _expand_multi_leg() does, but we do it
without fli's models so we can tune the payload precisely and avoid
fli's round-trip parser bugs.

Wire format (from fli source)
------------------------------
POST https://www.google.com/_/FlightsFrontendUi/data/
         travel.frontend.flights.FlightsFrontendService/GetShoppingResults
     ?curr=BRL&hl=pt-BR&gl=BR

Content-Type: application/x-www-form-urlencoded;charset=UTF-8
Body: f.req=<url-encoded JSON>

The JSON has shape: [null, "<inner-json-string>"]
The inner JSON is the filters list:
  [
    [],                        # outer[0]
    [main_struct],             # outer[1] — main filter block
    sort_mode,                 # outer[2] — 1=BEST
    1,                         # outer[3] — show_all_results
    0,                         # outer[4]
    1,                         # outer[5]
  ]

main_struct[2]  = trip_type (1=ROUND_TRIP, 2=ONE_WAY)
main_struct[5]  = seat_type (1=ECONOMY)
main_struct[6]  = [adults, children, infants_lap, infants_seat]
main_struct[13] = [segment, ...]

Each segment:
  [0]  departure_airport: [[[IATA, 0]]]
  [1]  arrival_airport:   [[[IATA, 0]]]
  [2]  time_restrictions: None
  [3]  max_stops: 0=ANY, 1=NONSTOP, 2=ONE_OR_FEWER, 3=TWO_OR_FEWER
  [4]  airline include: None
  [5]  airline exclude: None
  [6]  travel_date: "YYYY-MM-DD"
  [7]  max_duration: None
  [8]  selected_flight: None or [[dep_airport, dep_date, arr_airport, None, airline, flight_no], ...]
  [9]  layover airports: None
  [10] None
  [11] layover min duration: None
  [12] layover max duration: None
  [13] emissions filter: None
  [14] classifier: 3=outbound, 1=return

Response parsing (from fli _wire.py + _decoders.py)
-----------------------------------------------------
Response is JSONP:  )]}'\n\n<chunk>
After stripping the prefix, parse the outer JSON list.
Each item with row[0]=="wrb.fr" has inner JSON at row[2].
Parse that inner JSON — it's the payload.
inner[2][0] and inner[3][0] contain the flight rows.
Each flight row:
  row[0] = detail block
  row[1] = price block: [[price_value, ...], currency_token]
  detail[0]  = airline code (string)
  detail[1]  = [airline_name, ...]
  detail[2]  = legs list
  detail[9]  = total duration minutes
  leg[3]     = departure airport code
  leg[6]     = arrival airport code
  leg[8]     = departure time [h, m]
  leg[10]    = arrival time [h, m]
  leg[20]    = departure date [y, m, d]
  leg[21]    = arrival date [y, m, d]
  leg[22]    = [airline_code, flight_number, ...]
"""
from __future__ import annotations

import asyncio
import json
import logging
import urllib.parse
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

log = logging.getLogger(__name__)

# Google Flights internal API endpoint
_BASE_URL = (
    "https://www.google.com/_/FlightsFrontendUi/data/"
    "travel.frontend.flights.FlightsFrontendService/GetShoppingResults"
)

# TripType enum values (from fli)
_TRIP_ROUND = 1
_TRIP_ONE_WAY = 2

# MaxStops mapping: max_stops param → Google's int
_STOPS = {0: 1, 1: 2, 2: 3}  # 0 stops→NON_STOP=1, 1 stop→ONE_OR_FEWER=2, 2 stops→TWO_OR_FEWER=3

# Default: ANY stops = 0
_STOPS_ANY = 0


@dataclass
class GFResult:
    price: Decimal
    currency: str = "BRL"
    airline: str = ""
    duration_minutes: int = 0
    stops: int = 0
    departure_time: str = ""
    # Per-leg breakdown (only populated for round-trip results)
    outbound_price: Decimal | None = None
    return_price: Decimal | None = None
    outbound_airline: str = ""
    return_airline: str = ""
    outbound_duration_minutes: int = 0
    return_duration_minutes: int = 0
    outbound_stops: int = 0
    return_stops: int = 0
    return_departure_time: str = ""


# ---------------------------------------------------------------------------
# Payload encoding
# ---------------------------------------------------------------------------

def _build_segment(
    origin: str,
    destination: str,
    travel_date: date,
    max_stops_val: int,
    classifier: int,
    selected_legs: list | None = None,
) -> list:
    """Build one segment entry for the Google Flights API payload."""
    return [
        [[[origin, 0]]],          # [0] departure airport
        [[[destination, 0]]],     # [1] arrival airport
        None,                      # [2] time restrictions
        max_stops_val,             # [3] max stops
        None,                      # [4] airline include
        None,                      # [5] airline exclude
        travel_date.isoformat(),   # [6] travel date
        None,                      # [7] max duration
        selected_legs,             # [8] selected flight legs (for 2nd call)
        None,                      # [9] layover airports
        None,                      # [10]
        None,                      # [11] layover min duration
        None,                      # [12] layover max duration
        None,                      # [13] emissions filter
        classifier,                # [14] 3=outbound, 1=return
    ]


def _build_payload(
    segments: list,
    trip_type: int,
    currency: str,
) -> str:
    """URL-encode the f.req body for a GetShoppingResults call."""
    main = [
        None,   # [0]
        None,   # [1]
        trip_type,
        None,   # [3]
        [],     # [4]
        1,      # [5] seat_type=ECONOMY
        [1, 0, 0, 0],  # [6] 1 adult
        None,   # [7] price limit
        None,   # [8]
        None,   # [9]
        None,   # [10] bags
        None,   # [11]
        None,   # [12]
        segments,
        None,   # [14]
        None,   # [15]
        None,   # [16]
        1,      # [17]
        None, None, None, None, None, None, None, None, None, None,  # [18-27]
        0,      # [28] exclude_basic_economy=False
    ]
    filters = [
        [],         # outer[0]
        main,       # outer[1]
        1,          # outer[2] sort_by=BEST
        1,          # outer[3] show_all_results=True
        0,          # outer[4]
        1,          # outer[5]
    ]
    inner_json = json.dumps(filters, separators=(",", ":"))
    wrapped = [None, inner_json]
    return f"f.req={urllib.parse.quote(json.dumps(wrapped, separators=(',', ':')))}"


def _build_url(currency: str) -> str:
    """Append locale params to the base URL."""
    curr = urllib.parse.quote(currency.upper())
    return f"{_BASE_URL}?curr={curr}&hl=pt-BR&gl=BR"


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------

def _parse_wrb_response(body: str) -> list | None:
    """Parse the wrb.fr JSONP response and return the first inner payload."""
    raw = body.encode("utf-8")
    # Strip )]}' prefix
    raw = raw.lstrip()
    prefix = b")]}'".encode()
    if raw.startswith(prefix):
        raw = raw[len(prefix):]
    raw = raw.lstrip()

    if not raw:
        return None

    # Try length-prefixed chunked format first
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
            chunk_bytes = max(length - 1, 0)
            payload = raw[cursor: cursor + chunk_bytes]
            cursor += chunk_bytes
            try:
                outer = json.loads(payload.strip().decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                continue
            result = _extract_inner(outer)
            if result is not None:
                return result
        return None

    # Single-chunk (no length headers)
    try:
        outer = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    return _extract_inner(outer)


def _extract_inner(outer: list) -> list | None:
    """Walk a top-level chunk list and return the first wrb.fr inner payload."""
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


def _parse_flight_rows(inner: list) -> list[dict]:
    """Extract raw flight rows from parsed inner payload."""
    try:
        flights_raw = [
            item
            for i in (2, 3)
            if isinstance(inner[i], list)
            for item in inner[i][0]
        ]
    except (IndexError, TypeError):
        return []
    return flights_raw


def _parse_price(row: list) -> Decimal | None:
    """Extract price from a flight row. Returns None if not available."""
    try:
        price_block = row[1]
        if not isinstance(price_block, list):
            return None
        head = price_block[0]
        if not isinstance(head, list) or not head:
            return None
        raw_price = head[-1]
        if isinstance(raw_price, bool) or not isinstance(raw_price, (int, float)):
            return None
        if raw_price <= 0:
            return None
        return Decimal(str(raw_price))
    except (IndexError, TypeError, Exception):
        return None


def _parse_airline(row: list) -> str:
    """Extract airline name from a flight row."""
    try:
        detail = row[0]
        # Try primary_airline_name first (detail[1][0])
        names_field = detail[1]
        if isinstance(names_field, list) and names_field:
            name = names_field[0]
            if isinstance(name, str) and name:
                return name
        # Fall back to airline code (detail[0])
        code = detail[0]
        if isinstance(code, str):
            return code
        return ""
    except (IndexError, TypeError):
        return ""


def _parse_duration(row: list) -> int:
    """Extract total duration in minutes from a flight row."""
    try:
        detail = row[0]
        dur = detail[9]
        if isinstance(dur, (int, float)) and 0 < dur <= 2880:
            return int(dur)
        return 0
    except (IndexError, TypeError):
        return 0


def _parse_stops(row: list) -> int:
    """Extract number of stops from a flight row."""
    try:
        detail = row[0]
        legs = detail[2]
        if isinstance(legs, list):
            return max(len(legs) - 1, 0)
        return 0
    except (IndexError, TypeError):
        return 0


def _parse_departure_time(row: list) -> str:
    """Extract departure time HH:MM from a flight row."""
    try:
        detail = row[0]
        legs = detail[2]
        if not isinstance(legs, list) or not legs:
            return ""
        first_leg = legs[0]
        # time is at leg[8] = [h, m]
        time_arr = first_leg[8]
        if isinstance(time_arr, list) and len(time_arr) >= 2:
            h, m = time_arr[0], time_arr[1]
            if isinstance(h, int) and isinstance(m, int):
                return f"{h:02d}:{m:02d}"
        return ""
    except (IndexError, TypeError):
        return ""


def _parse_selected_legs(row: list) -> list | None:
    """Extract selected_flight legs payload for the second round-trip API call."""
    try:
        detail = row[0]
        legs = detail[2]
        if not isinstance(legs, list) or not legs:
            return None
        selected = []
        for leg in legs:
            dep_airport = leg[3]   # IATA string
            arr_airport = leg[6]   # IATA string
            dep_date_arr = leg[20]  # [y, m, d]
            airline_info = leg[22]  # [airline_code, flight_number, ...]
            if not isinstance(dep_date_arr, list) or len(dep_date_arr) < 3:
                continue
            dep_date_str = f"{dep_date_arr[0]}-{dep_date_arr[1]:02d}-{dep_date_arr[2]:02d}"
            airline_code = ""
            flight_number = ""
            if isinstance(airline_info, list) and len(airline_info) >= 2:
                airline_code = str(airline_info[0]) if airline_info[0] else ""
                flight_number = str(airline_info[1]) if airline_info[1] else ""
            selected.append([
                dep_airport,
                dep_date_str,
                arr_airport,
                None,
                airline_code,
                flight_number,
            ])
        return selected if selected else None
    except (IndexError, TypeError):
        return None


def _row_to_gfresult(row: list, currency: str) -> GFResult | None:
    """Convert a raw flight row to GFResult. Returns None if price unavailable."""
    price = _parse_price(row)
    if price is None:
        return None
    return GFResult(
        price=price,
        currency=currency,
        airline=_parse_airline(row),
        duration_minutes=_parse_duration(row),
        stops=_parse_stops(row),
        departure_time=_parse_departure_time(row),
    )


# ---------------------------------------------------------------------------
# HTTP calls
# ---------------------------------------------------------------------------

def _post_sync(url: str, body: str) -> str | None:
    """Synchronous POST using curl_cffi with Chrome impersonation."""
    try:
        from curl_cffi import requests as curl_requests
        resp = curl_requests.post(
            url,
            data=body,
            headers={"content-type": "application/x-www-form-urlencoded;charset=UTF-8"},
            impersonate="chrome",
            allow_redirects=True,
            timeout=60,
        )
        resp.raise_for_status()
        return resp.text
    except Exception as e:
        log.error("gf_direct HTTP error: %s", e)
        return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def search_round_trip(
    origin: str,
    destination: str,
    outbound_date: date,
    return_date: date,
    max_stops: int = 1,
    currency: str = "BRL",
    top_n: int = 10,
) -> list[GFResult]:
    """
    Search Google Flights for round-trip using direct HTTP (no Playwright).

    Uses fli's two-step approach:
    1. First call returns outbound candidates.
    2. For each outbound (up to top_n), a second call returns return candidates.
    3. We combine pairs and return sorted by total price.

    Args:
        origin: IATA departure airport code (e.g. "GRU")
        destination: IATA destination airport code (e.g. "CDG")
        outbound_date: Departure date
        return_date: Return date
        max_stops: Maximum stops per leg (0=nonstop, 1=1 stop, 2=2 stops)
        currency: ISO 4217 currency code
        top_n: Number of outbound candidates to expand (more = slower but more results)

    Returns:
        List of GFResult sorted by price ascending. Each result represents
        a complete round-trip (price is TOTAL for both legs).
    """
    stops_val = _STOPS.get(max_stops, _STOPS_ANY)
    url = _build_url(currency)

    # Step 1: get outbound candidates
    log.info("gf_direct step1 outbound %s→%s %s", origin, destination, outbound_date)
    outbound_rows = await asyncio.to_thread(
        _fetch_flight_rows,
        url=url,
        origin=origin,
        destination=destination,
        outbound_date=outbound_date,
        return_date=return_date,
        stops_val=stops_val,
        selected_legs=None,
        trip_type=_TRIP_ROUND,
    )
    if not outbound_rows:
        log.warning("gf_direct step1 returned 0 rows for %s→%s", origin, destination)
        return []

    log.info("gf_direct step1 got %d outbound rows", len(outbound_rows))

    # Step 2: for each outbound, get return candidates in parallel
    candidates = outbound_rows[:top_n]

    async def expand_one(out_row: list) -> list[GFResult]:
        selected_legs = _parse_selected_legs(out_row)
        if not selected_legs:
            return []

        out_result = _row_to_gfresult(out_row, currency)
        if out_result is None:
            return []

        ret_rows = await asyncio.to_thread(
            _fetch_flight_rows,
            url=url,
            origin=destination,       # return leg: destination → origin
            destination=origin,
            outbound_date=return_date,
            return_date=outbound_date,  # not used in return segment
            stops_val=stops_val,
            selected_legs=selected_legs,
            trip_type=_TRIP_ROUND,
        )
        if not ret_rows:
            return []

        results: list[GFResult] = []
        for ret_row in ret_rows[:top_n]:
            ret_result = _row_to_gfresult(ret_row, currency)
            if ret_result is None:
                continue
            combined = GFResult(
                price=out_result.price + ret_result.price,
                currency=currency,
                airline=out_result.airline or ret_result.airline,
                duration_minutes=out_result.duration_minutes + ret_result.duration_minutes,
                stops=max(out_result.stops, ret_result.stops),
                departure_time=out_result.departure_time,
                outbound_price=out_result.price,
                return_price=ret_result.price,
                outbound_airline=out_result.airline,
                return_airline=ret_result.airline,
                outbound_duration_minutes=out_result.duration_minutes,
                return_duration_minutes=ret_result.duration_minutes,
                outbound_stops=out_result.stops,
                return_stops=ret_result.stops,
                return_departure_time=ret_result.departure_time,
            )
            results.append(combined)
        return results

    # Run all expansions concurrently
    expansions = await asyncio.gather(*[expand_one(row) for row in candidates])

    # Flatten and deduplicate by price
    all_results: list[GFResult] = []
    seen_prices: set[Decimal] = set()
    for batch in expansions:
        for r in batch:
            if r.price not in seen_prices:
                seen_prices.add(r.price)
                all_results.append(r)

    all_results.sort(key=lambda x: x.price)
    log.info("gf_direct round-trip %s↔%s: %d results", origin, destination, len(all_results))
    return all_results[:top_n]


def _fetch_flight_rows(
    *,
    url: str,
    origin: str,
    destination: str,
    outbound_date: date,
    return_date: date,
    stops_val: int,
    selected_legs: list | None,
    trip_type: int,
) -> list:
    """
    Issue one GetShoppingResults HTTP call and return raw flight rows.

    For the first call (selected_legs=None): returns outbound candidates.
    For the second call (selected_legs set): returns return candidates
      for that specific outbound flight.
    """
    if selected_legs is None:
        # First call: two segments, no selected_flight
        # Outbound: classifier=3, Return: classifier=1
        segments = [
            _build_segment(origin, destination, outbound_date, stops_val, 3, None),
            _build_segment(destination, origin, return_date, stops_val, 1, None),
        ]
    else:
        # Second call: outbound segment has selected_legs, return segment is new
        segments = [
            _build_segment(origin, destination, outbound_date, stops_val, 3, selected_legs),
            _build_segment(destination, origin, return_date, stops_val, 1, None),
        ]

    body = _build_payload(segments, trip_type, url)  # url contains currency
    text = _post_sync(url, body)
    if not text:
        return []

    inner = _parse_wrb_response(text)
    if inner is None:
        log.warning("gf_direct: could not parse wrb.fr response")
        return []

    rows = _parse_flight_rows(inner)
    log.debug("gf_direct _fetch_flight_rows: %d raw rows", len(rows))
    return rows
