# Propuesta: Estructura, Routing y Esquema Supabase (borrador)

Resumen de propuestas basadas en la especificación visual/funcional y tu stack (React + Vite + TS + Tailwind + Supabase + Netlify).

**Estructura de carpetas (por módulo)**

- src/
  - main.tsx
  - App.tsx
  - index.css
  - lib/
    - supabaseClient.ts
    - auth.ts
  - components/
    - ui/ (botones, modales, layout)
  - modules/
    - landing/
      - index.tsx
      - routes.tsx
      - Landing.spec.md
    - doctor/
      - index.tsx
      - routes.tsx
    - warehouse/
      - index.tsx
      - routes.tsx
    - packing/
      - index.tsx
      - routes.tsx
    - pos/
      - index.tsx
      - routes.tsx
    - admin/
      - index.tsx
      - routes.tsx
    - comm/
      - index.tsx
      - routes.tsx
    - driver/
      - index.tsx
      - routes.tsx
  - pages/
  - hooks/
  - services/

**Routing y gating por rol**

- Rutas públicas: `/login`, `/callback` (OAuth), `/health` (internal)
- Lobby común: `/lobby` — vista común tras login donde se muestran `announcements` y assets.
- Rutas por rol protegidas detrás de middleware/RBAC:
  - `/doctor/*` — acceso: role `doctor`
  - `/warehouse/*` — access: `warehouse`
  - `/packing/*` — access: `packing`
  - `/pos/*` — access: `pos` (Punto de venta)
  - `/admin/*` — access: `admin` (admin puede `impersonate`)
  - `/comm/*` — access: `sales|admin|comm` (lectura pública interna)
  - `/driver/*` — access: `driver`

Implementación: `react-router` + `loader` middleware (client-side) que valida sesión con Supabase; Netlify will serve static assets.

**Orden de build / implementación recomendado**
1. Infra y auth: configurar Supabase project + tablas básicas (`users`, `roles`) y RLS; `supabaseClient` y login flow.
2. Lobby + Comunicación interna (comm): anuncios y assets — provee UX y roles mínimas.
3. Doctor portal (core): checkout contra pedido, catálogo interno, integración Stripe (modo test) y CFDI opcional.
4. Almacén: tablas de lotes, inventario y trazabilidad FEFO.
5. Empaque y guías: cola de empaque, generación de guías (integration placeholders).
6. Punto de Venta: UI POS y sincronización con inventario/pedidos.
7. Administración y reportes.
8. Chofer / seguimiento: marcar entregas y subir foto.

Razonamiento: empezar por auth/lobby permite crear usuarios y publicar assets; doctor portal y almacén son núcleo del negocio.

**Entregables de este PR**
- Esqueleto de carpetas (creado en repo)
- `supabase/schema.sql` con tablas y políticas base (archivo en `supabase/`)
- `PROPOSAL.md` (este archivo) con estructura y orden de trabajo

Revisa y aprueba para que genere los archivos iniciales del proyecto (package.json, configs) cuando autorices.
