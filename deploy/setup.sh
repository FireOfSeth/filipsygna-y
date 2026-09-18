#!/usr/bin/env bash
# Instalacja skanera na czystym serwerze Ubuntu 22.04/24.04 (uruchom jako root).
# Użycie:  sudo bash deploy/setup.sh
set -euo pipefail

APP_DIR=/opt/mexc-sygnaly
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "== 1/5 Aktualizacja systemu i instalacja Node.js 22 =="
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "   Node.js $(node --version)"

echo "== 2/5 Użytkownik i katalog aplikacji =="
id -u mexc >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin mexc
mkdir -p "$APP_DIR"
cp -r "$SRC_DIR/src" "$SRC_DIR/package.json" "$APP_DIR/"
[ -f "$SRC_DIR/config.json" ] && cp "$SRC_DIR/config.json" "$APP_DIR/config.json"
[ -f "$APP_DIR/config.json" ] || cp "$SRC_DIR/config.example.json" "$APP_DIR/config.json"
mkdir -p "$APP_DIR/data"
chown -R mexc:mexc "$APP_DIR"
chmod 600 "$APP_DIR/config.json"

echo "== 3/5 Strefa czasowa =="
timedatectl set-timezone Europe/Warsaw || true

echo "== 4/5 Usługa systemd =="
cp "$SRC_DIR/deploy/mexc-sygnaly.service" /etc/systemd/system/mexc-sygnaly.service
systemctl daemon-reload
systemctl enable mexc-sygnaly >/dev/null

echo "== 5/5 Start =="
if grep -q "WKLEJ_TUTAJ_TOKEN" "$APP_DIR/config.json"; then
  echo
  echo "!! Wpisz token bota w $APP_DIR/config.json, potem uruchom:"
  echo "   sudo systemctl start mexc-sygnaly"
else
  systemctl restart mexc-sygnaly
  sleep 3
  systemctl --no-pager --lines=10 status mexc-sygnaly || true
fi

cat <<'HELP'

Gotowe. Przydatne komendy:
  sudo systemctl status mexc-sygnaly     – czy działa
  sudo journalctl -u mexc-sygnaly -f     – podgląd logów na żywo
  sudo systemctl restart mexc-sygnaly    – restart (np. po zmianie config.json)
  sudo nano /opt/mexc-sygnaly/config.json – ustawienia
HELP
