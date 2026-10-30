// CUSTOMER 360 (C360-F2B → C360-F3) — superficie administrativa del cliente, de PÁGINA completa.
// Lee del servidor (`cliente_360`, redacción por rol) y edita SOLO con comandos (cliente_*); la cartera se
// asigna con los comandos de CC-7. Pestañas solo con datos canónicos para el rol; divulgación progresiva.
// Lo profesional/verificación se muestra (sin evidencia biométrica); no se edita aquí.
import { PerfilComercialEditor } from './PerfilComercialEditor'
import { InvitarCliente } from './InvitarCliente'
import React, { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, Mail, Phone, MapPin, UserCheck, UserX, IdCard, Building2, ShoppingBag, Receipt, FileText, Clock, MessageCircle, ShieldCheck } from 'lucide-react'
import { initials, avatarColor, money, fmtDate } from '../lib/format'
import { useCustomer360 } from '../data/hooks/useCustomer360'
import {
  cliente360 as clientePorDefecto, pestanasDe, ETIQUETA_PESTANA, ETIQUETA_EVENTO, telefonoPrincipal, domicilioPredeterminado, perfilFiscalPredeterminado,
  estadoVerificacion, lineaDomicilio, type Cliente360, type ClienteC360, type Pestana,
} from '../data/ops/customer360'
import { atencion as atencionPorDefecto, type ClienteAtencion, type Vendedor } from '../data/ops/atencion'
import { chat as chatPorDefecto, ETIQUETA_MODO, type ModoConversacion } from '../data/ops/chat'
import { HistorialConversacion, type CacheSesion, type LectorSesiones } from '../screens/chat/HistorialSesiones'   // Chat V2-C3
import { TelefonosEditor, DomiciliosEditor, PerfilesFiscalesEditor, ContactoEditor, NotasPanel } from './Cliente360Editores'
import { AvisoCancelacion, SolicitarCancelacion } from './Cancelacion'
import { useRole } from '../auth/RoleContext'
import { CancelOrderModal } from './CancelOrderModal'
import { solicitudDe, useSolicitudesCancelacion } from '../data/ops/cancelacionSolicitud'

function Section({ icon, title, aside, children }: { icon: React.ReactNode; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ color: 'var(--ink-3)', display: 'inline-flex' }}>{icon}</span>
        <div className="eyebrow" style={{ margin: 0 }}>{title}</div>
        {aside && <span style={{ marginLeft: 'auto' }}>{aside}</span>}
      </div>
      {children}
    </section>
  )
}
const Empty = ({ children }: { children: React.ReactNode }) => <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>{children}</div>
function Field({ label, value, note }: { label: string; value: string | null | undefined; note?: string | null }) {
  const v = (value ?? '').toString().trim()
  return (
    <div style={{ display: 'flex', gap: 10, padding: '5px 0', alignItems: 'baseline', minWidth: 0 }}>
      <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--ink-3)', minWidth: 116 }}>{label}</span>
      <span style={{ fontSize: 13.5, flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{v || <span style={{ color: 'var(--ink-3)' }}>—</span>}{v && note && <span style={{ fontSize: 11, color: 'var(--ink-3)' }}> · {note}</span>}</span>
    </div>
  )
}
const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0 18px' }
const ESTADO_PAGO: Record<string, string> = { pagado: 'Pagado', pendiente: 'Pendiente', parcial: 'Parcial', credito: 'A crédito', liberado: 'Liberado' }

export function Customer360Page({ customerId, onBack, canOrder = false, onOrder, onAsesorias, cliente = clientePorDefecto, atencion = atencionPorDefecto, inicial, lectorChat = chatPorDefecto }: {
  customerId: string; inicial?: { nombre: string; email?: string | null; portal?: boolean }; onBack: () => void; canOrder?: boolean; onOrder?: () => void; onAsesorias?: () => void; cliente?: ClienteC360; atencion?: ClienteAtencion; lectorChat?: LectorSesiones
}) {
  const { data, loading, error, recargar } = useCustomer360(customerId, cliente)
  const [tab, setTab] = useState<Pestana>('resumen')
  const tabs = useMemo(() => (data ? pestanasDe(data) : []), [data])

  return (
    <div className="grid" style={{ gap: 14, maxWidth: 1040 }} data-testid="cliente-360">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" className="btn ghost sm" onClick={onBack} data-testid="c360-volver"><ChevronLeft size={15} /> Directorio</button>
        {data && (
          <>
            <div className="avatar" style={{ background: avatarColor(data.resumen.nombre || '?') }}>{initials(data.resumen.nombre || '?')}</div>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: 20 }}>{data.resumen.nombre}</h2>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                <span className={'pill ' + (data.resumen.portal.tiene ? 'p-ok' : 'p-neu')} style={{ display: 'inline-flex', gap: 5 }}>{data.resumen.portal.tiene ? <UserCheck size={12} /> : <UserX size={12} />} {data.resumen.portal.tiene ? 'Con portal' : 'Sin portal'}</span>
                {data.resumen.portal.tiene && <span className={'pill ' + (data.resumen.portal.verificado ? 'p-ok' : 'p-warn')}>{estadoVerificacion(data).label}</span>}
                {!data.resumen.activo && <span className="pill p-dang">Inactivo</span>}
              </div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {!data.resumen.portal.tiene && data.resumen.activo && (data.rol === 'direccion' || data.rol === 'vendedor') && <InvitarCliente customerId={data.customer_id} />}
              {data.permisos.estado && <EstadoCliente customerId={data.customer_id} activo={data.resumen.activo} cliente={cliente} onCambio={recargar} />}
              {canOrder && onOrder && data.resumen.activo && <button type="button" className="btn sm" onClick={onOrder}>Levantar pedido</button>}
            </div>
          </>
        )}
        {!data && inicial && (
          // Encabezado provisional con lo que ya trae el directorio (sin backend o mientras carga el servidor).
          <>
            <div className="avatar" style={{ background: avatarColor(inicial.nombre || '?') }}>{initials(inicial.nombre || '?')}</div>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: 20 }}>{inicial.nombre}</h2>
              {inicial.email && <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{inicial.email}</div>}
              {inicial.portal !== undefined && <span className={'pill ' + (inicial.portal ? 'p-ok' : 'p-neu')} style={{ display: 'inline-flex', gap: 5, marginTop: 2 }}>{inicial.portal ? <UserCheck size={12} /> : <UserX size={12} />} {inicial.portal ? 'Con acceso al portal' : 'Sin acceso al portal'}</span>}
            </div>
          </>
        )}
      </div>
      {loading && !data && <div className="card"><Empty>Cargando ficha…</Empty></div>}
      {error && <div role="alert" className="card" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>{error}</div>}
      {data && (
        <>
          <div className="seg" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }} role="tablist">
            {tabs.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'active' : undefined} onClick={() => setTab(t)} data-testid={`tab-${t}`}>{ETIQUETA_PESTANA[t]}</button>)}
          </div>
          <div className="card" style={{ display: 'grid', gap: 12 }}>
            {tab === 'resumen' && <Resumen d={data} irA={setTab} />}
            {tab === 'contacto' && <Contacto d={data} cliente={cliente} recargar={recargar} />}
            {tab === 'domicilios' && (
              <Section icon={<MapPin size={15} />} title="Domicilios">
                <DomiciliosEditor customerId={data.customer_id} lista={data.domicilios.lista} archivados={data.domicilios.archivados} alta={data.domicilios.alta} editable={data.permisos.domicilios} puedeAdoptar={data.permisos.adoptar_alta} cliente={cliente} onCambio={recargar} />
              </Section>
            )}
            {tab === 'facturacion' && (
              <Section icon={<FileText size={15} />} title="Perfiles fiscales" aside={data.rol === 'vendedor' ? <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Vista resumida (Ventas)</span> : null}>
                <PerfilesFiscalesEditor customerId={data.customer_id} perfiles={data.facturacion} editable={data.permisos.fiscal} cliente={cliente} onCambio={recargar} />
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 8 }}>Cambiar un perfil no modifica los pedidos ni las facturas ya emitidas: cada pedido conserva el receptor con el que se pidió.</div>
              </Section>
            )}
            {tab === 'comercial' && <Comercial d={data} atencion={atencion} cliente={cliente} recargar={recargar} />}
            {tab === 'pedidos' && <Pedidos d={data} />}
            {tab === 'pagos' && <Pagos d={data} />}
            {tab === 'facturas' && <Facturas d={data} />}
            {tab === 'conversacion' && <Conversacion d={data} onAsesorias={onAsesorias} lector={lectorChat} />}
            {tab === 'actividad' && <Actividad d={data} />}
          </div>
        </>
      )}
    </div>
  )
}

function Resumen({ d, irA }: { d: Cliente360; irA: (t: Pestana) => void }) {
  const tel = telefonoPrincipal(d); const dom = domicilioPredeterminado(d); const fis = perfilFiscalPredeterminado(d); const conv = d.comercial?.conversacion
  return (
    <>
      <div className="grid sigs" style={{ gap: 10 }}>
        <div className="card sig"><div className="chip"><ShoppingBag size={16} /></div><div className="v">{d.resumen_pedidos.n}</div><div className="k">Pedidos</div></div>
        <div className="card sig"><div className="chip"><Receipt size={16} /></div><div className="v">{money(d.resumen_pedidos.total)}</div><div className="k">Total pedido</div></div>
        <div className="card sig"><div className="chip"><Clock size={16} /></div><div className="v" style={{ fontSize: 15 }}>{d.resumen_pedidos.ultimo ? fmtDate(d.resumen_pedidos.ultimo) : '—'}</div><div className="k">Último pedido</div></div>
      </div>
      <div style={grid2}>
        <Field label="Correo" value={d.contacto.email} />
        <Field label="Teléfono" value={tel?.numero ?? null} note={tel ? undefined : null} />
        <Field label="Entrega" value={dom ? `${dom.name} · ${lineaDomicilio(dom)}` : null} />
        <Field label="Facturación" value={fis ? `${fis.alias} · ${fis.rfc}` : (d.facturacion.length ? `${d.facturacion.length} perfil(es)` : null)} />
        <Field label="Vendedor" value={d.resumen.vendedor?.nombre ?? null} note={d.resumen.vendedor && !d.resumen.vendedor.elegible ? 'ya no puede atender' : null} />
        <Field label="Origen" value={d.resumen.origen} />
        {d.resumen.vendedor_historico && <Field label="Vendedor (importación)" value={d.resumen.vendedor_historico} note="referencia histórica, no es el vendedor actual" />}
        {conv && <Field label="Conversación" value={`${ETIQUETA_MODO[conv.modo as ModoConversacion] ?? conv.modo}${conv.asesor ? ` · ${conv.asesor}` : ''}`} />}
        {d.comercial?.carrito && <Field label="Carrito" value={`${d.comercial.carrito.n_items} producto(s)`} />}
      </div>
      {/* HERRAMIENTAS DEL VENDEDOR · doctor o clínica y su especialidad (solo lo ve quien la puede editar) */}
      <PerfilComercialEditor customerId={d.customer_id} />
      {d.profesional && (
        <Section icon={<IdCard size={15} />} title="Profesional y verificación" aside={<ShieldCheck size={14} />}>
          <div style={grid2}>
            <Field label="Cédula" value={d.profesional.cedula} />
            <Field label="Especialidad" value={d.profesional.especialidad} />
            <Field label="Organización" value={d.profesional.organizacion} />
            <Field label="Verificación" value={estadoVerificacion(d).label} />
            <Field label="Último acceso" value={d.profesional.ultimo_acceso ? new Date(d.profesional.ultimo_acceso).toLocaleString('es-MX') : null} />
          </div>
        </Section>
      )}
      {d.actividad && d.actividad.length > 0 && (
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Reciente: {d.actividad.slice(0, 3).map((e) => `${ETIQUETA_EVENTO[e.tipo] ?? e.tipo} (${fmtDate(e.at)})`).join(' · ')} <button type="button" className="btn ghost sm" onClick={() => irA('actividad')}>Ver actividad</button></div>
      )}
    </>
  )
}

function Contacto({ d, cliente, recargar }: { d: Cliente360; cliente: ClienteC360; recargar: () => Promise<void> }) {
  return (
    <>
      <Section icon={<Mail size={15} />} title="Datos de contacto" aside={<ContactoEditor customerId={d.customer_id} permitidos={d.permisos.contacto} valores={{ full_name: d.resumen.nombre, email: d.contacto.email, city: d.contacto.ciudad, country: d.contacto.pais }} cliente={cliente} onCambio={recargar} />}>
        <div style={grid2}>
          <Field label="Correo" value={d.contacto.email} />
          {d.contacto.email_portal && d.contacto.email_portal !== d.contacto.email && <Field label="Correo del portal" value={d.contacto.email_portal} note="acceso; se cambia en la cuenta" />}
          <Field label="Ciudad" value={d.contacto.ciudad} />
          <Field label="País" value={d.contacto.pais} />
          {d.contacto.alta?.telefono && !d.contacto.telefonos.some((t) => t.numero.replace(/\D/g, '').endsWith((d.contacto.alta?.telefono ?? '').replace(/\D/g, '').slice(-10))) && <Field label="Tel. del registro" value={d.contacto.alta.telefono} note="no registrado como teléfono" />}
        </div>
      </Section>
      <Section icon={<Phone size={15} />} title="Teléfonos">
        <TelefonosEditor customerId={d.customer_id} telefonos={d.contacto.telefonos} editable={d.permisos.telefonos} cliente={cliente} onCambio={recargar} />
      </Section>
      {d.contacto.notas && (
        <Section icon={<FileText size={15} />} title="Notas internas">
          <NotasPanel customerId={d.customer_id} notas={d.contacto.notas} legada={d.contacto.nota_legada} editable={d.permisos.notas} cliente={cliente} onCambio={recargar} />
        </Section>
      )}
    </>
  )
}

function Comercial({ d, atencion, cliente, recargar }: { d: Cliente360; atencion: ClienteAtencion; cliente: ClienteC360; recargar: () => Promise<void> }) {
  const c = d.comercial!
  const [vendedores, setVendedores] = useState<Vendedor[] | null>(null)
  const [sel, setSel] = useState(''); const [motivo, setMotivo] = useState(''); const [msg, setMsg] = useState<string | null>(null); const [ocupado, setOcupado] = useState(false)
  useEffect(() => { if (d.permisos.cartera) void atencion.vendedores().then((r) => r.ok && setVendedores(r.data)) }, [d.permisos.cartera, atencion])
  // CARTERA-CLIENTES · Dirección asigna vendedor a CUALQUIER cliente, tenga o no cuenta (el servidor decide dónde vive).
  const guardar = async (vendedor: string | null) => {
    if (ocupado) return
    setOcupado(true); setMsg(null)
    const a = await cliente.asignarVendedor(d.customer_id, vendedor, motivo.trim() || null)
    setOcupado(false)
    if (!a.ok) { setMsg(a.error); return }
    setSel(''); setMotivo(''); await recargar()
  }
  const actual = d.resumen.vendedor
  const elegibles = (vendedores ?? []).filter((v) => v.elegible_nuevos)
  // Se listan TODOS los vendedores activos; los que aún no pueden recibir clientes aparecen deshabilitados con el porqué.
  const faltan = (v: Vendedor): string => [!v.conversaciones && '"Atender conversaciones"', !v.nuevos_clientes && '"Recibir clientes nuevos"'].filter(Boolean).join(' y ')
  const todos = (vendedores ?? []).filter((v) => v.activo && v.id !== actual?.id)
  return (
    <>
      <Section icon={<Building2 size={15} />} title="Vendedor">
        <Field label="Actual" value={actual?.nombre ?? 'Sin vendedor asignado'} note={actual?.desde ? `desde ${fmtDate(actual.desde)}${actual.elegible ? '' : ' · ya no puede atender'}` : null} />
        {d.permisos.cartera && vendedores && (elegibles.length === 0
          ? <div className="sysnote" style={{ marginTop: 6 }} data-testid="sin-vendedores">Ningún vendedor puede recibir clientes todavía. En <b>Equipo</b>, edita al vendedor y actívale "Atender conversaciones" y "Recibir clientes nuevos".</div>
          : (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }} data-testid="cartera-asignar">
            <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)', minHeight: 36 }} aria-label="Vendedor">
              <option value="">{actual ? 'Cambiar a…' : 'Asignar a…'}</option>
              {todos.map((v) => <option key={v.id} value={v.id} disabled={!v.elegible_nuevos}>{v.elegible_nuevos ? v.nombre : `${v.nombre} · en Equipo actívale ${faltan(v)}`}</option>)}
            </select>
            {actual && <input placeholder="Motivo del cambio" aria-label="Motivo del cambio de vendedor" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)', minHeight: 36 }} />}
            <button type="button" className="btn sm" disabled={!sel || ocupado || (!!actual && !motivo.trim())} onClick={() => void guardar(sel)} data-testid="btn-asignar-vendedor">{actual ? 'Cambiar vendedor' : 'Asignar vendedor'}</button>
            {actual && <button type="button" className="btn ghost sm" disabled={ocupado || !motivo.trim()} title={motivo.trim() ? undefined : 'Escribe el motivo para quitarlo'} onClick={() => void guardar(null)} data-testid="btn-quitar-vendedor">Quitar vendedor</button>}
          </div>
        ))}
        {d.permisos.cartera && vendedores && elegibles.length > 0 && todos.some((v) => !v.elegible_nuevos) && (
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }} data-testid="vendedores-sin-permiso">Los vendedores en gris aún no pueden recibir clientes: en <b>Equipo</b>, edítalos y activa los permisos que se indican.</div>
        )}
        {msg && <div role="alert" style={{ color: 'var(--danger)', fontSize: 12.5 }}>{msg}</div>}
        {c.historial && c.historial.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--ink-3)' }}>Historial de asignación</div>
            {c.historial.map((h, i) => <div key={i} style={{ fontSize: 12.5, padding: '3px 0' }}>{fmtDate(h.at)} · {h.anterior ?? '—'} → {h.nuevo ?? 'sin vendedor'}{h.motivo ? ` · ${h.motivo}` : ''}</div>)}
          </div>
        )}
      </Section>
      <Section icon={<UserCheck size={15} />} title="Atribución (marketing)">
        <div style={grid2}>
          <Field label="Origen" value={c.atribucion.origen} />
          <Field label="Referido por" value={c.atribucion.referido?.vendedor ?? null} note="atribución; no es el vendedor actual" />
          <Field label="Prospecto" value={c.atribucion.prospecto ? [c.atribucion.prospecto.fuente, c.atribucion.prospecto.estado].filter(Boolean).join(' · ') : null} />
        </div>
      </Section>
    </>
  )
}

function Tabla({ cols, filas, vacio }: { cols: string[]; filas: React.ReactNode[][]; vacio: string }) {
  if (filas.length === 0) return <Empty>{vacio}</Empty>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead><tr>{cols.map((c) => <th key={c} style={{ textAlign: 'left', fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>{c}</th>)}</tr></thead>
        <tbody>{filas.map((f, i) => <tr key={i}>{f.map((v, j) => <td key={j} style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>{v}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}
// CANCELACIÓN · en los pedidos que aún no salen: Dirección cancela directo; Ventas la solicita.
const CANCELABLE = new Set(['draft', 'pending_payment', 'paid', 'picking', 'packed'])
function Pedidos({ d }: { d: Cliente360 }) {
  const { role } = useRole()
  const solicitudes = useSolicitudesCancelacion()
  const [cancelando, setCancelando] = useState<{ id: string; folio: string } | null>(null)
  const puede = role === 'admin' || role === 'pos'
  const accion = (p: Cliente360['pedidos'][number]): React.ReactNode => {
    if (!puede || !CANCELABLE.has(p.estado ?? '')) return null
    const sol = solicitudDe(solicitudes, p.id)
    if (sol) return role === 'admin' ? <AvisoCancelacion key="c" solicitud={sol} esDireccion /> : <span key="c" className="pill p-dang">Cancelación solicitada</span>
    return role === 'admin'
      ? <button key="c" type="button" className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => setCancelando({ id: p.id, folio: p.folio ?? p.id })}>Cancelar</button>
      : <SolicitarCancelacion key="c" orderId={p.id} folio={p.folio ?? p.id} />
  }
  return (
    <Section icon={<ShoppingBag size={15} />} title="Pedidos">
      <Tabla cols={puede ? ['Folio', 'Fecha', 'Estado', 'Total', 'Pago', 'Saldo', ''] : ['Folio', 'Fecha', 'Estado', 'Total', 'Pago', 'Saldo']} vacio="Sin pedidos." filas={d.pedidos.map((p) => [<span key="f" className="mono">{p.folio ?? '—'}</span>, fmtDate(p.fecha), p.estado ?? '—', money(p.total ?? 0), ESTADO_PAGO[p.estado_pago ?? ''] ?? p.estado_pago ?? '—', p.saldo != null ? money(p.saldo) : '—', ...(puede ? [accion(p)] : [])])} />
      {cancelando && <CancelOrderModal orderId={cancelando.id} folio={cancelando.folio} requireReason actor="Administración" onClose={() => setCancelando(null)} />}
    </Section>
  )
}
const Pagos = ({ d }: { d: Cliente360 }) => (
  <>
    <Section icon={<Receipt size={15} />} title="Movimientos de pago (libro W2)">
      <Tabla cols={['Pedido', 'Fecha', 'Tipo', 'Método', 'Monto']} vacio="Sin movimientos de pago." filas={(d.pagos ?? []).map((p) => [p.pedido ?? '—', p.fecha ? fmtDate(p.fecha) : '—', p.direccion === 'in' ? 'Cobro' : p.direccion === 'out' ? 'Reembolso' : p.direccion, p.metodo ?? '—', money(p.monto)])} />
    </Section>
    {(d.pagos_reportados ?? []).length > 0 && (
      <Section icon={<Clock size={15} />} title="Pagos reportados por el cliente">
        <Tabla cols={['Pedido', 'Fecha', 'Método', 'Monto', 'Estado']} vacio="" filas={(d.pagos_reportados ?? []).map((p) => [p.pedido ?? '—', p.fecha ? fmtDate(p.fecha) : '—', p.metodo ?? '—', money(p.monto), p.estado])} />
      </Section>
    )}
  </>
)
const Facturas = ({ d }: { d: Cliente360 }) => (
  <Section icon={<FileText size={15} />} title="Facturas (CFDI)">
    <Tabla cols={['Pedido', 'Tipo', 'Estado', 'Serie-folio', 'UUID', 'Total', 'Fecha']} vacio="Sin facturas." filas={d.facturas.map((f) => [f.pedido ?? '—', f.tipo, f.estado, [f.serie, f.folio].filter(Boolean).join('-') || '—', <span key="u" className="mono" style={{ fontSize: 11 }}>{f.uuid ?? '—'}</span>, f.total != null ? money(f.total) : '—', fmtDate(f.fecha)])} />
  </Section>
)
function Conversacion({ d, onAsesorias, lector }: { d: Cliente360; onAsesorias?: () => void; lector: LectorSesiones }) {
  const c = d.comercial?.conversacion
  // Chat V2-C3 · historial de sesiones de SOLO LECTURA (la autoridad —cartera/Dirección— la decide el servidor).
  const [verHist, setVerHist] = useState(false)
  const [cache] = useState(() => new Map<string, CacheSesion>())
  return (
    <Section icon={<MessageCircle size={15} />} title="Conversación (CC)">
      {!c ? <Empty>Este cliente aún no ha conversado con Renovacell.</Empty> : (
        <div style={grid2}>
          <Field label="Estado" value={`${ETIQUETA_MODO[c.modo as ModoConversacion] ?? c.modo}${c.estado === 'cerrada' ? ' · cerrada' : ''}`} />
          <Field label="Asesor" value={c.asesor} />
          <Field label="Último mensaje" value={c.ultimo_mensaje_at ? new Date(c.ultimo_mensaje_at).toLocaleString('es-MX') : null} />
          <Field label="Origen" value={c.origen === 'carrito' ? 'Activó un carrito' : c.origen === 'manual' ? 'Pidió asesor' : null} />
        </div>
      )}
      {c && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          {!verHist && <button type="button" className="btn sm" style={{ minHeight: 44 }} onClick={() => setVerHist(true)} data-testid="c360-historial">Ver historial</button>}
          {onAsesorias && <button type="button" className="btn ghost sm" style={{ minHeight: 44 }} onClick={onAsesorias} data-testid="c360-asesorias">Abrir en Asesorías</button>}
        </div>
      )}
      {c && verHist && (
        <div className="rc-chat rc-hist-c360" data-testid="c360-historial-panel">
          <HistorialConversacion conversationId={c.id} lector={lector} visor="personal" nombreCliente={d.resumen.nombre} cache={cache}
            onActual={() => setVerHist(false)} etiquetaVolver="Cerrar historial" etiquetaFin="Cerrar historial" />
        </div>
      )}
      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 6 }}>El historial vive en la conversación canónica (solo lectura aquí); no se duplica.</div>
    </Section>
  )
}
const Actividad = ({ d }: { d: Cliente360 }) => (
  <Section icon={<Clock size={15} />} title="Actividad">
    {(d.actividad ?? []).length === 0 ? <Empty>Sin actividad registrada.</Empty> : (d.actividad ?? []).map((e, i) => (
      <div key={i} style={{ fontSize: 12.5, padding: '5px 0', borderBottom: '1px solid var(--line)', display: 'flex', gap: 10 }}>
        <span style={{ color: 'var(--ink-3)', minWidth: 130 }}>{new Date(e.at).toLocaleString('es-MX')}</span>
        <span style={{ flex: 1 }}>{ETIQUETA_EVENTO[e.tipo] ?? e.tipo}{e.actor ? ` · ${e.actor}` : ''}</span>
      </div>
    ))}
  </Section>
)

// CARTERA-CLIENTES · Dirección da de baja o reactiva al cliente. La baja exige motivo y no borra nada.
function EstadoCliente({ customerId, activo, cliente, onCambio }: { customerId: string; activo: boolean; cliente: ClienteC360; onCambio: () => Promise<void> }) {
  const [abierto, setAbierto] = useState(false); const [motivo, setMotivo] = useState(''); const [msg, setMsg] = useState<string | null>(null); const [ocupado, setOcupado] = useState(false)
  const guardar = async (nuevo: boolean) => {
    if (ocupado) return
    setOcupado(true); setMsg(null)
    const r = await cliente.guardarEstado(customerId, nuevo, motivo.trim() || null)
    setOcupado(false)
    if (!r.ok) { setMsg(r.error); return }
    setAbierto(false); setMotivo(''); await onCambio()
  }
  if (activo && !abierto) return <button type="button" className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => setAbierto(true)} data-testid="btn-dar-baja">Dar de baja</button>
  if (!activo) return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <button type="button" className="btn sm" disabled={ocupado} onClick={() => void guardar(true)} data-testid="btn-reactivar">Reactivar cliente</button>
      {msg && <span role="alert" style={{ color: 'var(--danger)', fontSize: 12 }}>{msg}</span>}
    </span>
  )
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }} data-testid="form-baja">
      <input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} placeholder="Motivo de la baja" aria-label="Motivo de la baja" style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)', minHeight: 34 }} />
      <button type="button" className="btn sm" style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }} disabled={ocupado || !motivo.trim()} onClick={() => void guardar(false)} data-testid="btn-confirmar-baja">Dar de baja</button>
      <button type="button" className="btn ghost sm" onClick={() => { setAbierto(false); setMotivo(''); setMsg(null) }}>Cancelar</button>
      {msg && <span role="alert" style={{ color: 'var(--danger)', fontSize: 12 }}>{msg}</span>}
    </span>
  )
}
