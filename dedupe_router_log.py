import os
import re
import datetime
from collections import defaultdict

LOG_PATH = "/var/log/router.log"
OUTPUT_DIR = "logs"  # project folder
OUTPUT_PATH = os.path.join(OUTPUT_DIR, "grouped-router.log")

def parse_line(line):
    src_match = re.search(r"SRC=([\d\.]+)", line)
    dst_match = re.search(r"DST=([\d\.]+)", line)
    spt_match = re.search(r"SPT=(\d+)", line)
    dpt_match = re.search(r"DPT=(\d+)", line)

    verdict = "DROP" if "DROP" in line else "ACCEPT" if "ACCEPT" in line else None
    direction = None
    ip, port = None, None

    if verdict == "DROP" and "IN=eth0" in line and src_match and dpt_match:
        direction = "RX"
        ip = src_match.group(1)
        port = int(dpt_match.group(1))
    elif verdict == "ACCEPT" and "OUT=eth0" in line and dst_match and spt_match:
        direction = "TX"
        ip = dst_match.group(1)
        port = int(spt_match.group(1))

    # crude syslog timestamp parsing
    ts_match = re.search(r"\w{3}\s+\d+\s[\d:]+", line)
    if ts_match:
        try:
            ts = datetime.datetime.strptime(ts_match.group(0), "%b %d %H:%M:%S")
            now = datetime.datetime.now()
            # adjust year: if parsed month > current month and we are in Jan, roll back
            year = now.year
            if ts.month > now.month and now.month == 1:
                year -= 1
            timestamp = ts.replace(year=year)
        except Exception:
            timestamp = datetime.datetime.now(datetime.timezone.utc)
    else:
        timestamp = datetime.datetime.now(datetime.timezone.utc)

    if ip and port and verdict and direction:
        return (ip, port, verdict, direction, timestamp, line.strip())
    return None

def load_existing_groups():
    groups = defaultdict(lambda: {"count": 0, "timestamp": None, "line": None})
    if not os.path.exists(OUTPUT_PATH):
        return groups
    with open(OUTPUT_PATH, "r") as f:
        for line in f:
            hit_match = re.search(r"HITCOUNT=(\d+)", line)
            ts_match = re.search(r"LASTTS=([\d\-:T]+)", line)
            parsed = parse_line(line)
            if not parsed:
                continue
            ip, port, verdict, direction, _, raw_line = parsed
            key = (ip, port, verdict, direction)
            count = int(hit_match.group(1)) if hit_match else 1
            ts = ts_match.group(1) if ts_match else None
            groups[key]["count"] += count
            groups[key]["timestamp"] = ts
            groups[key]["line"] = raw_line
    return groups

def dedupe_log():
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=7)
    groups = load_existing_groups()
    keep_lines = []

    with open(LOG_PATH, "r") as f:
        for line in f:
            parsed = parse_line(line)
            if not parsed:
                continue
            ip, port, verdict, direction, timestamp, raw_line = parsed
            if timestamp >= cutoff:
                keep_lines.append(line)
            else:
                key = (ip, port, verdict, direction)
                groups[key]["count"] += 1
                if (groups[key]["timestamp"] is None or timestamp.isoformat() > groups[key]["timestamp"]):
                    groups[key]["timestamp"] = timestamp.isoformat()
                groups[key]["line"] = raw_line

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # write grouped log
    with open(OUTPUT_PATH, "w") as out:
        for key, data in groups.items():
            out.write(f"{data['line']} HITCOUNT={data['count']} LASTTS={data['timestamp']}\n")

    # atomic rewrite of router.log
    tmp_path = LOG_PATH + ".tmp"
    with open(tmp_path, "w") as f:
        f.writelines(keep_lines)
    os.replace(tmp_path, LOG_PATH)

    print(f"✅ Deduplication complete. Grouped log written to {OUTPUT_PATH}")
    print(f"➡️ Router log truncated to last 7 days.")

if __name__ == "__main__":
    dedupe_log()
