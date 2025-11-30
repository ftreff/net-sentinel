#!/usr/bin/env python3
"""
trim_router_log.py

Trim the live router log into two retention files under the project logs directory:

- logs/router.log      : contains the most recent 7 days of entries (working file)
- logs/last30router.log: contains up to the most recent 30 days of older entries

Behavior:
1. Read the source live log (/var/log/router.log).
2. Split lines: those within the last 7 days go to logs/router.log.
   lines older than 7 days are appended to the 30-day archive.
3. Merge the newly appended lines with the existing 30-day archive,
   then trim that archive to only keep entries from the last 30 days.
4. Replace the two files atomically (write to .tmp then os.replace).

Notes:
- This script expects log lines to include a timestamp token like:
    LASTTS=2025-11-29T21:10:29Z
  If your log uses a different field or format, update extract_timestamp().
- Lines without a parseable timestamp are preserved:
  - If they came from the live log, they are treated as "recent" and go into the 7-day file.
  - When present in the 30-day archive, they are kept (we cannot determine age).
- The script must be run with permissions to read /var/log/router.log (typically root).
"""

import os
import sys
import re
import datetime
from typing import Optional

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGS_DIR = os.path.join(PROJECT_ROOT, "logs")
RAW_LOG = "/var/log/router.log"
OUT_7 = os.path.join(LOGS_DIR, "router.log")
OUT_30 = os.path.join(LOGS_DIR, "last30router.log")

# Regex to extract timestamp token; adjust if your logs use a different key
TS_RE = re.compile(r"LASTTS=([0-9T:\-\.]+Z?)")

def extract_timestamp(line: str) -> Optional[datetime.datetime]:
    """
    Parse a timestamp from a log line and return a timezone-aware datetime in UTC.
    Returns None if no timestamp can be parsed.
    """
    m = TS_RE.search(line)
    if not m:
        return None
    s = m.group(1)
    # Normalize trailing Z to +00:00 for fromisoformat
    s_norm = s.replace("Z", "+00:00")
    try:
        # Python 3.7+ supports fromisoformat with offset
        dt = datetime.datetime.fromisoformat(s_norm)
        if dt.tzinfo is None:
            # assume UTC if no tz provided
            dt = dt.replace(tzinfo=datetime.timezone.utc)
        else:
            # convert to UTC
            dt = dt.astimezone(datetime.timezone.utc)
        return dt
    except Exception:
        # Could not parse with fromisoformat; try common fallback formats
        for fmt in ("%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M:%S%z"):
            try:
                dt = datetime.datetime.strptime(s_norm, fmt)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=datetime.timezone.utc)
                else:
                    dt = dt.astimezone(datetime.timezone.utc)
                return dt
            except Exception:
                continue
    return None

def read_lines(path: str):
    """Yield lines from a file, or empty iterator if file missing/unreadable."""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                yield line
    except FileNotFoundError:
        return
    except PermissionError:
        print(f"Permission denied reading {path}", file=sys.stderr)
        return
    except Exception as e:
        print(f"Error reading {path}: {e}", file=sys.stderr)
        return

def write_atomic(path: str, lines):
    """Write lines to a temporary file and atomically replace the target path."""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        for line in lines:
            fh.write(line)
    os.replace(tmp, path)

def main():
    os.makedirs(LOGS_DIR, exist_ok=True)

    if not os.path.exists(RAW_LOG):
        print(f"Source log {RAW_LOG} not found.", file=sys.stderr)
        return 1

    now = datetime.datetime.now(datetime.timezone.utc)
    cutoff_7 = now - datetime.timedelta(days=7)
    cutoff_30 = now - datetime.timedelta(days=30)

    # Step 1: Read live log and split into recent (<=7d) and older (>7d)
    recent_lines = []      # will become OUT_7
    older_from_live = []   # candidates to append to OUT_30

    for line in read_lines(RAW_LOG):
        ts = extract_timestamp(line)
        if ts is None:
            # If we cannot parse timestamp, treat as recent (keep in 7-day)
            recent_lines.append(line)
        else:
            if ts >= cutoff_7:
                recent_lines.append(line)
            else:
                older_from_live.append(line)

    # Step 2: Read existing OUT_30 and combine with older_from_live
    combined_30 = []
    # First, include existing archive lines (preserve original order)
    for line in read_lines(OUT_30):
        combined_30.append(line)
    # Then append newly aged lines from live log (older than 7 days)
    combined_30.extend(older_from_live)

    # Step 3: Filter combined_30 to only keep entries within last 30 days (or without timestamp)
    filtered_30 = []
    for line in combined_30:
        ts = extract_timestamp(line)
        if ts is None:
            # Keep lines without timestamp (we cannot determine age)
            filtered_30.append(line)
        else:
            if ts >= cutoff_30:
                filtered_30.append(line)
            else:
                # drop lines older than 30 days
                continue

    # Optional: remove duplicates while preserving order (helps if same lines appended twice)
    seen = set()
    deduped_30 = []
    for line in filtered_30:
        key = line.strip()
        if key in seen:
            continue
        seen.add(key)
        deduped_30.append(line)

    # Step 4: Write outputs atomically
    try:
        write_atomic(OUT_7, recent_lines)
        write_atomic(OUT_30, deduped_30)
    except PermissionError as e:
        print(f"Permission error writing output files: {e}", file=sys.stderr)
        return 2
    except Exception as e:
        print(f"Error writing output files: {e}", file=sys.stderr)
        return 3

    print(f"Trim complete. {len(recent_lines)} lines kept in {OUT_7}; {len(deduped_30)} lines in {OUT_30}.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
