# @renovacell/landing — Landing pública + Agente IA (Módulo 1)

Landing **pública** de Renovacell (sitio de marketing, catálogo, captación con
agente IA). Importada del repo original (solo front + assets reales; sin `.git`,
`.env`, `node_modules` ni secretos).

- `index.html` — landing autónoma (estilos + imágenes inline). Es PÚBLICA (anon,
  sin login); se distingue de la app autenticada en el ruteo.
- Su propio deploy en Netlify (base directory `apps/landing`), separado del
  sistema interno (`apps/web`).

## Preview en el sistema
Para previsualizarla dentro de la app (dev), hay una copia espejo en
`apps/web/public/landing/index.html` que se sirve en `/landing/index.html`, y la
pantalla **"Landing"** del switch "Ver como" la muestra en un iframe.

## Assets reales compartidos
El **logo** se extrajo a `apps/web/public/brand/logo.png` para que toda la app lo
use (login, sidebar). Las imágenes de producto viven inline en la landing.

## Captación pública (conectada)
El formulario "Solicita tu acceso" entra por la Edge Function **`capture-lead`**
(pública, `--no-verify-jwt`), que corre con `service_role` y hace dedup +
auto-asignación balanceada al vendedor con menos carga + aviso a Dirección. No se
abre `anon` a la tabla `prospects` (sigue staff-only). Incluye honeypot anti-spam.

Para activarla en el deploy público, pon en `content.json → capture`:
```json
"capture": { "url": "https://<ref>.supabase.co/functions/v1/capture-lead", "anonKey": "<tu anon key PÚBLICA>" }
```
La `anonKey` es pública (la misma del sistema); se deja fuera del repo por higiene.
Sin `anonKey`, el formulario agradece igual pero no envía (degradación segura).

## Pendiente (al conectar)
- Agente IA de orientación (respuestas con modelo real).
- Conectores de otros canales (WhatsApp/Meta) al mismo motor `capture-lead`.
- Ritmo/migración de assets a Supabase Storage.
