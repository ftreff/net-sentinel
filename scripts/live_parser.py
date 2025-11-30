#!/usr/bin/env python3
"""
Live parser: tail system or project router logs and insert new lines into net_sentinel.db in real time.
- By default reads /var/log/router.log (system live log)
- Use --use-30 or set USE_30=1 to read [project]/logs/last30router.log (30-day archive)
- Supports --log-file to override
- Handles log rotation by reopening file when inode/size changes
- Batches inserts to reduce DB pressure and flushes periodically on idle
"""

import os
import time
import argparse
from datetime import datetime, timezone
from parser_utils import parse_log_line, enrich_event, insert_events

# Project-aware defaults
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGS_DIR = os.path.join(PROJECT_ROOT, "logs")
# Use system live router log by default
DEFAULT_LOG_7 = "/var/log/router.log"
# 30-day archive remains in project logs
DEFAULT_LOG_30 = os.path.join(LOGS_DIR, "last30router.log")

DEFAULT_BATCH_SIZE = int(os.environ.get("LIVE_BATCH_SIZE", "100"))
IDLE_FLUSH_SECONDS = float(os.environ.get("LIVE_IDLE_FLUSH", "2.0"))
SLEEP_INTERVAL = float(os.environ.get("LIVE_SLEEP_INTERVAL", "0.5"))

def parse_args():
    p = argparse.ArgumentParser(description="Live tail parser for router logs")
    p.add_argument("--use-30", action="store_true",
                   help="Read the 30-day archive ([project]/logs/last30router.log) instead of the system live log")
    p.add_argument("--log-file", type=str, default=None,
                   help="Explicit log file to read (overrides --use-30 and defaults)")
    p.add_argument("--batch-size", type=int, default=None,
                   help="Override batch size for inserts")
    return p.parse_args()

def open_log(path):
    """Open file and return (fileobj, inode, position)."""
    f = open(path, "r", encoding="utf-8", errors="replace")
    try:
        st = os.fstat(f.fileno())
        inode = (st.st_ino, st.st_dev)
    except Exception:
        inode = None
    # Seek to end to behave like tail -f
    f.seek(0, os.SEEK_END)
    pos = f.tell()
    return f, inode, pos

def file_changed(path, last_inode, last_pos):
    """Detect rotation/truncation by inode or file size smaller than last_pos."""
    try:
        st = os.stat(path)
        inode = (st.st_ino, st.st_dev)
        size = st.st_size
        if last_inode is None:
            return False
        if inode != last_inode:
            return True
        if size < last_pos:
            return True
        return False
    except Exception:
        return True
        
def main():
    args = parse_args()
    env_use_30 = os.environ.get("USE_30", "") not in ("", "0", "false", "False")
    use_30 = args.use_30 or env_use_30

    if args.log_file:
        log_file = args.log_file
    else:
        # If use_30 is requested, read the project 30-day archive; otherwise read system live log
        log_file = DEFAULT_LOG_30 if use_30 else DEFAULT_LOG_7

    batch_size = args.batch_size if args.batch_size and args.batch_size > 0 else DEFAULT_BATCH_SIZE

    # Choose target DB table based on whether we're processing 30-day archive
    target_table = "ip_events_30" if use_30 else "ip_events"

    if not os.path.exists(log_file):
        print(f"[live_parser] {log_file} not found. If this is the system log (/var/log/router.log) you may need to run with sudo or ensure the file exists.")
        return

    print(f"[live_parser] Watching {log_file} for new lines... (batch_size={batch_size}, target_table={target_table})")

    batch = []
    last_activity = time.time()

    try:
        f, inode, pos = open_log(log_file)
    except Exception as e:
        print(f"[live_parser] Failed to open {log_file}: {e}")
        return

    try:
        while True:
            line = f.readline()
            if not line:
                # No new line: check for rotation/truncation
                if file_changed(log_file, inode, pos):
                    try:
                        f.close()
                    except Exception:
                        pass
                    try:
                        f, inode, pos = open_log(log_file)
                        print(f"[live_parser] Reopened log file {log_file} after rotation/truncation at {datetime.now(timezone.utc).isoformat()}")
                    except Exception as e:
                        print(f"[live_parser] Error reopening {log_file}: {e}")
                        time.sleep(SLEEP_INTERVAL)
                        continue
                # Idle flush if we've accumulated events but no new lines for a bit
                if batch and (time.time() - last_activity) >= IDLE_FLUSH_SECONDS:
                    try:
                        insert_events(batch, table=target_table)
                        print(f"[live_parser] Flushed {len(batch)} events (idle flush) into {target_table}.")
                    except Exception as e:
                        print(f"[live_parser] Error inserting batch: {e}")
                    batch = []
                time.sleep(SLEEP_INTERVAL)
                continue

            pos = f.tell()
            last_activity = time.time()

            parsed = parse_log_line(line)
            if not parsed:
                continue
            event = enrich_event(parsed)
            batch.append(event)

            if len(batch) >= batch_size:
                try:
                    insert_events(batch, table=target_table)
                    print(f"[live_parser] Inserted {len(batch)} events into {target_table}.")
                except Exception as e:
                    print(f"[live_parser] Error inserting batch: {e}")
                batch = []

    except KeyboardInterrupt:
        print("[live_parser] Interrupted by user, flushing remaining events...")
    except Exception as e:
        print(f"[live_parser] Unexpected error: {e}")
    finally:
        if batch:
            try:
                insert_events(batch, table=target_table)
                print(f"[live_parser] Final flush: inserted {len(batch)} events into {target_table}.")
            except Exception as e:
                print(f"[live_parser] Error on final flush: {e}")
        try:
            f.close()
        except Exception:
            pass

if __name__ == "__main__":
    main()
