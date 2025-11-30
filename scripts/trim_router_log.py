#!/usr/bin/env python3
"""
Trim and archive router logs:
- Create a 7-day working log at [project]/logs/router.log
- Create a 30-day archive log at [project]/logs/last30router.log
- Reads from the source router log (default: /var/log/router.log)
- Robust timestamp parsing: first token or LASTTS=… fallback
"""

import os
import sys
from datetime import datetime, timedelta, timezone
import re

# Paths
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGS_DIR = os.path.join(PROJECT_ROOT, "logs")
os.makedirs(LOGS_DIR, exist_ok=True)

# Config (override via env)
SRC_LOG = os.environ.get("ROUTER_LOG_SRC", "/var/log/router.log")
OUT_7 = os.environ.get("ROUTER_LOG_OUT_7", os.path.join(LOGS_DIR, "router.log"))
OUT_30 = os.environ.get("ROUTER_LOG_OUT_30", os.path.join(LOGS_DIR, "last30router.log"))

# Cutoffs
CUTOFF_7 = datetime.now(timezone.utc) - timedelta(days=7)
CUTOFF_30 = datetime.now(timezone.utc) - timedelta(days=30)

def parse_ts(line: str):
    """Try first token as ISO-8601; if missing/invalid, try LASTTS=…; else None."""
    if not line:
        return None
    first_token = line.split(maxsplit=1)[0]
    # Try first token
    ts = _parse_iso_like(first_token)
    if ts:
        return ts
    # Try LASTTS=
    m = re.search(r"LASTTS=([0-9T:\-\.]+Z?)", line)
    if m:
        return _parse_iso_like(m.group(1))
    return None

def _parse_iso_like(s: str):
    try:
        if s.endswith("Z"):
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        else:
            dt = datetime.fromisoformat(s)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        try:
            dt = datetime.strptime(s, "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
            return dt
        except Exception:
            return None

def main():
    if not os.path.exists(SRC_LOG):
        print(f"[trim] Source log not found: {SRC_LOG}")
        sys.exit(1)

    total = kept_7 = kept_30 = 0
    lines_7, lines_30 = [], []

    try:
        with open(SRC_LOG, "r", encoding="utf-8", errors="replace") as src:
            for line in src:
                total += 1
                ts = parse_ts(line)
                # Fail-safe: if timestamp parsing fails, keep in both
                if ts is None or ts >= CUTOFF_30:
                    lines_30.append(line)
                if ts is None or ts >= CUTOFF_7:
                    lines_7.append(line)
        kept_30 = len(lines_30)
        kept_7 = len(lines_7)

        # Write outputs
        with open(OUT_30, "w", encoding="utf-8") as f30:
            f30.writelines(lines_30)
        with open(OUT_7, "w", encoding="utf-8") as f7:
            f7.writelines(lines_7)

    except Exception as e:
        print(f"[trim] Error processing logs: {e}", file=sys.stderr)
        sys.exit(1)

    removed_30 = total - kept_30
    removed_7 = total - kept_7
    print(f"[trim] src={SRC_LOG} total={total}")
    print(f"[trim] 30d→ {OUT_30} kept={kept_30} removed={removed_30} cutoff={CUTOFF_30.isoformat()}")
    print(f"[trim] 7d → {OUT_7}  kept={kept_7}  removed={removed_7}  cutoff={CUTOFF_7.isoformat()}")

if __name__ == "__main__":
    main()
