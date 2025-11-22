import os
import re
import datetime
from collections import defaultdict
from tqdm import tqdm   # ✅ progress bar

LOG_PATH = "/var/log/router.log"
OUTPUT_DIR = "logs"  # project folder
OUTPUT_PATH = os.path.join(OUTPUT_DIR, "grouped-router.log")

def parse_line(line):
    src_match = re.search(r"SRC=([\d\.]+)", line)
    dst_match = re.search(r"DST=([\d\.]+)", line)
    spt_match = re.search(r"SPT=(\d+)", line)
    dpt_match = re.search(r"DPT=(\d+)", line)
    proto_match = re.search(r"PROTO=(\w+)", line)
    in_if_match = re.search(r"IN=(\w+)", line)
    out_if_match = re.search(r"OUT=(\w+)", line)

    verdict = "DROP" if "DROP" in line else "ACCEPT" if "ACCEPT" in line else None
    if not verdict or not src_match or not dst_match:
        return None

    src_ip = src_match.group(1)
    dst_ip = dst_match.group(1)
    src_port = int(spt_match.group(1)) if spt_match else None
    dst_port = int(dpt_match.group(1)) if dpt_match else None
    proto = proto_match.group(1) if proto_match else None
    in_if = in_if_match.group(1) if in_if_match else None
    out_if = out_if_match.group(1) if out_if_match else None

    direction = "Inbound" if in_if else "Outbound"

    # syslog timestamp parsing (no year included)
    ts_match = re.search(r"\w{3}\s+\d+\s[\d:]+", line)
    if ts_match:
        try:
            ts = datetime.datetime.strptime(ts_match.group(0), "%b %d %H:%M:%S")
            now = datetime.datetime.now()
            year = now.year
            if ts.month > now.month and now.month == 1:
                year -= 1
            timestamp = ts.replace(year=year)
        except Exception:
            timestamp = datetime.datetime.now(datetime.timezone.utc)
    else:
        timestamp = datetime.datetime.now(datetime.timezone.utc)

    return {
        "src_ip": src_ip,
        "dst_ip": dst_ip,
        "src_port": src_port,
        "dst_port": dst_port,
        "proto": proto,
        "in_if": in_if,
        "out_if": out_if,
        "verdict": verdict.upper(),
        "direction": direction,
        "timestamp": timestamp,
        "raw_line": line.strip()
    }

def dedupe_log():
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=7)
    groups = defaultdict(lambda: {"count": 0, "timestamp": None, "line": None})
    keep_lines = []

    with open(LOG_PATH, "r") as f:
        for line in tqdm(f, desc="Deduping router.log", unit="line"):   # ✅ progress bar
            parsed = parse_line(line)
            if not parsed:
                continue

            if parsed["timestamp"] >= cutoff:
                keep_lines.append(line)
            else:
                key = (
                    parsed["src_ip"], parsed["dst_ip"],
                    parsed["src_port"], parsed["dst_port"],
                    parsed["proto"], parsed["verdict"], parsed["direction"]
                )
                groups[key]["count"] += 1
                if (groups[key]["timestamp"] is None or parsed["timestamp"] > groups[key]["timestamp"]):
                    groups[key]["timestamp"] = parsed["timestamp"]
                groups[key]["line"] = parsed["raw_line"]

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # write grouped log
    with open(OUTPUT_PATH, "w") as out:
        for key, data in groups.items():
            out.write(
                f"{data['line']} HITCOUNT={data['count']} LASTTS={data['timestamp'].isoformat()}\n"
            )

    # atomic rewrite of router.log
    tmp_path = LOG_PATH + ".tmp"
    with open(tmp_path, "w") as f:
        f.writelines(keep_lines)
    os.replace(tmp_path, LOG_PATH)

    print(f"✅ Deduplication complete. Grouped log written to {OUTPUT_PATH}")
    print(f"➡️ Router log truncated to last 7 days.")

if __name__ == "__main__":
    dedupe_log()
