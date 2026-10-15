#!/usr/bin/env bash
# Conecta el WhatsApp de la empresa a Renovacell (WA-0). Pide el token del usuario del sistema y la clave secreta de la
# app (no se muestran), encuentra solo el número y la cuenta de WhatsApp, guarda las llaves en Supabase y suscribe la
# app a la cuenta de WhatsApp para recibir los mensajes. NO cambia el modo: el canal sigue en ESPEJO hasta el día del cambio.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . supabase/.env.local; set +a
V="v21.0"
read -r -s -p "Token del usuario del sistema (no se mostrará): " TOKEN; echo
read -r -s -p "Clave secreta de la app (no se mostrará): " SECRETO; echo
[ ${#TOKEN} -ge 50 ] || { echo "Ese token es muy corto; revisa que lo copiaste completo. No se cambió nada."; exit 1; }
[[ "$SECRETO" =~ ^[0-9a-f]{32}$ ]] || { echo "La clave secreta de la app son 32 caracteres (0-9, a-f). No se cambió nada."; exit 1; }
api() { curl -sS -H "Authorization: Bearer $TOKEN" "$@"; }

# 1) Cuentas de WhatsApp a las que el token tiene acceso y sus números.
echo "Buscando el número de la empresa…"
LISTA="$(node -e '
const [tok, v] = process.argv.slice(1);
const fallos = [];
(async () => {
  const get = async (u, que) => { const r = await (await fetch(u, { headers: { Authorization: "Bearer " + tok } })).json(); if (r.error) fallos.push(que + ": " + (r.error.message || "").replace(/\s+/g, " ")); return r; };
  // a) Lo que el token puede ver, según Meta: permisos y cuentas de WhatsApp concedidas (sin pasar por el negocio).
  const dbg = (await get(`https://graph.facebook.com/${v}/debug_token?input_token=${encodeURIComponent(tok)}`, "permisos del token")).data || {};
  const permisos = dbg.scopes || [];
  const wabas = new Map();
  for (const g of (dbg.granular_scopes || [])) if (/^whatsapp_business_/.test(g.scope)) for (const id of (g.target_ids || [])) wabas.set(id, null);
  // b) Además, las cuentas de WhatsApp de los negocios a los que pertenece el usuario del sistema, y del portfolio
  //    comercial Renovacell (un usuario del sistema no siempre aparece en /me/businesses).
  const quien = await get(`https://graph.facebook.com/${v}/me?fields=id,name`, "identidad del token");
  const me = await get(`https://graph.facebook.com/${v}/me/businesses?fields=id,name`, "negocios del usuario del sistema");
  const negocios = [...(me.data || [])];
  const PORTFOLIO = process.env.META_BUSINESS_ID || "1039088777609414";   // portfolio comercial Renovacell
  if (!negocios.some((b) => b.id === PORTFOLIO)) negocios.push({ id: PORTFOLIO, name: "Renovacell (portfolio)" });
  for (const b of negocios) {
    for (const edge of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
      const w = await get(`https://graph.facebook.com/${v}/${b.id}/${edge}?fields=id,name`, `cuentas de WhatsApp de ${b.name}`);
      for (const a of (w.data || [])) wabas.set(a.id, a.name);
    }
  }
  const out = [];
  for (const [id, nombre0] of wabas) {
    const a = await get(`https://graph.facebook.com/${v}/${id}?fields=id,name,ownership_type,on_behalf_of_business_info,account_review_status`, `cuenta de WhatsApp ${id}`);
    const n = await get(`https://graph.facebook.com/${v}/${id}/phone_numbers?fields=id,display_phone_number,verified_name,status,platform_type,quality_rating,name_status,last_onboarded_time`, `números de la cuenta ${id}`);
    const socio = a.on_behalf_of_business_info && a.on_behalf_of_business_info.name ? "socio: " + a.on_behalf_of_business_info.name : "sin socio";
    for (const p of (n.data || [])) out.push([id, a.name || nombre0 || id, p.id, p.display_phone_number, p.verified_name,
      [p.status, p.platform_type, p.quality_rating ? "calidad " + p.quality_rating : null, p.last_onboarded_time ? "conectado " + String(p.last_onboarded_time).slice(0, 10) : null, socio, a.account_review_status].filter(Boolean).join(" · ")].join("\t"));
  }
  if (!out.length) {
    const faltan = ["business_management", "whatsapp_business_management", "whatsapp_business_messaging"].filter((x) => !permisos.includes(x));
    console.error("DIAGNÓSTICO:");
    console.error("  token de: " + (quien.name || "?") + (dbg.issued_at ? " · emitido " + new Date(dbg.issued_at * 1000).toLocaleString("es-MX") : "") + (dbg.application ? " · app " + dbg.application : ""));
    console.error("  permisos del token: " + (permisos.length ? permisos.join(", ") : "(ninguno; el token no es válido o no se pegó completo)"));
    console.error("  negocios que ve por /me/businesses: " + ((me.data || []).length));
    if (faltan.length) console.error("  FALTAN permisos: " + faltan.join(", ") + " → genera el token otra vez marcándolos.");
    console.error("  cuentas de WhatsApp que el token puede ver: " + (wabas.size || "ninguna → en Usuarios del sistema, Asignar activos → Cuentas de WhatsApp → Renovacell → Control total"));
    for (const f of fallos) console.error("  Meta dijo (" + f + ")");
  }
  console.log([...new Set(out)].join("\n"));
})().catch((e) => { console.error(String(e)); process.exit(1) });
' "$TOKEN" "$V")"
[ -n "$LISTA" ] || { echo "El token no ve ningún número. Revisa que el usuario del sistema tenga asignada la cuenta de WhatsApp con control total."; exit 1; }
echo "Números encontrados:"; echo "$LISTA" | nl -w2 -s') ' | awk -F'\t' '{print $1"  "$4"  ("$5", cuenta: "$2")\n     "$6}'
read -r -p "¿Cuál es el de la empresa? (número de la lista): " N
FILA="$(echo "$LISTA" | sed -n "${N}p")"
[ -n "$FILA" ] || { echo "Opción no válida. No se cambió nada."; exit 1; }
WABA="$(echo "$FILA" | cut -f1)"; PHONE="$(echo "$FILA" | cut -f3)"

# 2) Llaves en Supabase (sin mostrarlas).
VERIFY="$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('base64url'))")"
ENV_FILE="$(mktemp)"; trap 'rm -f "$ENV_FILE"' EXIT
printf 'WHATSAPP_TOKEN=%s\nWHATSAPP_PHONE_ID=%s\nMETA_APP_SECRET=%s\nMETA_VERIFY_TOKEN=%s\n' "$TOKEN" "$PHONE" "$SECRETO" "$VERIFY" > "$ENV_FILE"
supabase secrets set --env-file "$ENV_FILE" >/dev/null
echo "Llaves guardadas en Supabase."

# 3) La app recibe los mensajes de esa cuenta de WhatsApp (Leadsales sigue recibiéndolos también).
R="$(api -X POST "https://graph.facebook.com/$V/$WABA/subscribed_apps")"
echo "$R" | grep -q '"success":true' && echo "App suscrita a la cuenta de WhatsApp." || { echo "No se pudo suscribir la app: $R"; exit 1; }

cat <<FIN

Último paso, en developers.facebook.com → tu app → WhatsApp → Configuración → Webhook → Editar:
  URL de devolución de llamada:  $SUPABASE_URL/functions/v1/meta-webhook
  Token de verificación:          $VERIFY
Luego, en "Campos del webhook", suscríbete a:  messages

El canal queda en MODO ESPEJO: los WhatsApp se ven en Conversaciones y Leadsales sigue contestando.
FIN
