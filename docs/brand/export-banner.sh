#!/bin/sh
# Exporta las piezas de marca con Chrome sin interfaz (2x):
#   banner.html         → assets/banner.png                   (2560×800, imagen del README)
#   dmg-background.html → app/src-tauri/dmg-background.png    (1320×800 a 144 ppp, ventana del .dmg)
set -e
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
shot() { # html ancho alto salida
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --force-device-scale-factor=2 --window-size="$2,$3" --virtual-time-budget=8000 \
    --screenshot="$4" "file://$PWD/$1"
}
mkdir -p "$ROOT/assets"
shot banner.html 1280 400 "$ROOT/assets/banner.png"
shot dmg-background.html 660 400 "$ROOT/app/src-tauri/dmg-background.png"
# Finder usa los ppp para el tamaño: 144 ppp → 660×400 pt, nítido en Retina.
sips -s dpiWidth 144 -s dpiHeight 144 "$ROOT/app/src-tauri/dmg-background.png" >/dev/null
