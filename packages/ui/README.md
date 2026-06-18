# @renovacell/ui

Sistema de diseño compartido. Una sola fuente de verdad para los tokens de marca
(colores, radios, sombras, tipografías) usados por `apps/web` y `apps/landing`.

- `tokens.css` — variables CSS (`:root`). Importar en el CSS de cada app **antes** de `@tailwind`.
- `tailwind-preset.cjs` — preset de Tailwind con los mismos tokens como utilidades.

Origen: extraído de `reference/renovacell-sistema-prototype.html`. Si cambia la
marca, se edita aquí y se propaga a todas las apps.
