#!/usr/bin/env python3
"""
Batch parser: read all lines from router.log and insert them into net_sentinel.db.
- Assumes each line begins with an ISO-8601 timestamp followed by router log fields.
- Uses schema.sql to initialize the database schema if needed.
"""

import os
import sqlite3
from datetime import datetime, timezone

# Config
LOG_FILE = os.environ.get("ROUTER_LOG", "router.log")
DB_FILE = os.environ.get("NET_SENTINEL_DB", "net_sentinel.db")
SCHEMA_FILE = os.environ.get("SCHEMA_FILE", "schema.sql")

def init_db(conn):
    """Initialize DB schema from schema.sql if tables are missing."""
    with open(SCHEMA_FILE, "r", encoding="utf-8") as f:
        schema_sql = f.read()
    conn.executescript(schema_sql)
    conn.commit()

def parse_line(line: str):
    """
    Parse a router.log line into fields.
    Expected format (example):
      2025-11-25T18:00:00Z DROP TCP 192.168.1.10:12345 8.8.8.8:53 OUTBOUND US NY Albany
    Returns a tuple matching the events table schema.
    """
    parts = line.strip().split()
    if len(parts) < 6:
        return None  # skip malformed lines

    ts_str = parts[0]
    verdict = parts[1]
    proto = parts[2]

    # src_ip:src_port
    src_ip, src_port = (parts[3].split(":") + ["0"])[:2]
    # dst_ip:dst_port
    dst_ip, dst_port = (parts[4].split(":") + ["0"])[:2]

    direction = parts[5]
    country = parts[6] if len(parts) > 6 else None
    state = parts[7] if len(parts) > 7 else None
    city = parts[8] if len(parts) > 8 else None

    # Normalize timestamp
    try:
        if ts_str.endswith("Z"):
            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        else:
            ts = datetime.fromisoformat(ts_str)
        ts = ts.astimezone(timezone.utc).isoformat()
    except Exception:
        ts = ts_str  # keep raw if parsing fails

    return (ts, verdict, proto, src_ip, int(src_port), dst_ip, int(dst_port), direction, country, state, city)

def main():
    if not os.path.exists(LOG_FILE):
        print(f"[batch_parser] {LOG_FILE} not found.")
        return

    conn = sqlite3.connect(DB_FILE)
    init_db(conn)
    cur = conn.cursor()

    inserted = 0
    with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            fields = parse_line(line)
            if not fields:
                continue
            cur.execute("""
                INSERT INTO events (
                    timestamp, verdict, proto, src_ip, src_port,
                    dst_ip, dst_port, direction, country, state, city
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, fields)
            inserted += 1

    conn.commit()
    conn.close()
    print(f"[batch_parser] Inserted {inserted} events from {LOG_FILE} into {DB_FILE}")

if __name__ == "__main__":
    main()
