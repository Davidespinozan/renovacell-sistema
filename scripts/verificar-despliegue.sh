#!/usr/bin/env bash
# ¿El sitio publicado trae la última versión? Compara el commit de main en GitHub con el que dice /version.json de cada
# dominio del sistema. Uso: ./scripts/verificar-despliegue.sh
set -uo pipefail
cd "$(dirname "$0")/.."
git fetch -q origin main 2>/dev/null || true
ESPERADO="$(git rev-parse origin/main)"
echo "GitHub (main): ${ESPERADO:0:7}"
FALLA=0
for SITIO in https://sistema-renovacell.netlify.app https://sistema.renovacell.mx; do
  PUB="$(curl -fsS --max-time 15 "$SITIO/version.json?t=$(date +%s)" 2>/dev/null | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p')"
  if [ -z "$PUB" ]; then echo "  $SITIO → sin version.json (todavía no se publica una compilación con versión, o el sitio no responde)"; FALLA=1
  elif [ "$PUB" = "$ESPERADO" ]; then echo "  $SITIO → ${PUB:0:7} ✓ al día"
  else echo "  $SITIO → ${PUB:0:7} ✗ DIFERENTE (Netlify no ha publicado main o falló la compilación)"; FALLA=1; fi
done
exit $FALLA
