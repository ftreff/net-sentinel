from flask import Flask, jsonify, request
import sqlite3
import subprocess
import json

DB_FILE = "net_sentinel.db"
app = Flask(__name__)

def query_db(query, args=(), one=False):
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.execute(query, args)
    rows = cur.fetchall()
    conn.close()
    return (rows[0] if rows else None) if one else rows

@app.route("/api/map")
def map_data():
    rows = query_db("""
        SELECT ip, latitude, longitude, country_code, trace_path
        FROM ip_events
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    """)
    return jsonify([dict(row) for row in rows])

@app.route("/api/table")
def table_data():
    rows = query_db("""
        SELECT ip, reverse_dns, direction, port, service, timestamp,
               city, state, country, country_code
        FROM ip_events
        ORDER BY timestamp DESC
        LIMIT 500
    """)
    return jsonify([dict(row) for row in rows])

@app.route("/api/rankings")
def country_rankings():
    rows = query_db("""
        SELECT country_code, COUNT(*) as count
        FROM ip_events
        WHERE country_code IS NOT NULL
        GROUP BY country_code
        ORDER BY count DESC
        LIMIT 20
    """)
    return jsonify([dict(row) for row in rows])

@app.route("/api/trace", methods=["POST"])
def run_trace():
    ip = request.json.get("ip")
    if not ip:
        return jsonify({"error": "Missing IP"}), 400

    try:
        result = subprocess.run(["traceroute", "-n", ip], capture_output=True, text=True, timeout=10)
        hops = []
        for line in result.stdout.splitlines()[1:]:
            parts = line.strip().split()
            if len(parts) >= 2:
                hops.append(parts[1])
        return jsonify({"ip": ip, "hops": hops})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(debug=True)
