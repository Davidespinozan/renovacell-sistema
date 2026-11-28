// COTIZACIONES EN INICIO (28 nov 2026, dueño: «quieren poder cotizar y dar seguimiento a la cotización … las ventas solo
// deben ser cuando ya son seguras; una cotización expira, y que le den seguimiento desde Inicio»).
// · «Cotizar»: elige al cliente y arma la cotización (mismos precios que un pedido). No es venta: no aparta inventario ni
//   pasa a Almacén, y vence a los 7 días.
// · «Cotizaciones por cerrar»: las que siguen abiertas, con lo que se hace con cada una: volverla pedido (con los mismos
//   productos), mandarla por WhatsApp, darle 7 días más o marcar que no se cerró.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useRole } from '../../auth/RoleContext'
import { Icon } from '../../app/icons'
import { toast } from '../../app/Toast'
import { confirmar } from '../../app/dialogos'
import { money } from '../../lib/format'
import { capitalizarNombre, primerNombre } from '../../lib/nombres'
import { whatsappCon } from '../../data/ops/busqueda'
import { cotizaciones as clientePorDefecto, carritoDeCotizacion, textoCotizacion, vigenciaCotizacion, type ClienteCotizaciones, type CotizacionAbierta } from '../../data/ops/cotizaciones'
import { BuscadorClientes } from '../../data/ops/buscarClientes'
import { SelectorClienteVentas } from '../pos/SelectorCliente'
import { NuevaCotizacion } from '../sales/NuevaCotizacion'
import { NuevoPedido } from '../sales/NuevoPedido'
import { Seccion } from './primitives'

// Una sola lista para todo Inicio: al crear una cotización, la sección se entera y recarga.
const oyentes = new Set<() => void>()
export const avisarCotizaciones = () => oyentes.forEach((f) => f())

export function useCotizacionesAbiertas(cliente: ClienteCotizaciones = clientePorDefecto) {
  const [lista, setLista] = useState<CotizacionAbierta[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cargar = useCallback(async () => {
    const r = await cliente.abiertas()
    if (r.ok) { setLista(r.data); setError(null) } else setError(r.mensaje)
  }, [cliente])
  useEffect(() => { void cargar(); oyentes.add(cargar); return () => { oyentes.delete(cargar) } }, [cargar])
  return { lista, error, recargar: cargar }
}

/** Botón «Cotizar» de Inicio: elige al cliente y abre la cotización. */
export function BotonCotizar({ cliente = clientePorDefecto }: { cliente?: ClienteCotizaciones }) {
  const buscador = useRef<BuscadorClientes | null>(null)
  const [eligiendo, setEligiendo] = useState(false)
  const [para, setPara] = useState<{ id: string; name: string } | null>(null)
  return (
    <>
      <button type="button" className="btn ghost rh-vender" onClick={() => { buscador.current ??= new BuscadorClientes(); setEligiendo(true) }} data-testid="inicio-cotizar">
        <Icon name="receipt" /> Cotizar
      </button>
      {eligiendo && buscador.current && (
        <SelectorClienteVentas paraPedido buscador={buscador.current} onClose={() => setEligiendo(false)} onPick={(c) => { setEligiendo(false); if (c) setPara({ id: c.id, name: c.name }) }} />
      )}
      {para && <NuevaCotizacion customer={{ id: para.id, name: para.name }} cliente={cliente} onClose={() => { setPara(null); avisarCotizaciones() }} onCreada={() => avisarCotizaciones()} />}
    </>
  )
}

/** Sección de Inicio. `equipo`: Dirección y el jefe de ventas ven de quién es cada una. */
export function CotizacionesPorCerrar({ equipo = false, cliente = clientePorDefecto }: { equipo?: boolean; cliente?: ClienteCotizaciones }) {
  const { user } = useRole()
  const { lista, error, recargar } = useCotizacionesAbiertas(cliente)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [pedidoDe, setPedidoDe] = useState<CotizacionAbierta | null>(null)
  if (!lista?.length) return error ? <div className="sysnote" role="alert" data-testid="cot-inicio-error">No se pudieron leer las cotizaciones. {error}</div> : null

  const accion = async (c: CotizacionAbierta, hacer: () => Promise<{ ok: boolean; mensaje?: string }>, hecho: string) => {
    setOcupado(c.id)
    const r = await hacer()
    setOcupado(null)
    if (!r.ok) { toast(r.mensaje ?? 'No se pudo.'); return }
    toast(hecho); void recargar()
  }
  const porWhatsApp = (c: CotizacionAbierta) => {
    const nombre = primerNombre(capitalizarNombre(c.cliente ?? '')) || undefined
    window.open(whatsappCon(c.telefono, textoCotizacion(c, nombre)), '_blank', 'noopener')
    void cliente.enviar(c.id, 'chat')   // queda registrado que se le mandó
  }
  const noSeCerro = async (c: CotizacionAbierta) => {
    if (!(await confirmar(`¿La cotización ${c.folio} de ${capitalizarNombre(c.cliente ?? '')} no se cerró? Sale de tu lista (no es una venta, no afecta nada más).`, { aceptar: 'Sí, no se cerró' }))) return
    await accion(c, () => cliente.cancelar(c.id), `${c.folio} marcada como no cerrada`)
  }
  const vivas = lista.filter((c) => !vigenciaCotizacion(c.vigente_hasta).vencida).length
  return (
    <Seccion titulo="Cotizaciones por cerrar" nivel="continuar" conteo={lista.length} id="cotizaciones">
      <div className="tasklist" data-testid="cot-inicio">
        {lista.slice(0, 8).map((c) => {
          const v = vigenciaCotizacion(c.vigente_hasta)
          const yaSeMando = !!(c.enviada_chat_at || c.enviada_correo_at)
          return (
            <div key={c.id} className="taskrow rh-decision" data-testid="cot-inicio-fila">
              <span className="taskrow-tx">
                <span className="taskrow-t">{capitalizarNombre(c.cliente ?? '') || 'Cliente'} · {money(c.total)}</span>
                <span className="taskrow-d">
                  <span className="mono">{c.folio}</span> · <span className={v.tono === 'dang' ? 'cifra-v--warn' : undefined} data-testid="cot-inicio-vence">{v.texto}</span>
                  {' · '}{c.lineas.length} producto{c.lineas.length === 1 ? '' : 's'}{yaSeMando ? '' : ' · aún no se le manda'}
                  {equipo && c.vendedor ? ` · ${capitalizarNombre(c.vendedor)}` : ''}
                </span>
              </span>
              <span className="rh-decision-btns">
                <button type="button" className="btn ghost sm" disabled={ocupado === c.id} onClick={() => void noSeCerro(c)} data-testid="cot-inicio-no">No se cerró</button>
                {v.vencida || v.tono !== 'ok'
                  ? <button type="button" className="btn ghost sm" disabled={ocupado === c.id} onClick={() => void accion(c, () => cliente.extender(c.id, 7), `${c.folio}: 7 días más`)} data-testid="cot-inicio-extender">+7 días</button>
                  : null}
                {!v.vencida && <button type="button" className="btn ghost sm" onClick={() => porWhatsApp(c)} data-testid="cot-inicio-wa">WhatsApp</button>}
                <button type="button" className="btn sm" disabled={ocupado === c.id || v.vencida} title={v.vencida ? 'Dale más días antes de volverla pedido' : undefined} onClick={() => setPedidoDe(c)} data-testid="cot-inicio-pedido">Hacer pedido</button>
              </span>
            </div>
          )
        })}
        {lista.length > 8 && <div className="taskrow rh-decision-mas">y {lista.length - 8} más · {vivas} vigentes</div>}
      </div>
      {pedidoDe && (
        <NuevoPedido customer={{ id: pedidoDe.customer_id, name: capitalizarNombre(pedidoDe.cliente ?? ''), phone: pedidoDe.telefono }} placedBy={`${user?.name ?? 'Ventas'} (Ventas)`}
          initialCart={carritoDeCotizacion(pedidoDe)} onClose={() => setPedidoDe(null)}
          onCreado={(p) => {
            const c = pedidoDe
            if (p?.id) void cliente.convertida(c.id, p.id).then(() => { toast(`${c.folio} ya es el pedido ${p.external_ref ?? ''}`); void recargar() })
          }} />
      )}
    </Seccion>
  )
}
