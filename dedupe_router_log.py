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
            timestamp = datetime.datetime.strptime(ts_match.group(0), "%b %d %H:%M:%S")
            # attach current year for parsing
            timestamp = timestamp.replace(year=datetime.datetime.now().year)
        except:
            timestamp = datetime.datetime.now()
    else:
        timestamp = datetime.datetime.now()

    if ip and port and verdict and direction:
        return (ip, port, verdict, direction, timestamp, line.strip())
    return None

def dedupe_log():
    cutoff = datetime.datetime.now() - datetime.timedelta(days=7)
    groups = defaultdict(lambda: {"count": 0, "timestamp": None, "line": None})

    with open(LOG_PATH, "r") as f:
        lines = f.readlines()

    keep_lines = []  # lines newer than 7 days

    for line in lines:
        parsed = parse_line(line)
        if not parsed:
            continue
        ip, port, verdict, direction, timestamp, raw_line = parsed

        if timestamp >= cutoff:
            # keep recent lines untouched
            keep_lines.append(line)
        else:
            key = (ip, port, verdict, direction)
            groups[key]["count"] += 1
            groups[key]["timestamp"] = timestamp if (
                groups[key]["timestamp"] is None or timestamp > groups[key]["timestamp"]
            ) else groups[key]["timestamp"]
            groups[key]["line"] = raw_line

    # ensure output dir exists
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # write grouped log
    with open(OUTPUT_PATH, "w") as out:
        for key, data in groups.items():
            ip, port, verdict, direction = key
            out.write(f"{data['line']} HITCOUNT={data['count']} LASTTS={data['timestamp'].isoformat()}\n")

    # rewrite router.log with only recent lines
    with open(LOG_PATH, "w") as f:
        f.writelines(keep_lines)

    print(f"✅ Deduplication complete. Grouped log written to {OUTPUT_PATH}")
    print(f"➡️  Router log truncated to last 7 days.")

if __name__ == "__main__":
    dedupe_log()
