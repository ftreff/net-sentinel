import sqlite3
import subprocess
import time

DB_FILE = "net_sentinel.db"

def get_ips_without_trace(limit=50):
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute("""
        SELECT id, ip FROM ip_events
        WHERE trace_path IS NULL
        ORDER BY timestamp DESC
        LIMIT ?
    """, (limit,))
    rows = cur.fetchall()
    conn.close()
    return rows

def run_traceroute(ip):
    try:
        result = subprocess.run(["traceroute", "-n", ip], capture_output=True, text=True, timeout=10)
        hops = []
        for line in result.stdout.splitlines()[1:]:
            parts = line.strip().split()
            if len(parts) >= 2:
                hops.append(parts[1])
        return ",".join(hops)
    except Exception:
        return None

def update_trace_path(id, trace_path):
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    cur.execute("UPDATE ip_events SET trace_path = ? WHERE id = ?", (trace_path, id))
    conn.commit()
    conn.close()

def process_traces():
    targets = get_ips_without_trace()
    for id, ip in targets:
        print(f"🔍 Tracing {ip}...")
        trace_path = run_traceroute(ip)
        if trace_path:
            update_trace_path(id, trace_path)
            print(f"✅ Stored trace for {ip}")
        else:
            print(f"⚠️ Failed to trace {ip}")
        time.sleep(1)  # avoid hammering the network

if __name__ == "__main__":
    process_traces()
