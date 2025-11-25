#!/usr/bin/env python3
"""
Live parser: tail /var/log/router.log and insert new lines into net_sentinel.db in real time.
- Uses schema.sql to initialize the database schema if needed.
- Keeps running continuously, watching for new lines appended to router.log.
"""

import os
import sqlite3
import time
from datetime import datetime, timezone

# Resolve project root (parent of scrips/)
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

LOG_FILE = "/var/log/router.log"
DB_FILE = os.path.join(PROJECT_ROOT, "net_sentinel.db")
SCHEMA_FILE = os.path.join(PROJECT_ROOT, "schema.sql")

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
        return None

    ts_str = parts[0]
    verdict = parts[1]
    proto = parts[2]

    src_ip, src_port = (parts[3].split(":") + ["0"])[:2]
    dst_ip, dst_port = (parts[4].split(":") + ["0"])[:2]

    direction = parts[5]
    country = parts[6] if len(parts) > 6 else None
    state = parts[7] if len(parts) > 7 else None
    city = parts[8] if len(parts) > 8 else None

    try:
        if ts_str.endswith("Z"):
            ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        else:
            ts = datetime.fromisoformat(ts_str)
        ts = ts.astimezone(timezone.utc).isoformat()
    except Exception:
        ts = ts_str

    return (ts, verdict, proto, src_ip, int(src_port), dst_ip, int(dst_port), direction, country, state, city)

def main():
    conn = sqlite3.connect(DB_FILE)
    init_db(conn)
    cur = conn.cursor()

    # Open log file and seek to end
    with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as f:
        f.seek(0, os.SEEK_END)
        print(f"[live_parser] Watching {LOG_FILE} for new lines...")

        while True:
            line = f.readline()
            if not line:
                time.sleep(0.5)
                continue

            fields = parse_line(line)
            if not fields:
                continue

            cur.execute("""
                INSERT INTO events (
                    timestamp, verdict, proto, src_ip, src_port,
                    dst_ip, dst_port, direction, country, state, city
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, fields)
            conn.commit()
            print(f"[live_parser] Inserted event: {fields}")

if __name__ == "__main__":
    main()
