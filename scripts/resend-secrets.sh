#!/usr/bin/env bash
# Guarda en Supabase la configuración del correo (Resend) SIN mostrar la llave en pantalla ni dejarla en el historial.
# Uso: ./scripts/resend-secrets.sh            (pregunta el remitente y la llave)
set -euo pipefail
DEF_FROM='Renovacell <notificaciones@renovacell.mx>'
read -r -p "Remitente [${DEF_FROM}]: " FROM
FROM="${FROM:-$DEF_FROM}"
case "$FROM" in *@*) ;; *) echo "El remitente debe llevar un correo (ej. ${DEF_FROM})."; exit 1;; esac
read -r -s -p "Pega la API key de Resend (no se mostrará): " KEY; echo
case "$KEY" in re_*) ;; *) echo "Esa no parece una llave de Resend (empiezan con re_). No se guardó nada."; exit 1;; esac
ENV_FILE="$(mktemp)"; trap 'rm -f "$ENV_FILE"' EXIT
printf 'MAIL_PROVIDER=resend\nMAIL_API_KEY=%s\nMAIL_FROM=%s\n' "$KEY" "$FROM" > "$ENV_FILE"
supabase secrets set --env-file "$ENV_FILE"
echo "Correo configurado en Supabase (la llave no se mostró). Remitente: ${FROM}"
