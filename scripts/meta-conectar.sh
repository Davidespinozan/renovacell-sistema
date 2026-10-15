#!/usr/bin/env bash
# Conecta Instagram y Messenger de la empresa a Renovacell (después de WhatsApp). Pide el token del usuario del sistema
# (no se muestra), encuentra la página de Facebook del portfolio y su Instagram, guarda las llaves en Supabase y
# suscribe la app a la página para recibir los mensajes. NO cambia el modo: los dos canales siguen en ESPEJO.
#
# Antes, en Meta: (1) Usuarios del sistema → renovacell-sistema → Asignar activos → Página de Facebook y Cuenta de
# Instagram con control total; (2) la app con los casos de uso Messenger e Instagram; (3) un token NUEVO del usuario
# del sistema con: pages_show_list, pages_manage_metadata, pages_messaging, instagram_basic, instagram_manage_messages
# (además de los de WhatsApp); (4) el Instagram debe ser profesional y estar vinculado a la página.
set -euo pipefail
cd "$(dirname "$0")/.."
V="${META_GRAPH_VERSION:-v21.0}"
PORTFOLIO="${META_BUSINESS_ID:-1039088777609414}"   # portfolio comercial Renovacell
read -r -s -p "Token del usuario del sistema (no se mostrará): " TOKEN; echo
[ ${#TOKEN} -ge 50 ] || { echo "Ese token es muy corto; revisa que lo copiaste completo. No se cambió nada."; exit 1; }

echo "Buscando la página de Facebook y su Instagram…"
LISTA="$(node -e '
const [tok, v, portfolio] = process.argv.slice(1);
const fallos = [];
(async () => {
  const get = async (u, que) => { const r = await (await fetch(u, { headers: { Authorization: "Bearer " + tok } })).json(); if (r.error) fallos.push(que + ": " + (r.error.message || "").replace(/\s+/g, " ")); return r; };
  const dbg = (await get(`https://graph.facebook.com/${v}/debug_token?input_token=${encodeURIComponent(tok)}`, "permisos del token")).data || {};
  const permisos = dbg.scopes || [];
  const out = [];
  for (const edge of ["owned_pages", "client_pages"]) {
    const r = await get(`https://graph.facebook.com/${v}/${portfolio}/${edge}?fields=id,name,access_token,instagram_business_account{id,username}`, `páginas (${edge})`);
    for (const p of (r.data || [])) out.push([p.id, p.name, p.access_token || "", (p.instagram_business_account || {}).id || "", (p.instagram_business_account || {}).username || ""].join("\t"));
  }
  if (!out.length) {
    const faltan = ["pages_show_list", "pages_manage_metadata", "pages_messaging", "instagram_basic", "instagram_manage_messages"].filter((x) => !permisos.includes(x));
    console.error("DIAGNÓSTICO:");
    console.error("  permisos del token: " + (permisos.join(", ") || "(ninguno)"));
    if (faltan.length) console.error("  FALTAN permisos: " + faltan.join(", ") + " → genera el token otra vez marcándolos (después de agregar los casos de uso Messenger e Instagram).");
    for (const f of fallos) console.error("  Meta dijo (" + f + ")");
  }
  console.log([...new Set(out)].join("\n"));
})().catch((e) => { console.error(String(e)); process.exit(1) });
' "$TOKEN" "$V" "$PORTFOLIO")"
[ -n "$LISTA" ] || { echo "El token no ve ninguna página. Revisa que el usuario del sistema tenga asignada la página de Facebook con control total y que el token tenga los permisos de páginas e Instagram."; exit 1; }
echo "Páginas encontradas:"; echo "$LISTA" | nl -w2 -s') ' | awk -F'\t' '{print $1"  "$2"  (Instagram: "($5==""?"ninguno vinculado":"@"$5)")"}'
read -r -p "¿Cuál es la página de la empresa? (número de la lista): " N
FILA="$(echo "$LISTA" | sed -n "${N}p")"
[ -n "$FILA" ] || { echo "Opción no válida. No se cambió nada."; exit 1; }
PAGE_ID="$(echo "$FILA" | cut -f1)"; PAGE_TOKEN="$(echo "$FILA" | cut -f3)"; IG_ID="$(echo "$FILA" | cut -f4)"
[ -n "$PAGE_TOKEN" ] || { echo "Meta no entregó el token de la página: el usuario del sistema necesita control total sobre la página. No se cambió nada."; exit 1; }
[ -n "$IG_ID" ] || echo "Aviso: esa página no tiene un Instagram profesional vinculado; Messenger sí quedará conectado, Instagram no."

ENV_FILE="$(mktemp)"; trap 'rm -f "$ENV_FILE"' EXIT
printf 'META_PAGE_TOKEN=%s\nMETA_PAGE_ID=%s\nMETA_IG_ID=%s\n' "$PAGE_TOKEN" "$PAGE_ID" "${IG_ID:-}" > "$ENV_FILE"
supabase secrets set --env-file "$ENV_FILE" >/dev/null
echo "Llaves guardadas en Supabase."

R="$(curl -sS -X POST -H "Authorization: Bearer $PAGE_TOKEN" "https://graph.facebook.com/$V/$PAGE_ID/subscribed_apps?subscribed_fields=messages")"
echo "$R" | grep -q '"success":true' && echo "App suscrita a la página (Messenger)." || { echo "No se pudo suscribir la app a la página: $R"; exit 1; }

SUPABASE_URL="$(supabase status 2>/dev/null | grep -oE 'https://[a-z0-9]+\.supabase\.co' | head -1 || true)"
[ -n "$SUPABASE_URL" ] || SUPABASE_URL="https://$(cat supabase/.temp/project-ref).supabase.co"
cat <<FIN

Último paso, en developers.facebook.com → tu app → Webhooks (menú izquierdo o Configuración → Webhooks):
  · Objeto "Página" (Messenger):    misma URL de siempre ($SUPABASE_URL/functions/v1/meta-webhook) y el mismo token de verificación; suscríbete al campo  messages
  · Objeto "Instagram":             misma URL y token; suscríbete al campo  messages
Y en la app de Instagram del celular: Configuración → Mensajes → Herramientas conectadas → "Permitir acceso a mensajes" encendido.

Instagram y Messenger quedan en MODO ESPEJO: se ven en Conversaciones y Leadsales sigue contestando.
FIN
