// Datos MOCK del hub (vista común), con la forma de las tablas `announcements`
// y `assets` de packages/db/schema.sql.
//
// Anuncios y Avisos viven ambos en `announcements`; se distinguen por
// metadata.kind ('anuncio' | 'aviso'). metadata.pinned = fijado.
// metadata.audience = rol destinatario (opcional, solo para avisos dirigidos).
import type { Announcement, Asset } from '../types'

// metadata.author = nombre para el avatar (con auth real vendrá del perfil).
// metadata.reactions / reads = contadores semilla (👍 / acuse de lectura).
export const MOCK_ANNOUNCEMENTS: Announcement[] = [
  {
    id: 'an-1', title: 'Nueva política de surtido FEFO obligatoria',
    body: 'A partir de esta semana, todo surtido debe seguir FEFO (primero lo que caduca antes). Almacén ya tiene el flujo en el sistema.',
    start_at: '2026-06-15T09:00:00Z', end_at: null, created_by: null,
    created_at: '2026-06-15T09:00:00Z',
    metadata: { kind: 'anuncio', pinned: true, audience: null, author: 'Claudia Dirección', reactions: 4, reads: 12 },
  },
  {
    id: 'an-2', title: 'Capacitación CFDI / Facturama el viernes',
    body: 'Sesión de 1h para el equipo de facturación sobre el timbrado CFDI. Sala 2, 10:00.',
    start_at: '2026-06-12T17:00:00Z', end_at: null, created_by: null,
    created_at: '2026-06-12T17:00:00Z',
    metadata: { kind: 'anuncio', pinned: false, audience: 'billing', author: 'Claudia Dirección', reactions: 2, reads: 5 },
  },
  {
    id: 'an-3', title: 'Bienvenida al nuevo sistema operativo',
    body: 'Estamos migrando de Odoo + Leadsales a nuestro propio sistema. Cualquier duda, en el canal del equipo.',
    start_at: '2026-06-10T08:00:00Z', end_at: null, created_by: null,
    created_at: '2026-06-10T08:00:00Z',
    metadata: { kind: 'anuncio', pinned: false, audience: null, author: 'STRYV', reactions: 8, reads: 14 },
  },
  {
    id: 'av-1', title: 'Pedido S12840 detenido',
    body: 'Surtido desde el 25/09, sin salir. Revisar antes de las 14:00.',
    start_at: '2026-06-18T08:30:00Z', end_at: null, created_by: null,
    created_at: '2026-06-18T08:30:00Z',
    metadata: { kind: 'aviso', pinned: true, audience: 'packing', author: 'Alberto Almacén', reactions: 1, reads: 3 },
  },
  {
    id: 'av-2', title: 'Lote STL-44 próximo a caducar',
    body: '9 piezas caducan en abril. Priorizar salida.',
    start_at: '2026-06-17T11:00:00Z', end_at: null, created_by: null,
    created_at: '2026-06-17T11:00:00Z',
    metadata: { kind: 'aviso', pinned: false, audience: 'warehouse', author: 'Alberto Almacén', reactions: 0, reads: 2 },
  },
  {
    id: 'av-3', title: 'Corte de caja del evento pendiente',
    body: 'Subir ventas del expo del fin de semana.',
    start_at: '2026-06-16T19:00:00Z', end_at: null, created_by: null,
    created_at: '2026-06-16T19:00:00Z',
    metadata: { kind: 'aviso', pinned: false, audience: 'pos', author: 'Ventas', reactions: 0, reads: 4 },
  },
]

export interface MockComment {
  id: string
  author: string
  text: string
  created_at: string
}

// Comentarios semilla por anuncio (con auth real -> tabla announcement_comments).
export const MOCK_COMMENTS: Record<string, MockComment[]> = {
  'an-1': [
    { id: 'c1', author: 'Alberto Almacén', text: 'Ya lo estamos aplicando en surtido.', created_at: '2026-06-15T10:10:00Z' },
    { id: 'c2', author: 'Ventas', text: 'Perfecto, evita las caducidades.', created_at: '2026-06-15T11:00:00Z' },
  ],
  'an-3': [
    { id: 'c3', author: 'Claudia Dirección', text: '¡Bienvenidos! Cualquier duda me avisan.', created_at: '2026-06-10T09:00:00Z' },
  ],
}

export const MOCK_ASSETS: Asset[] = [
  { id: 'as-1', key: 'Logo Renovacell — verde', url: '', uploaded_by: null, tags: ['logo', 'marca'], metadata: { type: 'logo' }, created_at: '2026-06-01T10:00:00Z' },
  { id: 'as-2', key: 'Logo Renovacell — blanco', url: '', uploaded_by: null, tags: ['logo', 'marca', 'negativo'], metadata: { type: 'logo' }, created_at: '2026-06-01T10:00:00Z' },
  { id: 'as-3', key: 'Isotipo (hoja)', url: '', uploaded_by: null, tags: ['logo', 'isotipo'], metadata: { type: 'logo' }, created_at: '2026-06-01T10:00:00Z' },
  { id: 'as-4', key: 'Ficha Golden Placenta', url: '', uploaded_by: null, tags: ['producto', 'ficha'], metadata: { type: 'image' }, created_at: '2026-06-05T10:00:00Z' },
  { id: 'as-5', key: 'Banner expo 2026', url: '', uploaded_by: null, tags: ['marketing', 'evento'], metadata: { type: 'image' }, created_at: '2026-06-08T10:00:00Z' },
  { id: 'as-6', key: 'Plantilla recibo PDF', url: '', uploaded_by: null, tags: ['documento', 'plantilla'], metadata: { type: 'doc' }, created_at: '2026-06-09T10:00:00Z' },
]
