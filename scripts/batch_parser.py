#!/usr/bin/env python3
"""
Batch parser: load lines from the trimmed project logs into net_sentinel.db.
- By default reads [project]/logs/router.log (7-day working file).
- Use --use-30 or set USE_30=1 to read [project]/logs/last30router.log (30-day archive).
- You can also override the input file with --log-file.
Uses parser_utils for parsing, enrichment, and DB insertion.
Shows progress with tqdm.
"""

import os
import argparse
from tqdm import tqdm
from parser_utils import parse_log_line, enrich_event, insert_events

# Project-aware defaults
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGS_DIR = os.path.join(PROJECT_ROOT, "logs")
DEFAULT_LOG_7 = os.path.join(LOGS_DIR, "router.log")
DEFAULT_LOG_30 = os.path.join(LOGS_DIR, "last30router.log")

BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "1000"))

def parse_args():
    p = argparse.ArgumentParser(description="Batch parse router logs into net_sentinel.db")
    p.add_argument("--use-30", action="store_true",
                   help="Read the 30-day archive ([project]/logs/last30router.log) instead of the 7-day working log")
    p.add_argument("--log-file", type=str, default=None,
                   help="Explicit log file to read (overrides --use-30 and defaults)")
    p.add_argument("--batch-size", type=int, default=None,
                   help="Override batch size for inserts")
    return p.parse_args()

def main():
    args = parse_args()

    # Allow env var to force 30-day file
    env_use_30 = os.environ.get("USE_30", "") not in ("", "0", "false", "False")
    use_30 = args.use_30 or env_use_30

    # Determine which file to read
    if args.log_file:
        log_file = args.log_file
    else:
        log_file = DEFAULT_LOG_30 if use_30 else DEFAULT_LOG_7

    # Choose target DB table based on whether we're processing 30-day archive
    target_table = "ip_events_30" if use_30 else "ip_events"

    batch_size = args.batch_size if args.batch_size and args.batch_size > 0 else BATCH_SIZE

    if not os.path.exists(log_file):
        print(f"[batch_parser] {log_file} not found or not readable.")
        return

    batch = []
    inserted = 0

    # Count lines for progress bar
    try:
        with open(log_file, "r", encoding="utf-8", errors="replace") as fh:
            total_lines = sum(1 for _ in fh)
    except Exception as e:
        print(f"[batch_parser] Error reading {log_file}: {e}")
        return

    try:
        with open(log_file, "r", encoding="utf-8", errors="replace") as f:
            for line in tqdm(f, total=total_lines, desc=f"Parsing {os.path.basename(log_file)}", unit="line"):
                parsed = parse_log_line(line)
                if not parsed:
                    continue
                event = enrich_event(parsed)
                batch.append(event)

                if len(batch) >= batch_size:
                    insert_events(batch, table=target_table)
                    inserted += len(batch)
                    batch = []

        if batch:
            insert_events(batch, table=target_table)
            inserted += len(batch)

        print(f"[batch_parser] ✅ Inserted {inserted} events from {log_file} into {target_table}")

    except Exception as e:
        print(f"[batch_parser] Error during parsing/insertion: {e}")

if __name__ == "__main__":
    main()
