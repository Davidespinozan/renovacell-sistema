# Sistema de diseño · Renovacell

Portado de STRYV Design System V1 (`stryv-restaurant-template-1/docs/design-system/STRYV_DESIGN_SYSTEM_V1.md`) y
adaptado (15 nov 2026, auditoría UX). Tokens: `apps/web/src/styles/ds.css`. Candado: `apps/web/src/app/ds.test.ts`.

## Reglas

1. **Una acción principal por pantalla**, siempre en el mismo lugar (arriba a la derecha en escritorio; botón fijo abajo en el celular).
2. **La marca es acento, no fondo.** El verde Renovacell solo marca lo activo y la acción principal. Lienzo neutro, superficies blancas.
3. **Sin párrafos de explicación encima de las pantallas.** Un título; la ayuda va en «Cómo funciona» (`PageHead`) o en la pantalla vacía.
4. **Una sola superficie por bloque.** Nada de tarjetas dentro de tarjetas; filas separadas por línea, toda la fila se toca.
5. **Colores de estado fijos:** verde listo · ámbar pendiente · rojo urgente o error · azul en curso · gris neutro. El rojo no se usa para avisar ni para destacar.
6. **Escala corta:** 6 tamaños de letra (`--ds-fs-xs … --ds-fs-2xl`), 3 radios (`--ds-r-sm`, `--ds-r`, `--ds-r-lg`) y 3 sombras. Los campos de texto van a 16 px en el celular (iOS no hace zoom).
7. **Toda pantalla vacía o con error tiene un siguiente paso** (`Vacio` con `accion`, `ErrorCarga` con «Reintentar»). Los esqueletos (`Cargando`) en vez de «Cargando…».
8. **Avisos breves con `toast()`** (`app/Toast.tsx`): «Listo» en verde, error en rojo. Nunca `alert()` ni `window.confirm` (para confirmar: `confirmar()` de `app/dialogos`).
9. **Formularios y acciones en una hoja** (`app/Hoja.tsx`): sube desde abajo en el celular, diálogo en escritorio; encabezado y botón principal fijos.
10. **Un botón deshabilitado dice por qué**; no se oculta.

## Cómo migrar una pantalla

1. Cambia cada color literal (`#…`, `rgb(…)`) por su token `var(--ds-…)`.
2. Quita los párrafos de explicación y las cajas anidadas.
3. Agrega el archivo a `MIGRADOS` en `app/ds.test.ts`. La lista solo crece: el candado impide que vuelva a ensuciarse.
