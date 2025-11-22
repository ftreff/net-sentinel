#!/bin/bash
# ingest.sh — orchestrates Net Sentinel ingestion pipeline

set -euo pipefail

echo "🚀 Starting Net Sentinel ingestion..."

# Step 1: Deduplicate router.log (>7d archived into logs/grouped-router.log)
echo "📦 Running deduplication..."
sudo nice -n -5 ionice -c2 -n0 python3 dedupe_router_log.py

# Step 2: Parse logs (fresh + grouped) into SQLite DB
echo "🧠 Running parser..."
sudo nice -n -5 ionice -c2 -n0 python3 parser.py

echo "✅ Ingestion complete. Database updated."
