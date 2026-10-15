#!/usr/bin/env bash
# Sube de una vez las 4 plantillas de correo de Supabase Auth (asunto + diseño de marca en español) al proyecto.
# Solo cambia esas 8 opciones; el resto de la configuración de Auth (SMTP, URLs, etc.) no se toca.
# Pide un token de acceso de Supabase (Account → Access Tokens; empieza con sbp_). No se muestra ni se guarda.
set -euo pipefail
cd "$(dirname "$0")/.."
REF="amurlvlvfohwucvxfdot"
TOKEN="${SUPABASE_ACCESS_TOKEN:-}"
if [ -z "$TOKEN" ]; then read -r -s -p "Pega tu token de Supabase (sbp_…, no se mostrará): " TOKEN; echo; fi
case "$TOKEN" in sbp_*) ;; *) echo "Ese no parece un token de Supabase (empiezan con sbp_). No se cambió nada."; exit 1;; esac
BODY="$(node -e '
const fs = require("fs"); const d = "supabase/templates/auth/";
const t = { recovery: "Restablece tu contraseña de Renovacell", invite: "Te invitamos a Renovacell",
            email_change: "Confirma tu nuevo correo en Renovacell", confirmation: "Confirma tu cuenta de Renovacell" };
const o = {};
for (const [k, asunto] of Object.entries(t)) { o["mailer_subjects_" + k] = asunto; o["mailer_templates_" + k + "_content"] = fs.readFileSync(d + k + ".html", "utf8"); }
process.stdout.write(JSON.stringify(o));')"
CODE="$(curl -sS -o /tmp/rc-auth-resp.json -w '%{http_code}' -X PATCH "https://api.supabase.com/v1/projects/$REF/config/auth" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data "$BODY")"
if [ "$CODE" = "200" ]; then
  echo "Listo: las 4 plantillas quedaron en Supabase."
  node -e 'const r=require("/tmp/rc-auth-resp.json"); for (const k of ["recovery","invite","email_change","confirmation"]) console.log("  " + k + ": " + r["mailer_subjects_" + k]);'
else
  echo "Supabase respondió $CODE; no se cambió nada. Detalle:"; head -c 300 /tmp/rc-auth-resp.json; echo
fi
rm -f /tmp/rc-auth-resp.json
