#!/usr/bin/env python3
"""
Batch parser: load all lines from /var/log/router.log into net_sentinel.db.
Uses parser_utils for parsing, enrichment, and DB insertion.
Shows progress with tqdm.
"""

import os
from tqdm import tqdm
from parser_utils import parse_log_line, enrich_event, insert_events

LOG_FILE = "/var/log/router.log"
BATCH_SIZE = 1000

def main():
    if not os.path.exists(LOG_FILE):
        print(f"[batch_parser] {LOG_FILE} not found or not readable.")
        return

    batch = []
    inserted = 0

    # Count lines for progress bar
    try:
        total_lines = sum(1 for _ in open(LOG_FILE, "r", encoding="utf-8", errors="replace"))
    except Exception as e:
        print(f"[batch_parser] Error reading {LOG_FILE}: {e}")
        return

    with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as f:
        for line in tqdm(f, total=total_lines, desc="Parsing router.log", unit="line"):
            parsed = parse_log_line(line)
            if not parsed:
                continue
            event = enrich_event(parsed)
            batch.append(event)

            if len(batch) >= BATCH_SIZE:
                insert_events(batch)
                inserted += len(batch)
                batch = []

    if batch:
        insert_events(batch)
        inserted += len(batch)

    print(f"[batch_parser] ✅ Inserted {inserted} events from {LOG_FILE}")

if __name__ == "__main__":
    main()
