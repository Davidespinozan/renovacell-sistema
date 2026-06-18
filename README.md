# Renovacell — Sistema operativo (scaffold)

Este PR contiene el esqueleto del proyecto y los artefactos iniciales para arrancar el desarrollo.

Contenido creado:
- `package.json`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.cjs`, `postcss.config.cjs`
- `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/lib/supabaseClient.ts`
- `.env.example` (no incluyas credenciales reales aquí)
- `reference/renovacell-demo.html` (copia read-only del demo — especificación visual/funcional)
- `supabase/schema.sql` (esquema base ya presente)
- `supabase/rls.sql` (RLS policies draft — revisar)
- `supabase/seeds/seed_products.sql` (seed con catálogo demo)
- `supabase/audit_triggers.sql` (triggers para auditoría de orders/shipments)

Instrucciones:
1. Crear un proyecto Supabase NUEVO y exclusivo para Renovacell.
2. Copiar `.env.example` → `.env` y poblar las variables (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY).
3. Ejecutar las migraciones/SQL en el orden:
   - `supabase/schema.sql`
   - `supabase/rls.sql` (revisar políticas y adaptar roles)
   - `supabase/audit_triggers.sql`
   - `supabase/seeds/seed_products.sql` (usa service role key)

No instalaré dependencias ni ejecutaré comandos hasta que confirmes.

Próximo paso si apruebas: crear PR formal con estos cambios y continuar con el scaffold completo (instalación y scripts de dev).
