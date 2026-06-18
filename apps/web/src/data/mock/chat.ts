// Datos MOCK del chat interno, con la forma de las tablas futuras
// `conversations` y `messages`. Grupos por área + DMs.
import type { Conversation, Message } from '../types'

// Usuario "logueado" en el chat (sin auth real todavía).
export const CURRENT_USER = { id: 'u-me', name: 'Tú' }

export const MOCK_CONVERSATIONS: Conversation[] = [
  { id: 'g-todos', kind: 'group', title: 'Todos', area: null, member_ids: [], created_at: '2026-06-01T08:00:00Z', last_message_at: '2026-06-18T09:10:00Z' },
  { id: 'g-almacen', kind: 'group', title: 'Almacén y Empaque', area: 'warehouse', member_ids: [], created_at: '2026-06-01T08:00:00Z', last_message_at: '2026-06-18T08:40:00Z' },
  { id: 'g-direccion', kind: 'group', title: 'Dirección', area: 'admin', member_ids: [], created_at: '2026-06-01T08:00:00Z', last_message_at: '2026-06-17T18:00:00Z' },
  { id: 'dm-claudia', kind: 'dm', title: 'Claudia Dirección', area: null, member_ids: ['u-me', 'u-claudia'], created_at: '2026-06-10T08:00:00Z', last_message_at: '2026-06-18T07:30:00Z' },
]

export const MOCK_MESSAGES: Record<string, Message[]> = {
  'g-todos': [
    { id: 'cm1', conversation_id: 'g-todos', sender_id: 'u-claudia', sender_name: 'Claudia Dirección', body: '¡Buen día equipo! Recuerden registrar todo en el sistema nuevo.', created_at: '2026-06-18T08:00:00Z' },
    { id: 'cm2', conversation_id: 'g-todos', sender_id: 'u-alberto', sender_name: 'Alberto Almacén', body: 'Listo, ya estamos surtiendo con FEFO.', created_at: '2026-06-18T09:10:00Z' },
  ],
  'g-almacen': [
    { id: 'cm3', conversation_id: 'g-almacen', sender_id: 'u-alberto', sender_name: 'Alberto Almacén', body: 'El lote STL-44 ya está por caducar, lo priorizo en el surtido.', created_at: '2026-06-18T08:40:00Z' },
  ],
  'g-direccion': [
    { id: 'cm4', conversation_id: 'g-direccion', sender_id: 'u-claudia', sender_name: 'Claudia Dirección', body: 'Revisemos los pedidos atorados en el tablero hoy.', created_at: '2026-06-17T18:00:00Z' },
  ],
  'dm-claudia': [
    { id: 'cm5', conversation_id: 'dm-claudia', sender_id: 'u-claudia', sender_name: 'Claudia Dirección', body: '¿Puedes revisar la facturación de S3683?', created_at: '2026-06-18T07:25:00Z' },
    { id: 'cm6', conversation_id: 'dm-claudia', sender_id: 'u-me', sender_name: 'Tú', body: 'Claro, lo veo ahora mismo.', created_at: '2026-06-18T07:30:00Z' },
  ],
}
