# Renovacell — Sistema operativo

Monorepo del sistema operativo de Renovacell: landing pública, sistema interno
(portal del doctor + módulos operativos) y la base de datos, sobre una sola base
de datos compartida ("una base, varias puertas").

## Estructura

```
apps/web        Sistema interno (React + Vite + TS + Tailwind)
apps/landing    Landing pública + agente IA (se integra en el Módulo 1)
packages/db     Esquema Supabase (schema, RLS, auditoría, seeds)
packages/ui     Tokens de marca + preset de Tailwind
reference/      Prototipos HTML (especificación visual/funcional)
docs/           Documentación interna
```

Ver [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) para el detalle.

## Empezar (cuando toque desarrollar)

```bash
npm install                 # instala y enlaza los workspaces
cp .env.example .env        # poblar credenciales (cuando exista el proyecto Supabase)
npm run dev                 # levanta apps/web
```

> **Estado actual:** andamiaje organizado. Dependencias sin instalar y **sin
> proyecto Supabase creado** todavía — eso es el siguiente paso, deliberadamente.

## Base de datos

El esquema y las políticas de seguridad viven en [`packages/db`](packages/db).
Orden de ejecución y notas de seguridad en su README.

## Stack

React · Vite · TypeScript · Tailwind · Supabase · Netlify · GitHub.
