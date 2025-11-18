#!/bin/bash

echo "🔧 Net Sentinel 2 Setup Starting..."

# Create folders
mkdir -p data/logs
mkdir -p data/geoip
mkdir -p static

# Install Python dependencies
echo "📦 Installing Python packages..."
#pip install --upgrade pip
#pip install flask requests geoip2 dnspython
sudo apt install python3-pip python3-flask python3-requests python3-geoip2 python3-dnspython -y

# Download GeoLite2-City.mmdb from GitHub mirror
echo "🌍 Downloading GeoLite2-City.mmdb from GitHub..."
wget -q --show-progress https://github.com/P3TERX/GeoLite.mmdb/releases/latest/download/GeoLite2-City.mmdb -O data/geoip/GeoLite2-City.mmdb

# Create SQLite database
echo "🗃️ Creating SQLite database..."
DB_FILE="net_sentinel.db"
SCHEMA_FILE="schema.sql"

if [ -f "$SCHEMA_FILE" ]; then
    sqlite3 "$DB_FILE" < "$SCHEMA_FILE"
    echo "✅ Database created: $DB_FILE"
else
    echo "⚠️ schema.sql not found. Please add it before running setup."
fi

echo "✅ Setup complete. You’re ready to parse logs and launch the dashboard."
