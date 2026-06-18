# @renovacell/db — Base de datos (Supabase / Postgres)

Esquema, seguridad y semillas del sistema. **Aún no conectado a un proyecto
Supabase** (pendiente: crear el proyecto). Estos archivos son la fuente de verdad
del modelo de datos.

## Orden de ejecución

Correr en el SQL Editor de Supabase (o vía CLI) en este orden exacto:

1. `schema.sql` — tablas, índices, extensión `pgcrypto`, catálogo de roles.
2. `rls.sql` — Row Level Security en las 12 tablas, helpers y triggers de seguridad.
3. `audit_triggers.sql` — bitácora de auditoría (orders/shipments).
4. `seeds/seed_products.sql` — catálogo demo. **Usar la service role key** (ignora RLS).

## Notas de seguridad

- Default-deny: el rol `anon` no tiene acceso a ningún dato.
- La `service_role` key solo va del lado servidor (migraciones/seeds), nunca en el frontend.
- Validar todas las políticas en un proyecto de **staging** probando cada rol
  (doctor, warehouse, packing, pos, billing, driver, comm, admin) antes de producción.

## Pendientes (al construir los módulos)

- Captación pública de prospectos y catálogo público de landing: vía Edge Function
  / vista de columnas seguras (sin abrir `anon`).
- `order_items_guard`: validar el estado del pedido al insertar/editar renglones.
