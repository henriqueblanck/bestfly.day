"""SQLite price cache + history."""
import sqlite3
import logging
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal
from pathlib import Path

log = logging.getLogger(__name__)

DB_PATH = Path("/data/bestfly.db")
CACHE_TTL_HOURS = 6


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS price_cache (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                origin          TEXT NOT NULL,
                destination     TEXT NOT NULL,
                flight_date     TEXT NOT NULL,
                price           REAL NOT NULL,
                currency        TEXT NOT NULL DEFAULT 'BRL',
                airline         TEXT,
                duration_minutes INTEGER,
                connections     INTEGER,
                offer_id        TEXT,
                departure_time  TEXT,
                searched_at     TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_route
                ON price_cache(origin, destination, flight_date, searched_at);
            CREATE TABLE IF NOT EXISTS hub_wins (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                origin      TEXT NOT NULL,
                destination TEXT NOT NULL,
                flight_date TEXT NOT NULL,
                hub         TEXT NOT NULL,
                price       REAL NOT NULL,
                recorded_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_hub_wins ON hub_wins(hub, recorded_at);
        """)
        # Migrate existing DBs that predate the departure_time column
        try:
            conn.execute("ALTER TABLE price_cache ADD COLUMN departure_time TEXT")
        except Exception:
            pass
    log.info("DB initialised at %s", DB_PATH)


def get_cached(origin: str, destination: str, flight_date: date) -> list[dict] | None:
    """Return cached slices if still fresh, else None."""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=CACHE_TTL_HOURS)).isoformat()
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM price_cache
            WHERE origin = ? AND destination = ? AND flight_date = ?
              AND searched_at >= ?
            ORDER BY price ASC
            """,
            (origin, destination, flight_date.isoformat(), cutoff),
        ).fetchall()
    if not rows:
        return None
    return [dict(r) for r in rows]


def save_slices(
    origin: str,
    destination: str,
    flight_date: date,
    slices: list[dict],
) -> None:
    """Persist a batch of slices from a fresh fli search."""
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.executemany(
            """
            INSERT INTO price_cache
                (origin, destination, flight_date, price, currency, airline,
                 duration_minutes, connections, offer_id, departure_time, searched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    origin,
                    destination,
                    flight_date.isoformat(),
                    s["price"],
                    s.get("currency", "BRL"),
                    s.get("airline", ""),
                    s.get("duration_minutes", 0),
                    s.get("connections", 0),
                    s.get("offer_id", ""),
                    s.get("departure_time", ""),
                    now,
                )
                for s in slices
            ],
        )


def get_bulk_stats(routes: list[tuple[str, str, str]], days_back: int = 60) -> dict[str, dict]:
    """
    Bulk historical price stats for multiple routes.
    routes: list of (origin, dest, flight_date_iso)
    Returns: {"origin|dest|date": {avg_price, min_price, trend, observations}}
    """
    if not routes:
        return {}

    cutoff_all = (datetime.now(timezone.utc) - timedelta(days=days_back)).isoformat()
    cutoff_recent = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

    or_clauses = " OR ".join(
        "(origin = ? AND destination = ? AND flight_date = ?)" for _ in routes
    )
    route_params = [x for r in routes for x in r]

    with _connect() as conn:
        rows = conn.execute(
            f"""
            SELECT origin, destination, flight_date,
                   AVG(price) as avg_price,
                   MIN(price) as min_price,
                   AVG(CASE WHEN searched_at >= ? THEN price ELSE NULL END) as recent_avg,
                   AVG(CASE WHEN searched_at < ? THEN price ELSE NULL END) as older_avg,
                   COUNT(*) as obs,
                   COUNT(CASE WHEN searched_at >= ? THEN 1 END) as recent_obs,
                   COUNT(CASE WHEN searched_at < ? THEN 1 END) as older_obs
            FROM price_cache
            WHERE searched_at >= ?
              AND ({or_clauses})
            GROUP BY origin, destination, flight_date
            """,
            [cutoff_recent, cutoff_recent, cutoff_recent, cutoff_recent, cutoff_all] + route_params,
        ).fetchall()

    result = {}
    for row in rows:
        key = f"{row['origin']}|{row['destination']}|{row['flight_date']}"
        trend = "stable"
        if row["recent_obs"] >= 2 and row["older_obs"] >= 2 and row["recent_avg"] and row["older_avg"]:
            pct = (row["recent_avg"] - row["older_avg"]) / row["older_avg"]
            if pct > 0.05:
                trend = "up"
            elif pct < -0.05:
                trend = "down"
        result[key] = {
            "avg_price": row["avg_price"],
            "min_price": row["min_price"],
            "trend": trend,
            "observations": row["obs"],
        }
    return result


def record_hub_wins(wins: list[dict]) -> None:
    """Batch-record which hub won for each origin/dest/date combo."""
    if not wins:
        return
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.executemany(
            "INSERT INTO hub_wins (origin, destination, flight_date, hub, price, recorded_at) VALUES (?,?,?,?,?,?)",
            [(w["origin"], w["destination"], w["flight_date"], w["hub"], w["price"], now) for w in wins],
        )


def get_hub_win_rates(days_back: int = 30) -> list[dict]:
    """Hub leaderboard: which hubs win most often."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days_back)).isoformat()
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT hub, COUNT(*) as wins, AVG(price) as avg_win_price,
                   COUNT(DISTINCT origin || '|' || destination) as unique_routes
            FROM hub_wins
            WHERE recorded_at >= ?
            GROUP BY hub
            ORDER BY wins DESC
            LIMIT 20
            """,
            (cutoff,),
        ).fetchall()
    return [dict(r) for r in rows]


def price_history(
    origin: str,
    destination: str,
    flight_date: date,
    days_back: int = 30,
) -> list[dict]:
    """Return daily min prices for a route/date for the last N days."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days_back)).isoformat()
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT DATE(searched_at) as day, MIN(price) as min_price, currency
            FROM price_cache
            WHERE origin = ? AND destination = ? AND flight_date = ?
              AND searched_at >= ?
            GROUP BY day, currency
            ORDER BY day
            """,
            (origin, destination, flight_date.isoformat(), cutoff),
        ).fetchall()
    return [dict(r) for r in rows]
