# Ensayo "día de operación" (E2E contra un stack LOCAL)

Recorre la app real (navegador) con cada rol contra una copia local de Supabase: base, Auth, Realtime y Edges.
Nunca toca producción. Se usó el 29 oct 2026, la víspera de operar.

## Levantar el stack

Requiere Docker (OrbStack) y Chrome.

1. Copia `supabase/` a una carpeta aparte, quita las 5 migraciones solo-datos de producción (las mismas que omite
   `supabase/tests/db/run.sh`), deja `seed.sql` vacío y cambia `project_id`.
2. `supabase start -x studio,imgproxy,vector,logflare,supavisor` y `supabase functions serve` en esa carpeta.
3. Catálogo y configuración reales (solo lectura de prod): exporta cada tabla de `import_prod.py` a `prod/<tabla>.json`
   y corre `python3 import_prod.py` → `psql -f import_prod.sql` contra `127.0.0.1:54322`.
4. Cuentas: `SR=<service_role local> node e2e/dia/seed.mjs` (mismos roles y capacidades que el personal real);
   después `psql -f e2e/dia/seed.sql` (clientes, cartera, domicilios, existencias).
5. App: `VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=<anon local> npx vite --mode e2e --port 4190`.

## Correr

- `node e2e/dia/pantallas.mjs` — cada cuenta abre TODAS sus pantallas y pestañas (secciones del menú abiertas);
  reporta caídas de render, errores de consola y respuestas HTTP ≥ 400 del backend.
- `node e2e/dia/paso.mjs <correo> '<acciones JSON>' <captura>` — explorador paso a paso
  (`ir`, `clic`, `sel`, `tipo`, `subir`, `espera`, `eval`); vuelca botones/campos visibles y guarda la captura.

Contraseña de las cuentas sembradas: la de `lib.mjs` (solo existe en el stack local).
