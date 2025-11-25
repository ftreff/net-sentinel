#!/usr/bin/env python3
"""
Trim router.log to keep only lines newer than N days (default: 30).
- Assumes each line begins with an ISO-8601 timestamp (e.g., 2025-11-25T18:00:00Z ...)
- If a line's timestamp cannot be parsed, the line is preserved (fail-safe).
- Writes back to the same file atomically via a temp file.
"""

import os
import sys
import tempfile
import shutil
from datetime import datetime, timedelta, timezone

# Config (override via env vars if needed)
LOG_FILE = os.environ.get("ROUTER_LOG", "router.log")
DAYS_TO_KEEP = int(os.environ.get("DAYS_TO_KEEP", "30"))

def parse_timestamp_prefix(line: str):
    """
    Extract the first token as timestamp and parse into aware UTC datetime.
    Expected formats:
      - 2025-11-25T18:00:00Z
      - 2025-11-25T18:00:00+00:00
      - 2025-11-25 18:00:00 (assumed UTC)
    Returns None if parsing fails.
    """
    if not line:
        return None
    first = line.split(maxsplit=1)[0]
    try:
        if first.endswith("Z"):
            # Normalize Z to +00:00 for fromisoformat
            ts = datetime.fromisoformat(first.replace("Z", "+00:00"))
        else:
            ts = datetime.fromisoformat(first)
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
        return ts.astimezone(timezone.utc)
    except Exception:
        # Try a looser format
        try:
            ts = datetime.strptime(first, "%Y-%m-%dT%H:%M:%S")
            ts = ts.replace(tzinfo=timezone.utc)
            return ts
        except Exception:
            return None

def main():
    cutoff = datetime.now(timezone.utc) - timedelta(days=DAYS_TO_KEEP)
    if not os.path.exists(LOG_FILE):
        print(f"[trim] {LOG_FILE} not found; nothing to trim.")
        return

    # Write to a temp file, then atomically replace
    dirpath = os.path.dirname(os.path.abspath(LOG_FILE)) or "."
    fd, tmp_path = tempfile.mkstemp(prefix="router_trim_", dir=dirpath)
    os.close(fd)

    kept = 0
    total = 0

    try:
        with open(LOG_FILE, "r", encoding="utf-8", errors="replace") as src, \
             open(tmp_path, "w", encoding="utf-8") as dst:
            for line in src:
                total += 1
                ts = parse_timestamp_prefix(line)
                # Keep if timestamp is valid and recent, or if parsing failed (fail-safe)
                if ts is None or ts >= cutoff:
                    dst.write(line)
                    kept += 1
    except Exception as e:
        # Clean up temp file if something goes wrong
        try:
            os.remove(tmp_path)
        except Exception:
            pass
        print(f"[trim] Error trimming {LOG_FILE}: {e}", file=sys.stderr)
        sys.exit(1)

    # Replace original file
    try:
        shutil.move(tmp_path, LOG_FILE)
    except Exception as e:
        print(f"[trim] Failed to replace {LOG_FILE}: {e}", file=sys.stderr)
        sys.exit(1)

    removed = total - kept
    print(f"[trim] Completed: total={total}, kept={kept}, removed={removed}, cutoff={cutoff.isoformat()}")

if __name__ == "__main__":
    main()
