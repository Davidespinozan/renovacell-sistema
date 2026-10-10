// CC-2 · Guardas de repositorio: la migración sostiene las invariantes por base; la Edge `chat`
// deriva el actor del servidor y no registra contenido; el frontend nunca manda autoridad;
// `/chat` está enrutado; la cola no toca Bandeja (A3.2); legacy intacto.
import { describe, it, expect } from 'vitest'
import mig from '../../../../../supabase/migrations/20261028120000_cc2_conversacion.sql?raw'
import down from '../../../../../supabase/rollback/cc2/99_down.sql?raw'
import chatSrc from '../../../../../supabase/functions/chat/index.ts?raw'
import chatShared from '../../../../../supabase/functions/_shared/chat.ts?raw'
import limiteSrc from '../../../../../supabase/functions/_shared/limite.ts?raw'
import opsSrc from './chat.ts?raw'
import pantallaSrc from '../../screens/chat/ChatCanonico.tsx?raw'
import asesoriasSrc from '../../screens/chat/Asesorias.tsx?raw'
import appSrc from '../../App.tsx?raw'
import rolesSrc from '../../app/roles.ts?raw'
import registrySrc from '../../screens/registry.tsx?raw'
import netlify from '../../../../../netlify.toml?raw'
import landingSrc from '../../../public/landing/index.html?raw'
import legacyChatStore from '../store/chatStore.ts?raw'

const codigo = (s: string) => s.split('\n').filter((l) => !/^\s*(--|\/\/|#)/.test(l)).join('\n')

describe('migración CC-2', () => {
  const c = codigo(mig)
  it('C1/C3 · una abierta por dueño; FK restrict (nada se borra en cascada desde visitante)', () => {
    expect(c).toMatch(/create unique index uq_ccc_visitor_abierta on public\.cc_conversations \(visitor_id\) where estado = 'abierta' and visitor_id is not null and profile_id is null/)
    expect(c).toMatch(/create unique index uq_ccc_profile_abierta on public\.cc_conversations \(profile_id\) where estado = 'abierta' and profile_id is not null/)
    expect(c).toMatch(/visitor_id\s+uuid references public\.cc_visitors\(id\) on delete restrict/)
    expect(c).toMatch(/conversation_id\s+uuid not null references public\.cc_conversations\(id\) on delete restrict,\n\s+seq/)
  })
  it('C7/C8/C9/C10 · identidad del actor por constraint; append-only; idempotencia por índice único', () => {
    expect(c).toMatch(/constraint ck_ccm_identidad check \(\n\s+case actor_type\n\s+when 'visitor' then actor_visitor_id is not null and actor_profile_id is null\n\s+when 'ai'\s+then actor_visitor_id is null and actor_profile_id is null/)
    expect(c).toMatch(/create trigger trg_ccm_append_only before update or delete on public\.cc_messages/)
    expect(c).toMatch(/create unique index uq_ccm_idempotencia on public\.cc_messages\n\s+\(conversation_id, actor_type, coalesce\(actor_profile_id::text, actor_visitor_id::text, ''\), client_message_id\) where client_message_id is not null/)
    expect(c).toMatch(/raise exception 'IDEMPOTENCIA_CONFLICTO'/)
  })
  it('C12 · la IA solo en ai_active/human_offered/human_requested; C13 · autoasignación solo desde la cola; capability conversaciones', () => {
    expect(c).toMatch(/if p_actor_type = 'ai' and c\.modo not in \('ai_active', 'human_offered', 'human_requested'\) then\n\s+raise exception 'IA_SILENCIADA/)
    expect(c).toMatch(/p_seller = p_actor_profile and c\.modo = 'human_requested' and c\.seller_profile_id is null/)
    expect(c).toMatch(/\(p\.role_id = 'pos' and \(p\.meta -> 'capabilities'\) \? 'conversaciones'\)/)
  })
  it('K · máquina de estados explícita; human_active → ai_active NO es válida (termina primero)', () => {
    expect(c).toMatch(/\('human_active', 'human_ended'\), \('human_active', 'human_assigned'\)/)
    const tabla = c.slice(c.indexOf('select (p_de, p_a) in ('), c.indexOf("('human_ended', 'ai_active')"))
    expect(tabla).not.toMatch(/\('human_active', 'ai_active'\)/)
    expect(c).toMatch(/raise exception 'TRANSICION_INVALIDA: % → %'/)
  })
  it('O · adopción integrada atómicamente y sin reescribir mensajes; purga excluye conversaciones', () => {
    expect(c).toMatch(/convs := public\._cc_adoptar_conversaciones\(v\.id, p_profile\)/)
    expect(c).toMatch(/perform public\._cc_evento\(r\.id, 'visitor_adopted', 'doctor', p_profile, p_visitor\)/)
    expect(c).not.toMatch(/update public\.cc_messages/)
    expect(c).toMatch(/and not exists \(select 1 from public\.cc_conversations c where c\.visitor_id = v\.id\)/)
  })
  it('U/AE · RLS en 4 tablas; clientes solo SELECT por política (dueño/asesor/Dirección); comandos solo service_role; cola vía RPC', () => {
    for (const t of ['cc_conversations', 'cc_participants', 'cc_messages', 'cc_conversation_events']) expect(c).toContain(`alter table public.${t} enable row level security`)
    expect(c).toMatch(/grant select on public\.cc_conversations, public\.cc_participants, public\.cc_messages, public\.cc_conversation_events to authenticated/)
    expect(c).toMatch(/using \(profile_id = auth\.uid\(\) or seller_profile_id = auth\.uid\(\) or public\.auth_role\(\) = 'admin'\)/)
    expect(c).not.toMatch(/for (insert|update|delete) to authenticated/)
    expect(c).toMatch(/grant execute on function public\.cc_cola_asesorias\(\) to authenticated, service_role/)
    expect(c).not.toMatch(/grant execute on function public\.cc_enviar_mensaje[^\n]*to authenticated/)
    expect(c).not.toMatch(/alter publication supabase_realtime/)
  })
  it('AA · eventos sin contenido; mensajes de sistema solo desde comandos', () => {
    expect(c).not.toMatch(/_cc_evento\([^)]*content/)
    expect(c).toMatch(/create or replace function public\._cc_sistema/)
    expect(c).toMatch(/revoke all on function[\s\S]*public\._cc_sistema\(uuid, text, text\)[\s\S]*from public, anon/)
  })
  it('rollback: retira el dominio y devuelve adopción/purga a CC-1', () => {
    const d = codigo(down)
    expect(d).toMatch(/drop table if exists public\.cc_messages/); expect(d).toMatch(/drop table if exists public\.cc_conversations/)
    expect(d).toMatch(/create or replace function public\.cc_visitante_adoptar/); expect(d).not.toMatch(/_cc_adoptar_conversaciones\(v\.id/)
  })
})

describe('Edge chat + módulo compartido', () => {
  const s = codigo(chatSrc); const sh = codigo(chatShared)
  it('C7/C8 · el actor sale de derivarActor(JWT|hash); el cliente no manda actor/profile; seller solo se asigna a sí mismo salvo Dirección', () => {
    expect(s).toMatch(/const actor = derivarActor\(quien, hash\)/)
    expect(s).not.toMatch(/p\.actor_type|p\.actor|p\.profile_id|p\.visitor_id/)
    expect(s).toMatch(/p_actor_profile: quien\.uid, p_seller: seller/)
    expect(sh).not.toMatch(/^import /m)
  })
  it('AB · sin telemetría ni logs de contenido; errores mapeados; CORS lista blanca; limitador en abrir/enviar/solicitar', () => {
    expect(s).not.toMatch(/console\.(log|error|warn)/); expect(s).not.toMatch(/_shared\/observa/)
    expect(s).toMatch(/mapearErrorChat\(e\?\.message\)/)
    expect(s).toMatch(/Deno\.serve\(conCors\(/); expect(s).not.toMatch(/'Access-Control-Allow-Origin': '\*'/)
    for (const sc of ['chat_abrir', 'chat_abrir_uid', 'chat_abrir_global', 'chat_enviar', 'chat_enviar_uid', 'chat_enviar_global', 'chat_solicitar']) {
      expect(s).toContain(`'${sc}'`); expect(codigo(limiteSrc)).toContain(`${sc}:`)
    }
  })
  it('S · la IA escribe solo desde el servidor como actor ai, idempotente, tras comprobar IA_PUEDE (re-anclado en CC-4: el adaptador temporal hacia `assistant` fue sustituido por el orquestador; el client_id ai:<seq> ahora lo fija la base en cc_ia_turno_responder)', () => {
    expect(s).toMatch(/ia = IA_PUEDE\(r\.modo\) \? await responderIA\(/)
    expect(s).toMatch(/ejecutarTurno\(/)
    expect(s).not.toMatch(/p_actor_type: 'ai'/)   // ningún INSERT/RPC directo como ai desde la Edge: solo el comando canónico de CC-4
    expect(s).not.toMatch(/api\.anthropic\.com/)
  })
})

describe('frontend', () => {
  it('cliente: token sí, autoridad no; client_message_id siempre', () => {
    const o = codigo(opsSrc)
    expect(o).toMatch(/token: this\.token\(\)/); expect(o).toMatch(/client_message_id = nuevoClientId\(\)/)
    const cuerpos = [...o.matchAll(/llamar<[^>]*>\(\{([^}]*)\}\)/g)].map((m) => m[1])
    expect(cuerpos.length).toBeGreaterThan(8)
    for (const b of cuerpos) expect(b).not.toMatch(/actor|profile_id|seller_profile_id|visitor_id/)
  })
  it('/chat enrutado en Netlify y en App (sin router); el componente sirve a visitante, doctor y asesor; la cola NO está en Bandeja', () => {
    expect(codigo(netlify)).toMatch(/from = "\/chat"\n\s+to = "\/index\.html"\n\s+status = 200/)
    expect(codigo(appSrc)).toMatch(/esRutaChat\) view = <ChatCanonico \/>/)
    expect(pantallaSrc).toMatch(/asesor \? 'Asesoría' : 'Renovacell'/)   // UX V2-B · encabezado de producto, no de panel
    expect(asesoriasSrc).toMatch(/cliente\.cola\(\)/)
    expect(codigo(asesoriasSrc)).not.toMatch(/Bandeja/)
  })
  it('capability `conversaciones` y pantallas chat_cc/asesorias registradas; doctor y pos las ven por rol/capability', () => {
    const r = codigo(rolesSrc)
    expect(r).toMatch(/'conversaciones'/); expect(r).toMatch(/key: 'conversaciones', label: 'Atender conversaciones'/)
    expect(r).toMatch(/\{ key: 'chat_cc', label: 'Habla con Renovacell', icon: 'chat' \}/)   // UX-1 · un solo módulo conversacional
    expect(codigo(registrySrc)).toMatch(/chat_cc: \(\) => <ChatCanonico embebido \/>,\n\s+asesorias: \(\) => <AsesoriasPantalla \/>/)   // CC-7 · Dirección vs vendedor
    expect(r).toMatch(/key: 'nuevos_clientes', label: 'Recibir clientes nuevos'/); expect(codigo(registrySrc)).toMatch(/av_atencion: \(\) => <AtencionComercialPantalla \/>/)
  })
  // Decisión del dueño (10 oct 2026): en la landing SOLO atiende el agente de orientación. La conversación
  // con un asesor humano existe dentro del sistema, tras la verificación. Antes esta guarda exigía el CTA.
  it('landing canónica: SIN enlace a /chat; conserva el agente y la identidad anónima del visitante', () => {
    expect(landingSrc).not.toMatch(/href\s*=\s*['"]\/chat['"]/)
    expect(landingSrc).not.toMatch(/rc-chat-cta|document\.createElement\('a'\)[^<]*\/chat/)
    expect(landingSrc).toMatch(/\/functions\/v1\/assistant/)                 // el agente de la landing
    expect(landingSrc).toMatch(/\/functions\/v1\/visitor/)                   // atribución del visitante (CC-1)
    expect(landingSrc).toMatch(/localStorage\.setItem\(KEY,d\.token\)/)       // el token de visitante persiste
  })
  it('AG · el chat interno de staff (legacy) sigue intacto', () => {
    expect(legacyChatStore).toMatch(/from\('messages'\)/); expect(legacyChatStore).not.toMatch(/cc_messages/)
  })
})
