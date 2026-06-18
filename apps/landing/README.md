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

## Pendiente (al conectar)
- Agente IA + captación pública de prospectos vía Edge Function (sin abrir `anon`).
- Ritmo/migración de assets a Supabase Storage.
