from flask import Flask, jsonify, send_from_directory
import sqlite3

app = Flask(__name__)

DB_PATH = "net_sentinel.db"

@app.route("/api/map")
def map_data():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        SELECT ip, latitude, longitude, country_code, trace_path, verdict
        FROM ip_events
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
    """)
    rows = c.fetchall()
    conn.close()
    keys = ["ip", "latitude", "longitude", "country_code", "trace_path", "verdict"]
    return jsonify([dict(zip(keys, row)) for row in rows])

@app.route("/api/rankings")
def rankings():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        SELECT country_code, COUNT(*) as count
        FROM ip_events
        GROUP BY country_code
        ORDER BY count DESC
        LIMIT 10
    """)
    rows = c.fetchall()
    conn.close()
    return jsonify([{"country_code": row[0], "count": row[1]} for row in rows])

@app.route("/api/table")
def table_data():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        SELECT ip, reverse_dns, direction, port, service, timestamp,
               city, state, country, country_code, verdict
        FROM ip_events
        ORDER BY timestamp DESC
        LIMIT 500
    """)
    rows = c.fetchall()
    conn.close()
    keys = ["ip", "reverse_dns", "direction", "port", "service", "timestamp",
            "city", "state", "country", "country_code", "verdict"]
    return jsonify([dict(zip(keys, row)) for row in rows])

@app.route("/static/<path:path>")
def static_files(path):
    return send_from_directory("static", path)

if __name__ == "__main__":
    app.run(debug=True)
