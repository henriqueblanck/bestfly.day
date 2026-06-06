"""
Google Flights Playwright scraper.
Used for round-trip searches where fli is unreliable.
"""
from __future__ import annotations
import asyncio
import logging
import re
from datetime import date
from decimal import Decimal, InvalidOperation
from dataclasses import dataclass

log = logging.getLogger(__name__)

_RETRY_ATTEMPTS = 2


@dataclass
class GFResult:
    price: Decimal
    currency: str = "BRL"
    airline: str = ""
    duration_minutes: int = 0
    stops: int = 0
    departure_time: str = ""


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
    Search Google Flights round-trip via Playwright browser.
    Returns results sorted by price ascending.
    """
    url = (
        f"https://www.google.com/travel/flights?q=flights+from+{origin}+to+{destination}"
        f"+on+{outbound_date.isoformat()}+returning+{return_date.isoformat()}"
        f"&curr={currency}&hl=pt-BR"
    )
    for attempt in range(_RETRY_ATTEMPTS):
        try:
            return await _scrape(url, currency, top_n)
        except Exception as e:
            log.warning("gf_scraper attempt %d failed: %s", attempt + 1, e)
            if attempt < _RETRY_ATTEMPTS - 1:
                await asyncio.sleep(3)
    return []


async def search_one_way(
    origin: str,
    destination: str,
    departure_date: date,
    max_stops: int = 1,
    currency: str = "BRL",
    top_n: int = 10,
) -> list[GFResult]:
    """
    Search Google Flights one-way via Playwright browser.
    """
    url = (
        f"https://www.google.com/travel/flights?q=flights+from+{origin}+to+{destination}"
        f"+on+{departure_date.isoformat()}"
        f"&curr={currency}&hl=pt-BR"
    )
    for attempt in range(_RETRY_ATTEMPTS):
        try:
            return await _scrape(url, currency, top_n)
        except Exception as e:
            log.warning("gf_scraper one-way attempt %d failed: %s", attempt + 1, e)
            if attempt < _RETRY_ATTEMPTS - 1:
                await asyncio.sleep(3)
    return []


async def _scrape(url: str, currency: str, top_n: int) -> list[GFResult]:
    from playwright.async_api import async_playwright

    results: list[GFResult] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
            ],
        )
        context = await browser.new_context(
            viewport={"width": 1280, "height": 900},
            locale="pt-BR",
            extra_http_headers={"Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8"},
            user_agent=(
                "Mozilla/5.0 (X11; Linux x86_64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
        )
        page = await context.new_page()

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=40000)

            # Wait for flight list items to appear
            try:
                await page.wait_for_selector(
                    'li[data-id], ul[role="list"] li, [jsname="IWWDBc"] li',
                    timeout=20000,
                )
            except Exception:
                # Try waiting a bit and proceed anyway
                await page.wait_for_timeout(5000)

            await page.wait_for_timeout(2000)

            # Extract flight cards text using JS — more reliable than CSS selectors
            texts: list[str] = await page.evaluate("""
                () => {
                    // Try several known list structures Google Flights uses
                    const selectors = [
                        'li[data-id]',
                        'ul[role="list"] > li',
                        '[jsname="IWWDBc"] li',
                        '[role="listitem"]',
                    ];
                    for (const sel of selectors) {
                        const els = Array.from(document.querySelectorAll(sel));
                        const texts = els
                            .map(el => el.innerText)
                            .filter(t => t && t.length > 20);
                        if (texts.length > 0) return texts.slice(0, 30);
                    }
                    // Fallback: all list items containing a price
                    const all = Array.from(document.querySelectorAll('li'));
                    return all
                        .map(el => el.innerText)
                        .filter(t => t && /R\$\s*[\d.,]/.test(t) && t.length > 20)
                        .slice(0, 30);
                }
            """)

            for text in texts:
                result = _parse(text, currency)
                if result:
                    results.append(result)

        finally:
            await browser.close()

    seen_prices: set[Decimal] = set()
    unique: list[GFResult] = []
    for r in sorted(results, key=lambda x: x.price):
        if r.price not in seen_prices:
            seen_prices.add(r.price)
            unique.append(r)
        if len(unique) >= top_n:
            break

    log.info("gf_scraper %s results for %s", len(unique), url[:80])
    return unique


def _parse(text: str, currency: str) -> GFResult | None:
    """Parse a flight card text block into a GFResult."""
    if not text or len(text) < 10:
        return None

    # Price: R$ 3.207 or R$3.207,50
    price_match = re.search(r'R\$\s*([\d.,]+)', text)
    if not price_match:
        return None

    raw = price_match.group(1).strip()
    # Handle Brazilian number format: 3.207,50 → 3207.50
    if ',' in raw and '.' in raw:
        raw = raw.replace('.', '').replace(',', '.')
    elif ',' in raw:
        raw = raw.replace(',', '.')
    else:
        raw = raw.replace('.', '')

    try:
        price = Decimal(raw)
    except InvalidOperation:
        return None

    if price < 200 or price > 200_000:
        return None

    # Duration: 12 h 30 min or 12h30min
    dur_match = re.search(r'(\d{1,3})\s*h\s*(\d{1,2})\s*min', text, re.IGNORECASE)
    duration_min = 0
    if dur_match:
        h, m = int(dur_match.group(1)), int(dur_match.group(2))
        duration_min = h * 60 + m
        if duration_min > 2880:  # sanity cap 48h
            duration_min = 0

    # Stops
    stops = 0
    if re.search(r'escala|conexão|parada|stop', text, re.IGNORECASE):
        m2 = re.search(r'(\d+)\s+(?:escala|conexão|parada|stop)', text, re.IGNORECASE)
        stops = int(m2.group(1)) if m2 else 1

    # Departure time: first HH:MM in text
    time_match = re.search(r'\b(\d{1,2}:\d{2})\b', text)
    dep_time = time_match.group(1) if time_match else ""

    # Airline: first non-numeric, non-time, non-price line that looks like a name
    airline = ""
    for line in text.split('\n'):
        line = line.strip()
        if not line or len(line) < 2:
            continue
        if re.search(r'R\$|h\s*\d+\s*min|\d+:\d+|escala|conexão|direto|sem escala', line, re.IGNORECASE):
            continue
        if re.match(r'^\d', line):
            continue
        if len(line) <= 60:
            airline = line
            break

    return GFResult(
        price=price,
        currency=currency,
        airline=airline,
        duration_minutes=duration_min,
        stops=stops,
        departure_time=dep_time,
    )
