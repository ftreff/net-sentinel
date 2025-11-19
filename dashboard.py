from flask import Flask, render_template, jsonify
import sqlite3
import json

app = Flask(__name__, static_folder="static", template_folder="static")

@app.route("/")
def index():
    return render_template("map.html")

@app.route("/api/events")
def get_events():
    conn = sqlite3.connect("net_sentinel.db")
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM ip_events")
    rows = cursor.fetchall()
    conn.close()

    events = []
    for row in rows:
        trace = []
        try:
            trace = json.loads(row["trace_path"]) if row["trace_path"] else []
        except Exception:
            trace = []

        events.append({
            "ip": row["ip"],
            "verdict": row["verdict"],
            "service": row["service"],
            "city": row["city"],
            "country": row["country"],
            "timestamp": row["timestamp"],
            "latitude": row["latitude"],
            "longitude": row["longitude"],
            "trace_path": trace
        })

    return jsonify(events)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
