# Arquitectura — Renovacell

Monorepo del sistema operativo Renovacell. Principio rector de la propuesta:
**"una base, varias puertas"** — una sola base de datos; cada rol entra por su
puerta y ve solo lo suyo.

## Estructura

```
renovacell/
  apps/
    web/        @renovacell/web      Sistema interno: portal del doctor + 6 módulos (rutas con gating por rol)
    landing/    @renovacell/landing  Landing pública + agente IA (vacío; subtree en Módulo 1)
  packages/
    db/         @renovacell/db       Esquema Supabase: schema, rls, audit, seeds (fuente de verdad de datos)
    ui/         @renovacell/ui       Tokens de marca + preset de Tailwind (compartidos)
  reference/                         Prototipos HTML (spec viva, read-only)
  docs/                              Documentación interna (esta carpeta)
```

Gestión con **npm workspaces** (ver `package.json` raíz). Desde la raíz:

- `npm install` — instala todo y enlaza los paquetes del workspace.
- `npm run dev` — levanta `apps/web` (Vite).
- `npm run build` — build de `apps/web`.

> Nota: las dependencias **aún no están instaladas** y **no hay proyecto Supabase
> creado todavía**. Esto es andamiaje; conectar Supabase es un paso posterior.

## Stack

React + Vite + TypeScript + Tailwind · Supabase (DB + auth) · Netlify (hosting) · GitHub.
Integraciones futuras: Stripe (pago), Facturama (CFDI), Estafeta/DHL (paquetería), agente IA.

## Despliegue (Netlify)

Dos sites apuntando al **mismo repo** con distinto *base directory*:
- `apps/landing` → sitio público (SEO).
- `apps/web` → sistema interno (tras login).

Comparten `@renovacell/ui` y `@renovacell/db`. Repo **privado** (datos de médicos).

## Módulos y fases (de la propuesta)

| # | Módulo | Fase |
|---|--------|------|
| 1 | Landing + Agente IA | 1 · Comercial |
| 2 | Portal del Doctor | 1 · Comercial |
| 3 | Almacén (FEFO) | 2 · Operación |
| 4 | Empaque (guías, PDF) | 2 · Operación |
| 5 | Punto de Venta | 2 · Operación |
| 6 | Administración (tablero, CFDI, COFEPRIS) | 3 · Admin + automatización |
| + | Comunicación interna · Chofer | Add-ons |

## Base de datos

Ver [`packages/db/README.md`](../packages/db/README.md) para el orden de ejecución
y las notas de seguridad. RLS activo en las 12 tablas, default-deny, sin acceso `anon`.

## Decisiones registradas

- **Base del monorepo**: este repo (`renovacell-sistema`); se renombrará a `renovacell` en GitHub.
- **Unión de repos** con preservación de historia vía `git subtree`:
  - landing (`github.com/Davidespinozan/renovacell`) → `apps/landing/` (en Módulo 1).
- **La propuesta comercial NO entra al repo** (material de venta; repo del cliente).
