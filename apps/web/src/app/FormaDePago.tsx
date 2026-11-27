// COBRO-U (23 nov 2026) · «Forma de pago», el MISMO paso en todos los puntos de venta: Caja (se lo lleva ahora y eventos),
// Levantar pedido / Enviar o recoger (ficha, directorio, chat, Doctores) y Cobrar pedidos. Mismas formas, mismos textos.
import React from 'react'
import { money } from '../lib/format'
import { hoyNegocio } from '../data/periodo'
import { CON_AL_RECIBIR, FORMAS, MAX_DIAS_CREDITO, faltaEnCobro, formaNoDisponible, sumarDiasISO, type CobroElegido, type FormaPago, type ModoCobro } from '../data/ops/cobro'

const input: React.CSSProperties = { flex: 1, minWidth: 0, padding: '9px 11px', border: '1px solid var(--line)', borderRadius: 12, fontFamily: 'inherit', fontSize: 14, outline: 'none', backgroundColor: 'var(--cp-surface, #fff)' }

export function FormaDePago({ total, modo, tipoEntrega = null, value, onChange, testId = 'forma-pago', preguntar = false }: {
  total: number
  modo: ModoCobro
  /** Tipo de entrega elegido (local, recoge, foraneo…): «Paga al recibir» solo aplica a chofer o recoger. */
  tipoEntrega?: string | null
  value: CobroElegido | null
  onChange: (c: CobroElegido | null) => void
  testId?: string
  /** «¿YA PAGÓ?» (27 nov 2026) · al levantar un pedido primero se contesta sí o todavía no y solo se ven las formas de esa
   *  respuesta (antes salían las siete juntas). Son las mismas formas y guardan lo mismo; solo cambia el orden en que se ven. */
  preguntar?: boolean
}) {
  const hoy = hoyNegocio()
  // COBRO-ENTREGA (24 nov 2026) · en un pedido con chofer o para recoger, «Efectivo» de «Ya pagó» se confundía con «paga en
  // efectivo al recibir» y el pedido quedaba pagado sin que el chofer supiera que debía cobrar: se pregunta antes.
  const [preguntaEfectivo, setPreguntaEfectivo] = React.useState(false)
  const cobraAlRecibir = modo === 'pedido' && (tipoEntrega === 'local' || tipoEntrega === 'recoge')
  const grupoDe = (f: FormaPago) => FORMAS.find((x) => x.id === f)?.grupo ?? 'ya'
  const [respuesta, setRespuesta] = React.useState<'ya' | 'despues' | null>(null)
  // Si ya hay una forma elegida, manda ella (p. ej. «No, lo cobra el chofer» pasa de «ya pagó» a «todavía no»).
  const grupoVisible = !preguntar ? null : value ? grupoDe(value.forma) : respuesta
  const responder = (g: 'ya' | 'despues') => {
    setRespuesta(g); setPreguntaEfectivo(false)
    if (value && grupoDe(value.forma) !== g) onChange(null)   // cambió de respuesta: la forma elegida ya no aplica
  }
  const elegir = (forma: FormaPago) => {
    if (formaNoDisponible(forma, modo, tipoEntrega)) return
    if (value?.forma === forma) return
    if (forma === 'efectivo' && cobraAlRecibir) { setPreguntaEfectivo(true); return }
    setPreguntaEfectivo(false)
    onChange(forma === 'credito' ? { forma, vence: sumarDiasISO(hoy, 15) } : { forma })
  }
  const cambio = value?.forma === 'efectivo' && value.recibido != null ? value.recibido - total : null
  const falta = value ? faltaEnCobro(value, total, modo, tipoEntrega, hoy) : null

  return (
    <div data-testid={testId}>
      {preguntar && (
        <div role="group" aria-label="¿Ya pagó?" data-testid={`${testId}-ya-pago`}>
          <div className="fp-pregunta">¿Ya pagó?</div>
          <div className="fp-resp">
            <button type="button" className={grupoVisible === 'ya' ? 'on' : undefined} aria-pressed={grupoVisible === 'ya'} onClick={() => responder('ya')} data-testid={`${testId}-ya-pago-si`}>Sí, ya pagó</button>
            <button type="button" className={grupoVisible === 'despues' ? 'on' : undefined} aria-pressed={grupoVisible === 'despues'} onClick={() => responder('despues')} data-testid={`${testId}-ya-pago-no`}>Todavía no</button>
          </div>
          {!grupoVisible && <div className="fp-pista" data-testid={`${testId}-ya-pago-pista`}>Con «Todavía no» eliges: más tarde, al recibir, link de pago o crédito.</div>}
        </div>
      )}
      {(['ya', 'despues'] as const).filter((g) => !preguntar || g === grupoVisible).map((g) => (
        <div key={g} style={{ marginTop: preguntar || g === 'despues' ? 12 : 0 }} data-testid={`${testId}-grupo-${g}`}>
          <div style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 700, margin: '0 0 6px' }}>
            {preguntar ? (g === 'ya' ? '¿Cómo pagó?' : '¿Cómo va a pagar?') : g === 'ya' ? (modo === 'mostrador' ? 'Cobra ahora' : 'Ya pagó') : 'Paga después'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
        {FORMAS.filter((f) => f.grupo === g).map((f) => {
          const no = formaNoDisponible(f.id, modo, tipoEntrega)
          const on = value?.forma === f.id
          return (
            <button key={f.id} type="button" onClick={() => elegir(f.id)} aria-pressed={on} aria-disabled={!!no} title={no ?? undefined}
              data-testid={`${testId}-${f.id}`}
              style={{ textAlign: 'left', padding: '9px 11px', borderRadius: 11, border: '1px solid ' + (on ? 'var(--green-deep)' : 'var(--line)'), background: on ? 'var(--ok-bg, #EAF4EC)' : 'var(--cp-surface, #fff)', cursor: no ? 'not-allowed' : 'pointer', opacity: no ? 0.5 : 1, fontFamily: 'inherit' }}>
              <b style={{ display: 'block', fontSize: 13 }}>{f.texto}</b>
              <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{no ? 'Solo en pedidos para enviar o recoger' : f.ayuda}</span>
            </button>
          )
        })}
          </div>
        </div>
      ))}

      {preguntaEfectivo && (
        <div role="group" aria-label="¿Ya pagó en efectivo?" data-testid={`${testId}-pregunta-efectivo`} style={{ marginTop: 10, padding: '10px 12px', border: '1px solid var(--warn, #b45309)', borderRadius: 12, background: 'var(--warn-bg, #fff7ed)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>¿Ya tienes el efectivo en la mano?</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn sm" data-testid={`${testId}-efectivo-al-recibir`} onClick={() => { setPreguntaEfectivo(false); onChange({ forma: 'al_recibir', con: 'efectivo' }) }}>No, {tipoEntrega === 'recoge' ? 'paga al recoger' : 'lo cobra el chofer'}</button>
            <button type="button" className="btn ghost sm" data-testid={`${testId}-efectivo-ya`} onClick={() => { setPreguntaEfectivo(false); onChange({ forma: 'efectivo' }) }}>Sí, ya me lo dio</button>
          </div>
        </div>
      )}
      {value?.forma === 'efectivo' && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12.5, color: 'var(--ink-3)', minWidth: 56 }}>Recibí</span>
            <input type="number" min={0} inputMode="decimal" value={value.recibido ?? ''} placeholder="¿con cuánto paga? (opcional)" style={input} data-testid={`${testId}-recibido`}
              onChange={(e) => onChange({ ...value, recibido: e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0) })} />
          </div>
          {cambio != null && (
            <div className="tket-total" style={{ marginTop: 8, color: cambio < 0 ? 'var(--danger)' : 'var(--green-deep)' }}>
              <span>{cambio < 0 ? 'Falta' : 'Cambio'}</span><b>{money(Math.abs(cambio))}</b>
            </div>
          )}
        </div>
      )}
      {(value?.forma === 'transferencia' || value?.forma === 'tarjeta') && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12.5, color: 'var(--ink-3)', minWidth: 72 }}>{value.forma === 'transferencia' ? 'Referencia' : 'Voucher'}</span>
          <input type="text" maxLength={200} value={value.referencia ?? ''} style={input} data-testid={`${testId}-referencia`}
            placeholder={value.forma === 'transferencia' ? 'clave de rastreo (opcional)' : 'número de autorización (opcional)'}
            onChange={(e) => onChange({ ...value, referencia: e.target.value })} />
        </div>
      )}
      {value?.forma === 'transferencia' && (
        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-3)' }} data-testid={`${testId}-referencia-ayuda`}>
          Opcional. Si la pones, que sea la del comprobante; si se repite en otra venta, Dirección lo verá para revisarlo.
        </div>
      )}
      {value?.forma === 'credito' && (
        <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
            <span style={{ color: 'var(--ink-3)', minWidth: 72 }}>Paga antes del</span>
            <input type="date" value={value.vence ?? ''} min={hoy} max={sumarDiasISO(hoy, MAX_DIAS_CREDITO)} style={input} data-testid={`${testId}-vence`}
              onChange={(e) => onChange({ ...value, vence: e.target.value || null })} />
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
            <span style={{ color: 'var(--ink-3)', minWidth: 72 }}>Motivo</span>
            <input type="text" maxLength={300} value={value.motivo ?? ''} placeholder="p. ej. cliente frecuente (opcional)" style={input} data-testid={`${testId}-motivo`}
              onChange={(e) => onChange({ ...value, motivo: e.target.value })} />
          </label>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>El crédito queda a tu nombre y Dirección recibe el aviso.</div>
        </div>
      )}
      {value?.forma === 'link' && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-3)' }}>Después de crear el pedido, saca el link en la app de BanBajío por {money(total)} y pégalo en «Cobrar pedidos»: el sistema se lo manda al cliente.</div>
      )}
      {value?.forma === 'al_recibir' && (
        <div style={{ marginTop: 10 }} data-testid={`${testId}-con`}>
          <div style={{ fontSize: 12.5, marginBottom: 6 }}>¿Cómo va a pagar al recibir?</div>
          <div className="seg">
            {CON_AL_RECIBIR.map((x) => (
              <button key={x.id} type="button" className={value.con === x.id ? 'active' : undefined} aria-pressed={value.con === x.id} onClick={() => onChange({ ...value, con: x.id })} data-testid={`${testId}-con-${x.id}`}>{x.texto}</button>
            ))}
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-3)' }} data-testid={`${testId}-al-recibir-monto`}>El pedido queda <b>por cobrar</b>: {tipoEntrega === 'recoge' ? 'se cobran' : 'el chofer cobra'} <b>{money(total)}</b> al {tipoEntrega === 'recoge' ? 'recogerlo en sucursal' : 'entregarlo'}.</div>
        </div>
      )}
      {value && falta && <div role="alert" style={{ marginTop: 8, fontSize: 12, color: 'var(--warn)' }} data-testid={`${testId}-falta`}>{falta}</div>}
    </div>
  )
}
