#!/usr/bin/env python3
"""
Batch parser: load all lines from /var/log/router.log into net_sentinel.db.
Uses parser_utils for parsing, enrichment, and DB insertion.
"""

import os
from parser_utils import parse_log_line, enrich_event, insert_events

LOG_FILE = "/var/log/router.log"

def main():
    if not os.path.exists(LOG_FILE):
        print(f"[batch_parser] {LOG_FILE} not found.")
        return

    batch = []
    inserted = 0

    with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            parsed = parse_log_line(line)
            if not parsed:
                continue
            event = enrich_event(parsed)
            batch.append(event)

            if len(batch) >= 1000:  # batch size
                insert_events(batch)
                inserted += len(batch)
                batch = []

    if batch:
        insert_events(batch)
        inserted += len(batch)

    print(f"[batch_parser] Inserted {inserted} events from {LOG_FILE}")

if __name__ == "__main__":
    main()

