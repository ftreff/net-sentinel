#!/bin/bash
# Orchestrator for Net Sentinel ingestion
# Location: [project-folder]/ingest.sh
set -euo pipefail
PROJECT_ROOT="$(dirname "$(realpath "$0")")"
SCRIPS_DIR="$PROJECT_ROOT/scrips"
echo "🚀 Starting Net Sentinel ingestion..."

echo "[ingest] Trimming router.log..."
sudo nice -n -5 ionice -c2 -n0 python3 "$SCRIPS_DIR/trim_router_log.py"

echo "📦 Loading router log data..."
echo "[ingest] Batch parsing router.log..."
sudo nice -n -5 ionice -c2 -n0 python3 "$SCRIPS_DIR/batch_parser.py"

echo "🧠 Loading live data from router.log"
echo "[ingest] Starting live parser (background)..."
sudo nice -n -5 ionice -c2 -n0 nohup python3 "$SCRIPS_DIR/live_parser.py" > "$PROJECT_ROOT/live_parser.log" 2>&1 &
echo "[ingest] Live parser running (PID $!)"
echo "✅ Ingestion complete. Live data from router.log is still being proecessed to database"
