// AUTOFACTURA · Página pública /factura#<pedido>.<llave>: el cliente escanea el QR de su recibo, ve su compra y pide su
// factura con sus datos fiscales. No pide sesión: la llave del recibo es la prueba de que tiene esa compra.
// La regla (pedirla dentro del mes de la venta; después va en la global a público en general) la impone el servidor;
// aquí se explica con la fecha exacta. Esta página no timbra: deja la factura pedida para Renovacell.
import React, { useEffect, useState } from 'react'
import { BrandLogo } from '../app/BrandLogo'
import { money } from '../lib/format'
import { REGIMENES_OPTIONS } from '../data/sat/regimenesFiscales'
import { USOS_CFDI_OPTIONS } from '../data/sat/usosCfdi'
import { descargarFactura as descargarPorDefecto, guardarArchivo, pedirFactura as pedirPorDefecto, verFactura as verPorDefecto, type VistaFactura } from '../data/ops/autofactura'
import { faltaEnReceptor, fechaLarga, leerEnlace, limpiarReceptor, type Receptor } from '../../../../supabase/functions/_shared/autofactura'

const fragmento = (): string => (typeof window !== 'undefined' ? window.location.hash : '')
const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
/** «27 nov 2026»: en el resumen de la compra, donde el espacio es poco. */
const fechaCorta = (dia: string): string => { const [a, m, d] = dia.split('-').map(Number); return `${d} ${MES_CORTO[m - 1]} ${a}` }
const VACIO: Receptor = { rfc: '', razon_social: '', regimen: '', cp: '', uso_cfdi: '', email_facturacion: '' }

type Estado = { fase: 'cargando' } | { fase: 'invalido'; mensaje: string } | { fase: 'vista'; v: VistaFactura }

export function FacturaCliente({ ver = verPorDefecto, pedir = pedirPorDefecto, descargar = descargarPorDefecto, guardar = guardarArchivo, enlace = fragmento() }: {
  ver?: typeof verPorDefecto; pedir?: typeof pedirPorDefecto; descargar?: typeof descargarPorDefecto; guardar?: typeof guardarArchivo; enlace?: string
}) {
  const datos = leerEnlace(enlace)
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' })
  const [f, setF] = useState<Receptor>(VACIO)
  const [corrigiendo, setCorrigiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [recien, setRecien] = useState(false)   // acaba de pedirla en esta visita
  // DESCARGA: la factura ya timbrada se baja aquí mismo (por si el correo no llegó). Pide el RFC con el que se facturó.
  const [rfcDescarga, setRfcDescarga] = useState('')
  const [bajando, setBajando] = useState<'pdf' | 'xml' | null>(null)
  const [errorDescarga, setErrorDescarga] = useState<string | null>(null)
  const bajar = async (formato: 'pdf' | 'xml') => {
    if (bajando || !datos) return
    if (rfcDescarga.trim().length < 12) { setErrorDescarga('Escribe el RFC con el que se hizo la factura.'); return }
    setBajando(formato); setErrorDescarga(null)
    const r = await descargar(datos.pedido, datos.llave, rfcDescarga.trim().toUpperCase(), formato)
    setBajando(null)
    if (!r.ok) { setErrorDescarga(r.mensaje); return }
    guardar(r.data)
  }

  useEffect(() => {
    let vivo = true
    void (async () => {
      if (!datos) { if (vivo) setEstado({ fase: 'invalido', mensaje: 'El enlace está incompleto. Vuelve a escanear el código de tu recibo.' }); return }
      const r = await ver(datos.pedido, datos.llave)
      if (!vivo) return
      if (!r.ok) { setEstado({ fase: 'invalido', mensaje: r.mensaje }); return }
      setEstado({ fase: 'vista', v: r.data })
      if (r.data.receptor) setF({ ...VACIO, rfc: r.data.receptor.rfc, razon_social: r.data.receptor.razon_social, regimen: r.data.receptor.regimen, cp: r.data.receptor.cp, uso_cfdi: r.data.receptor.uso_cfdi })
    })()
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enlace, ver])

  const set = (p: Partial<Receptor>) => { setF((x) => ({ ...x, ...p })); setError(null) }
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (enviando || !datos) return
    const limpio = limpiarReceptor(f)
    const falta = faltaEnReceptor(limpio)
    if (falta) { setError(falta); return }
    setEnviando(true); setError(null)
    const r = await pedir(datos.pedido, datos.llave, limpio)
    setEnviando(false)
    if (!r.ok) { setError(r.mensaje); return }
    setEstado({ fase: 'vista', v: r.data }); setCorrigiendo(false); setRecien(true)
  }

  const v = estado.fase === 'vista' ? estado.v : null
  const conFormulario = !!v && (v.estado === 'disponible' || (v.estado === 'solicitada' && corrigiendo))
  return (
    <div className="rc-contacto" data-testid="factura-cliente">
      <div className="rc-pre rc-chat--wa">
        <header className="rc-head">
          <div className="rc-mark" aria-hidden><BrandLogo alt="" className="rc-logo" /></div>
          <div className="rc-title"><div className="rc-name">Renovacell</div><div className="rc-state">Tecnologías Antiedad</div></div>
        </header>
        <div className="rc-pre-cuerpo">
          {estado.fase === 'cargando' && <div className="rc-sys" role="status">Cargando tu compra…</div>}
          {estado.fase === 'invalido' && (
            <div className="rc-pre-tarjeta" data-testid="factura-invalida"><h1>No pudimos abrir tu compra</h1><p>{estado.mensaje}</p>
              <p className="rc-pre-nota">Si el problema sigue, pide tu factura a tu asesor de Renovacell.</p></div>
          )}
          {v && (
            <div className="rc-pre-tarjeta" data-testid="factura-tarjeta">
              <h1>Factura de tu compra</h1>
              <dl className="fc-compra" data-testid="factura-compra">
                <div><dt>Folio</dt><dd>{v.folio ?? '—'}</dd></div>
                <div><dt>Fecha</dt><dd>{fechaCorta(v.fecha)}</dd></div>
                <div><dt>Total</dt><dd>{money(v.total)}</dd></div>
              </dl>

              {v.estado === 'disponible' && <p className="fc-plazo" data-testid="factura-plazo">Puedes pedirla hasta el <b>{fechaLarga(v.limite)}</b>. Después, tu compra entra en la factura global del mes y ya no puede facturarse a tu nombre.</p>}

              {v.estado === 'solicitada' && !corrigiendo && (
                <div className="fc-aviso fc-aviso--ok" role="status" data-testid="factura-solicitada">
                  <b>{recien ? '¡Listo! Recibimos tus datos.' : 'Ya recibimos tus datos.'}</b>
                  <span>Te enviaremos tu factura{v.receptor?.correo ? <> al correo <b>{v.receptor.correo}</b></> : ' a tu correo'}.{!v.pagado ? ' Se emite cuando se registre el pago de tu compra.' : ''}</span>
                  {v.receptor && <span className="fc-dato">RFC {v.receptor.rfc} · {v.receptor.razon_social}</span>}
                  <button type="button" className="fc-enlace" onClick={() => setCorrigiendo(true)} data-testid="factura-corregir">Corregir mis datos</button>
                </div>
              )}

              {v.estado !== 'disponible' && v.estado !== 'solicitada' && (
                <div className={'fc-aviso' + (v.estado === 'facturada' || v.estado === 'en_proceso' ? ' fc-aviso--ok' : '')} role="status" data-testid={`factura-${v.estado}`}>
                  <span>{v.mensaje}</span>
                  {(v.estado === 'fuera_de_mes' || v.estado === 'en_global') && <span className="fc-dato">El plazo era hasta el {fechaLarga(v.limite)}.</span>}
                </div>
              )}

              {v.estado === 'facturada' && (
                <div className="fc-descarga" data-testid="factura-descarga">
                  <div className="rc-campo"><label htmlFor="fc-rfc-descarga">Para descargarla, escribe el RFC con el que se facturó</label>
                    <input id="fc-rfc-descarga" value={rfcDescarga} maxLength={13} autoCapitalize="characters" autoComplete="off" placeholder="12 o 13 letras y números" onChange={(e) => { setRfcDescarga(e.target.value.toUpperCase().replace(/\s/g, '')); setErrorDescarga(null) }} /></div>
                  {errorDescarga && <div role="alert" className="rc-error rc-error--inline" data-testid="factura-descarga-error">{errorDescarga}</div>}
                  <div className="fc-botones">
                    <button type="button" className="rc-pre-enviar" disabled={bajando !== null} onClick={() => void bajar('pdf')} data-testid="factura-pdf">{bajando === 'pdf' ? 'Descargando…' : 'Descargar PDF'}</button>
                    <button type="button" className="rc-pre-enviar fc-secundario" disabled={bajando !== null} onClick={() => void bajar('xml')} data-testid="factura-xml">{bajando === 'xml' ? 'Descargando…' : 'Descargar XML'}</button>
                  </div>
                </div>
              )}

              {conFormulario && (
                <form onSubmit={enviar} noValidate data-testid="factura-form">
                  {v.estado === 'solicitada' && <p className="fc-plazo">Corrige lo que haga falta y vuelve a enviar. Escribe de nuevo tu correo.</p>}
                  <div className="rc-campo"><label htmlFor="fc-rfc">RFC</label>
                    <input id="fc-rfc" value={f.rfc} maxLength={13} autoCapitalize="characters" autoComplete="off" placeholder="12 o 13 letras y números" onChange={(e) => set({ rfc: e.target.value.toUpperCase().replace(/\s/g, '') })} /></div>
                  <div className="rc-campo"><label htmlFor="fc-razon">Nombre o razón social</label>
                    <input id="fc-razon" value={f.razon_social} maxLength={300} placeholder="Como aparece en tu constancia fiscal" onChange={(e) => set({ razon_social: e.target.value })} /></div>
                  <div className="rc-campo"><label htmlFor="fc-regimen">Régimen fiscal</label>
                    <select id="fc-regimen" value={f.regimen} onChange={(e) => set({ regimen: e.target.value })}>
                      <option value="">Elige…</option>
                      {REGIMENES_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select></div>
                  <div className="rc-campo"><label htmlFor="fc-cp">Código postal fiscal</label>
                    <input id="fc-cp" value={f.cp} inputMode="numeric" maxLength={5} placeholder="5 números" onChange={(e) => set({ cp: e.target.value.replace(/\D/g, '').slice(0, 5) })} /></div>
                  <div className="rc-campo"><label htmlFor="fc-uso">Uso de la factura</label>
                    <select id="fc-uso" value={f.uso_cfdi} onChange={(e) => set({ uso_cfdi: e.target.value })}>
                      <option value="">Elige…</option>
                      {USOS_CFDI_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select></div>
                  <div className="rc-campo"><label htmlFor="fc-correo">Correo donde quieres recibirla</label>
                    <input id="fc-correo" type="email" autoComplete="email" value={f.email_facturacion} maxLength={200} placeholder="tu@correo.mx" onChange={(e) => set({ email_facturacion: e.target.value.trim() })} /></div>
                  {error && <div role="alert" className="rc-error rc-error--inline" data-testid="factura-error">{error}</div>}
                  <button type="submit" className="rc-pre-enviar" disabled={enviando} data-testid="factura-pedir">{enviando ? 'Enviando…' : v.estado === 'solicitada' ? 'Guardar mis datos' : 'Pedir mi factura'}</button>
                  <p className="rc-pre-nota">Tus datos se usan solo para emitir esta factura.</p>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
