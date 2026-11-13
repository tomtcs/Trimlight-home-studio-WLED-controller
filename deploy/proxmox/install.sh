#!/usr/bin/env bash
set -euo pipefail

app=/opt/trimlight-studio
repo=$app/repo.git
state=/var/lib/trimlight-studio

[[ $EUID == 0 ]] || { echo "Run as root inside the LXC." >&2; exit 1; }
[[ ! -e $app/current ]] || { echo "Studio is already installed. Run update inside the LXC." >&2; exit 1; }

if ! getent passwd trimlight-studio >/dev/null; then
  useradd --system --user-group --home-dir "$state" --shell /usr/sbin/nologin trimlight-studio
fi
install -d -m 0755 "$app/releases"
install -d -m 0700 -o trimlight-studio -g trimlight-studio "$state"

# Seed only the scheduler flag. The browser restore can import the Docker data
# without starting a second scheduler during cutover.
runuser -u trimlight-studio -- python3 - "$state/studio.sqlite3" <<'PY'
import sqlite3
import sys

with sqlite3.connect(sys.argv[1]) as db:
    db.execute("""CREATE TABLE IF NOT EXISTS studio_state (
        key TEXT PRIMARY KEY, value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    db.execute("INSERT OR IGNORE INTO studio_state (key, value) VALUES ('scheduler_enabled', 'false')")
PY

git --git-dir="$repo" show FETCH_HEAD:deploy/proxmox/update > "$app/update"
git --git-dir="$repo" show FETCH_HEAD:deploy/proxmox/trimlight-studio.service > "$app/trimlight-studio.service"
install -m 0644 "$app/trimlight-studio.service" /etc/systemd/system/trimlight-studio.service
# This dedicated guest serves Studio on port 8080.
rm -f /etc/nginx/sites-enabled/default
ln -sfn "$app/current/trimlight-studio.conf" /etc/nginx/sites-enabled/trimlight-studio.conf
systemctl daemon-reload
bash "$app/update" --initial
systemctl enable trimlight-studio.service nginx.service
