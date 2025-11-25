#!/usr/bin/env python3
"""
Live parser: tail /var/log/router.log and insert new lines into net_sentinel.db in real time.
Uses parser_utils for parsing, enrichment, and DB insertion.
"""

import os, time
from parser_utils import parse_log_line, enrich_event, insert_events

LOG_FILE = "/var/log/router.log"

def main():
    if not os.path.exists(LOG_FILE):
        print(f"[live_parser] {LOG_FILE} not found.")
        return

    print(f"[live_parser] Watching {LOG_FILE} for new lines...")

    batch = []
    with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as f:
        f.seek(0, os.SEEK_END)  # start at end of file
        while True:
            line = f.readline()
            if not line:
                time.sleep(0.5)
                continue

            parsed = parse_log_line(line)
            if not parsed:
                continue
            event = enrich_event(parsed)
            batch.append(event)

            if len(batch) >= 100:  # smaller batch for live mode
                insert_events(batch)
                batch = []

            # flush immediately if needed
            if batch:
                insert_events(batch)
                batch = []

if __name__ == "__main__":
    main()

