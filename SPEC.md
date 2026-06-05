# Flight Price Matrix — Technical Specification

## Overview

Split-ticketing intelligence engine that anchors cheap transatlantic flights
to a European hub and combines them with intra-EU low-cost carriers to produce
a date × destination price matrix.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        Client (React)                   │
│   SearchForm → MatrixHeatmap (dates × destinations)     │
└────────────────────────┬────────────────────────────────┘
                         │ POST /api/search
┌────────────────────────▼────────────────────────────────┐
│                   FastAPI Backend                        │
│                                                         │
│  SearchRouter                                           │
│     └── SplitTicketingEngine                           │
│            ├── Step A: LongHaulFetcher  ─┐             │
│            │   (Origins → Hubs)          │ asyncio      │
│            └── Step B: IntraEUFetcher  ─┤ gather()     │
│                (Hubs → Destinations)     │             │
│                                          ▼             │
│            MatrixBuilder.combine()  [semaphore N=20]   │
│            → matrix[origin][dest][date] = MinPrice     │
└────────────────────────┬────────────────────────────────┘
                         │
              ┌──────────▼──────────┐
              │    Duffel API v2    │
              │  /batch_offer_reqs  │
              └─────────────────────┘
```

---

## Tech Stack

| Layer     | Choice                  | Reason                                   |
|-----------|-------------------------|------------------------------------------|
| Backend   | Python 3.11 + FastAPI   | Native asyncio, great for I/O concurrency|
| HTTP      | httpx (AsyncClient)     | async-first, connection pooling built-in |
| Task Queue| asyncio.gather + Semaphore | No infra needed; handles 200 req burst|
| Frontend  | React + Vite            | Fast dev; recharts for heatmap           |
| Hosting   | Any ASGI (uvicorn)      | Single process, async handles load       |

---

## Data Model

```python
# Input
SearchRequest:
  origins: list[str]          # ["GRU", "BSB"] — max 2
  destinations: list[str]     # ["BCN", "LIS", "CDG", ...] — max 10
  hubs: list[str]             # ["MAD", "LIS"] — transatlantic anchors
  date_from: date             # 2025-07-01
  date_to: date               # 2025-07-10
  max_connections: int = 1
  max_duration_hours: int = 20

# Internal
OfferSlice:
  origin: str
  destination: str
  date: date
  price: Decimal
  currency: str
  offer_id: str
  duration_minutes: int

# Output
MatrixEntry:
  total_price: Decimal
  longhaul_price: Decimal
  intraeu_price: Decimal
  hub: str
  currency: str

matrix: dict[origin, dict[destination, dict[date_iso, MatrixEntry]]]
```

---

## Concurrency Model

```
200 total requests
= 2 origins × 10 hubs × 10 days (Step A)
+ N hubs × 10 destinations × 10 days (Step B)

Semaphore(20) → ~10s wall-clock at typical Duffel latency (~2s/req)
```

Backoff strategy: exponential (1s, 2s, 4s) on 429, max 3 retries.

---

## Duffel Batch Flow

1. POST `/air/batch_offer_requests` → get `batch_id`
2. Poll GET `/air/batch_offer_requests/{batch_id}` every 2s until `status=complete`
3. Extract `offers[]` → pick lowest `total_amount` per slice

---

## API Endpoints

```
POST /api/search        → trigger matrix computation (returns job_id)
GET  /api/search/{id}   → poll job status + partial/final matrix
GET  /api/health        → uptime check
```

---

## Modularity Points

- `DuffelClient` is behind an abstract `PricingSource` protocol → swap to Amadeus/Skyscanner later
- `MatrixBuilder.combine()` accepts a `markup_fn` callback → margin calc plugin
- `SplitTicketingEngine` emits progress events → SSE for live matrix updates (future)

---

## Environment Variables

```env
DUFFEL_API_TOKEN=duffel_live_...
DUFFEL_API_BASE=https://api.duffel.com
CONCURRENCY_LIMIT=20
MAX_RETRIES=3
POLL_INTERVAL_SECONDS=2
POLL_TIMEOUT_SECONDS=60
```
