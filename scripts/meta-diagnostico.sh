#!/usr/bin/env bash
# Diagnóstico de Instagram y Messenger: con el token del usuario del sistema (no se muestra) revisa, desde el lado de
# Meta, si la página de la empresa ya puede LEER sus conversaciones de Instagram y de Messenger y si la app está
# suscrita a la página. No cambia nada en Meta ni en Supabase. No imprime nombres ni textos de clientes: solo cuentas y fechas.
set -euo pipefail
cd "$(dirname "$0")/.."
V="${META_GRAPH_VERSION:-v21.0}"
PORTFOLIO="${META_BUSINESS_ID:-1039088777609414}"
read -r -s -p "Token del usuario del sistema (no se mostrará): " TOKEN; echo
[ ${#TOKEN} -ge 50 ] || { echo "Ese token es muy corto; revisa que lo copiaste completo."; exit 1; }
node -e '
const [tok, v, portfolio] = process.argv.slice(1);
const get = async (u, t) => (await fetch(u, { headers: { Authorization: "Bearer " + (t || tok) } })).json();
const err = (r) => r && r.error ? ` ✗ Meta dijo: ${(r.error.message || "").replace(/\s+/g, " ").slice(0, 160)}` : null;
(async () => {
  const paginas = [];
  for (const edge of ["owned_pages", "client_pages"]) {
    const r = await get(`https://graph.facebook.com/${v}/${portfolio}/${edge}?fields=id,name,access_token,instagram_business_account{id,username},connected_instagram_account{id,username}`);
    for (const p of (r.data || [])) paginas.push(p);
  }
  if (!paginas.length) { console.log("El token no ve ninguna página del portfolio. Revisa los activos del usuario del sistema."); process.exit(1); }
  for (const p of paginas) {
    console.log(`\nPágina ${p.name} (${p.id})`);
    const ig = p.instagram_business_account || p.connected_instagram_account;
    console.log(`  Instagram vinculado: ${ig ? "@" + ig.username + " (" + ig.id + ")" : "NINGUNO"}`);
    if (!p.access_token) { console.log("  ✗ Sin token de página: el usuario del sistema no tiene control total de la página."); continue; }
    const pt = p.access_token;
    const dbg = (await get(`https://graph.facebook.com/${v}/debug_token?input_token=${encodeURIComponent(pt)}`)).data || {};
    const scopes = dbg.scopes || [];
    const nec = ["pages_messaging", "pages_manage_metadata", "instagram_basic", "instagram_manage_messages"];
    console.log(`  Permisos del token de página: ${scopes.join(", ") || "(ninguno)"}`);
    const faltan = nec.filter((s) => !scopes.includes(s));
    if (faltan.length) console.log(`  ✗ FALTAN: ${faltan.join(", ")}`);
    const sub = await get(`https://graph.facebook.com/${v}/${p.id}/subscribed_apps`, pt);
    if (err(sub)) console.log("  App suscrita a la página:" + err(sub));
    else if (!(sub.data || []).length) console.log("  ✗ Ninguna app está suscrita a la página (falta el paso de suscripción).");
    else for (const a of sub.data) console.log(`  App suscrita: ${a.name || a.id} → campos: ${(a.subscribed_fields || []).join(", ") || "(ninguno)"}`);
    for (const plat of ["messenger", "instagram"]) {
      const c = await get(`https://graph.facebook.com/${v}/${p.id}/conversations?platform=${plat}&limit=3&fields=updated_time`, pt);
      const e = err(c);
      if (e) console.log(`  Leer conversaciones de ${plat}:${e}`);
      else console.log(`  Leer conversaciones de ${plat}: ✓ sí puede (${(c.data || []).length ? "la más reciente " + new Date(c.data[0].updated_time).toLocaleString("es-MX") : "todavía no hay ninguna"})`);
    }
  }
  console.log(`
Cómo leerlo:
  · Si "Leer conversaciones de instagram" dice ✓ y la app está suscrita con "messages", el token y el vínculo están bien:
    lo que falta es que Meta AVISE al webhook. Eso se arregla en la app de Meta, no aquí (ver el mensaje de Claude).
  · Si dice ✗ con un error de permisos, el token o el caso de uso no alcanzan para Instagram todavía.`);
})().catch((e) => { console.error(String(e)); process.exit(1) });
' "$TOKEN" "$V" "$PORTFOLIO"
