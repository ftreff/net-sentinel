#!/bin/bash
# Net Sentinel ingestion orchestrator
# Location: [project-folder]/ingest.sh
# Runs scripts from ./scripts/
# Usage:
#   ./ingest.sh foreground   # run live_parser in foreground
#   ./ingest.sh background   # run live_parser in background (default)

PROJECT_ROOT="$(dirname "$(realpath "$0")")"
SCRIPTS_DIR="$PROJECT_ROOT/scripts"
MODE="${1:-background}"

echo "[ingest] Trimming router.log..."
python3 "$SCRIPTS_DIR/trim_router_log.py"

echo "[ingest] Batch parsing router.log..."
python3 "$SCRIPTS_DIR/batch_parser.py"

if [ "$MODE" = "foreground" ]; then
    echo "[ingest] Starting live parser in FOREGROUND..."
    exec python3 "$SCRIPTS_DIR/live_parser.py"
else
    echo "[ingest] Starting live parser in BACKGROUND..."
    nohup python3 "$SCRIPTS_DIR/live_parser.py" > "$PROJECT_ROOT/live_parser.log" 2>&1 &
    echo "[ingest] Live parser running in background (PID $!)"
fi
