// @vitest-environment jsdom
// R4-B2-4 · panel operativo mínimo de WhatsApp (Dirección): estado y controles con compuerta cerrada, confirmación y
// motivo, pausa/reanudación/espejo, revisión de salidas (retenidos, inciertos sin reenvío, descartados) con resultado por
// mensaje, toma de conversación (correcta, concurrente rechazada, escribir sin tomar bloqueado) y errores del servidor.
// Servidor FALSO en memoria que aplica las mismas reglas que la base (B2-1/B2-2/B2-3b/B2-4); sin red ni mensajes reales.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { BarraTomaCanal, PanelOperativoCanal } from './CanalOperacion'
import { AtencionComercial } from './AtencionComercial'
import { ClienteCanalOperacion, accionesCanal, mensajeErrorCanal, resumenOperativo, type ControlCanal } from '../../data/ops/canalOperacion'
import { ClienteAtencion } from '../../data/ops/atencion'
import { ClienteChat, type Conversacion } from '../../data/ops/chat'
import mig from '../../../../../supabase/migrations/20270122120000_panel_canal.sql?raw'
import migToma from '../../../../../supabase/migrations/20270121120000_exclusividad_toma.sql?raw'

afterEach(cleanup)

type Salida = { id: string; estado: string; texto: string; ventana: boolean }
type Estado = {
  gate: boolean; wa: { modo: 'espejo' | 'activo'; ia_habilitada: boolean; envio_pausado: boolean }; hist: Array<Record<string, unknown>>
  salidas: Salida[]; conv: { modo: string; tomada_por: string | null; seller: string | null }; yo: string; error?: string
}
const nuevo = (o: Partial<Estado> = {}): Estado => ({
  gate: false, wa: { modo: 'espejo', ia_habilitada: false, envio_pausado: false }, hist: [],
  salidas: [{ id: 'S1', estado: 'retenido', texto: 'Hola, te comparto el catálogo', ventana: true }, { id: 'S2', estado: 'retenido', texto: 'Aviso viejo', ventana: false }, { id: 'S3', estado: 'incierto', texto: 'Tu pedido va en camino', ventana: true }],
  conv: { modo: 'ai_active', tomada_por: null, seller: null }, yo: 'A1', ...o,
})
const err = (message: string) => ({ data: null, error: { message } })
/** Servidor falso: mismas reglas que cc_canal_cambiar / cc_salida_decidir / cc_tomar_conversacion / cc_canal_conversacion_control. */
function servidor(e: Estado) {
  const llamadas: Array<{ fn: string; args?: Record<string, unknown> }> = []
  const rpc = async (fn: string, args?: Record<string, unknown>) => {
    llamadas.push({ fn, args })
    if (e.error) return err(e.error)
    const habil = e.wa.modo === 'activo' && !e.wa.envio_pausado
    switch (fn) {
      case 'cc_canal_estado': return { data: { activacion_disponible: e.gate, canales: [{ canal: 'whatsapp', ...e.wa, updated_at: '2026-10-26T18:00:00Z' }, { canal: 'instagram', modo: 'espejo', ia_habilitada: false, envio_pausado: false, updated_at: null }, { canal: 'messenger', modo: 'espejo', ia_habilitada: false, envio_pausado: false, updated_at: null }], historial: e.hist }, error: null }
      case 'cc_canal_cambiar': {
        const c = args!.p_cambios as Record<string, unknown>; const m = String(args!.p_motivo ?? '').trim()
        const n = { modo: (c.modo as 'espejo' | 'activo') ?? e.wa.modo, ia_habilitada: (c.ia_habilitada as boolean) ?? e.wa.ia_habilitada, envio_pausado: (c.envio_pausado as boolean) ?? e.wa.envio_pausado }
        if (n.modo === 'espejo') n.ia_habilitada = false
        if (m.length < 5) return err('MOTIVO_REQUERIDO: explica el cambio')
        if (((n.modo === 'activo' && e.wa.modo !== 'activo') || (n.ia_habilitada && !e.wa.ia_habilitada)) && !e.gate) return err('ACTIVACION_BLOQUEADA: activar el canal o encender la IA requiere completar R4-B2')
        e.hist.unshift({ canal: 'whatsapp', antes: { ...e.wa }, despues: { ...n }, origen: 'rpc', actor: 'Dirección Uno', motivo: m, at: '2026-10-26T18:05:00Z' })
        if (n.envio_pausado || n.modo === 'espejo') e.salidas.forEach((s) => { if (s.estado === 'pendiente') s.estado = 'retenido' })
        e.wa = n; return { data: { cambiado: true }, error: null }
      }
      case 'cc_salida_revision': {
        const conteos: Record<string, number> = {}; e.salidas.forEach((s) => { conteos[s.estado] = (conteos[s.estado] ?? 0) + 1 })
        return { data: { canal: 'whatsapp', envio_habilitado: habil, conteos, por_decidir: e.salidas.filter((s) => s.estado === 'retenido' || s.estado === 'incierto').map((s) => ({ id: s.id, estado: s.estado, conversation_id: 'C1', creado: '2026-10-26T17:00:00Z', texto: s.texto, error: null, resultado: null, contacto: '…3464', ventana_abierta: s.ventana })) }, error: null }
      }
      case 'cc_salida_decidir': {
        const ids = args!.p_ids as string[]; const acc = args!.p_accion as string
        if (String(args!.p_motivo ?? '').trim().length < 5) return err('MOTIVO_REQUERIDO')
        if (ids.length < 1 || ids.length > 100) return err('SELECCION_INVALIDA')
        if (acc === 'liberar' && !habil) return err('CANAL_NO_HABILITADO: no se libera con el canal en espejo o en pausa')
        const resultados = ids.map((id) => {
          const s = e.salidas.find((x) => x.id === id)
          if (!s) return { id, resultado: 'no_encontrado' }
          if (acc === 'liberar' && s.estado !== 'retenido') return { id, resultado: 'estado_invalido' }
          if (acc === 'descartar' && !['retenido', 'incierto'].includes(s.estado)) return { id, resultado: 'estado_invalido' }
          if (acc === 'liberar' && !s.ventana) return { id, resultado: 'fuera_de_ventana' }
          s.estado = acc === 'liberar' ? 'pendiente' : 'descartado'; return { id, resultado: acc === 'liberar' ? 'liberado' : 'descartado' }
        })
        return { data: { lote: 'L1', canal: 'whatsapp', accion: acc, aplicados: resultados.filter((r) => r.resultado === 'liberado' || r.resultado === 'descartado').length, total: resultados.length, resultados }, error: null }
      }
      case 'cc_canal_panel': return { data: { canal: 'whatsapp', atencion_humana: e.conv.modo === 'human_active' ? [{ conversation_id: 'C1', modo: 'human_active', atiende: e.conv.tomada_por ? 'direccion' : 'vendedor', atiende_nombre: e.conv.tomada_por === e.yo ? 'Dirección Uno' : 'Otra Dirección', soy_yo: e.conv.tomada_por === e.yo, desde: '2026-10-26T18:00:00Z' }] : [],
        descartados: e.salidas.filter((s) => s.estado === 'descartado').map((s) => ({ id: s.id, conversation_id: 'C1', texto: s.texto, decidido_at: '2026-10-26T18:10:00Z', decidido_por: 'Dirección Uno', motivo: 'Revisado en el teléfono' })) }, error: null }
      case 'cc_canal_conversacion_control': {
        const c = e.conv; const activo = e.wa.modo === 'activo'
        const atiende = c.modo === 'human_active' ? (c.tomada_por ? 'direccion' : 'vendedor') : activo && e.wa.ia_habilitada ? 'ia' : 'nadie'
        const noTomar = !activo ? 'canal_en_espejo' : c.modo === 'human_active' ? (c.tomada_por === e.yo ? 'ya_es_tuya' : 'atendida_por_otro') : null
        const noEscribir = !activo ? 'canal_en_espejo' : c.modo !== 'human_active' ? 'toma_requerida' : c.tomada_por !== e.yo ? 'atendida_por_otro' : null
        return { data: { canal: 'whatsapp', canal_modo: e.wa.modo, ia_habilitada: e.wa.ia_habilitada, envio_pausado: e.wa.envio_pausado, modo: c.modo, estado: 'abierta', atiende, atiende_nombre: c.tomada_por === e.yo ? 'Dirección Uno' : c.tomada_por ? 'Otra Dirección' : c.seller, soy_yo: c.tomada_por === e.yo, tomada_at: null, puede_tomar: !noTomar, motivo_no_tomar: noTomar, puede_escribir: !noEscribir, motivo_no_escribir: noEscribir }, error: null }
      }
      case 'cc_tomar_conversacion': {
        if (e.wa.modo !== 'activo') return err('CANAL_EN_ESPEJO')
        if (e.conv.modo === 'human_active') return e.conv.tomada_por === e.yo ? { data: { modo: 'human_active', tomada_por: e.yo, idempotente: true }, error: null } : err('ATENDIDA_POR_OTRO: otra persona atiende esta conversación')
        e.conv = { modo: 'human_active', tomada_por: e.yo, seller: null }; return { data: { modo: 'human_active', tomada_por: e.yo, idempotente: false }, error: null }
      }
      // ClienteAtencion (pestaña Canales dentro de la Bandeja)
      case 'cc_ruteo_pendientes': return { data: { resumen: { horario: { configurado: true, abierto: true, zona: 'America/Mazatlan', motivo: '' }, sin_vendedor: 0, reasignacion: 0, handoffs_sin_asignar: 0, handoffs_pendientes: 0, vendedores_elegibles: 1 }, conversaciones: [], carritos_pendientes: [] }, error: null }
      case 'cc_vendedores': return { data: [], error: null }
      case 'cc_canales_bandeja': return { data: { modos: { whatsapp: e.wa.modo, instagram: 'espejo', messenger: 'espejo' }, chats: [{ canal: 'whatsapp', id: '5216671113464', nombre: 'Dra. Prueba', ultimo_entrante_at: null, ventana_abierta: true, cliente: false, cliente_nombre: null, conversation_id: 'C1', modo: e.conv.modo, estado: 'abierta', vendedor: null, n_mensajes: 2, ultimo_texto: 'Hola', ultimo_actor: 'visitor', ultimo_at: null, hace_min: 3, sin_responder: true }] }, error: null }
    }
    return err('FUNCION_DESCONOCIDA ' + fn)
  }
  return { rpc, llamadas }
}
const clienteDe = (e: Estado, reportar = vi.fn()) => { const s = servidor(e); return { cli: new ClienteCanalOperacion(s.rpc, reportar), ...s, reportar } }
const abrirControles = async () => { fireEvent.click(await screen.findByTestId('panel-canal-detalle')) }
const confirmarCon = async (testid: string, motivo: string) => {
  const m = await screen.findByTestId(testid)
  fireEvent.change(within(m).getByTestId(`${testid}-motivo`), { target: { value: motivo } })
  fireEvent.click(within(m).getByTestId(`${testid}-confirmar`))
}

describe('lógica pura: compuerta, acciones y errores', () => {
  const base: ControlCanal = { canal: 'whatsapp', modo: 'espejo', ia_habilitada: false, envio_pausado: false, updated_at: null }
  it('compuerta cerrada: activar y encender IA deshabilitados con explicación; pausar sigue disponible', () => {
    const a = accionesCanal(base, false)
    expect(a.activar).toMatchObject({ visible: true, habilitada: false }); expect(a.activar.porque).toMatch(/bloqueada en el servidor/)
    expect(a.encenderIA.habilitada).toBe(false); expect(a.pausar).toMatchObject({ visible: true, habilitada: true })
    const act = accionesCanal({ ...base, modo: 'activo', ia_habilitada: true, envio_pausado: true }, false)
    expect(act.espejo.habilitada && act.apagarIA.habilitada && act.reanudar.habilitada).toBe(true)
  })
  it('compuerta abierta: activar se ofrece; encender IA exige canal activo', () => {
    expect(accionesCanal(base, true).activar.habilitada).toBe(true)
    expect(accionesCanal(base, true).encenderIA).toMatchObject({ habilitada: false, porque: 'La IA solo se enciende con el canal activo.' })
    expect(accionesCanal({ ...base, modo: 'activo' }, true).encenderIA.habilitada).toBe(true)
  })
  it('resumen: IA atendiendo, envíos detenidos, por revisar y compuerta', () => {
    const r = resumenOperativo({ ...base, modo: 'activo', ia_habilitada: true, envio_pausado: true }, false, { canal: 'whatsapp', envio_habilitado: false, conteos: { retenido: 2, incierto: 1 }, por_decidir: [] }, { canal: 'whatsapp', atencion_humana: [{ conversation_id: 'x', modo: 'human_active', atiende: 'direccion', atiende_nombre: 'A', soy_yo: true, desde: null }, { conversation_id: 'y', modo: 'human_requested', atiende: null, atiende_nombre: null, soy_yo: false, desde: null }], descartados: [] })
    expect(r.map((l) => l.texto)).toEqual(['El asistente (IA) atiende primero', 'Envíos PAUSADOS: nada sale; lo nuevo queda retenido', '2 retenido(s) y 1 incierto(s) por revisar', '1 atendida(s) por personas · 1 esperando asesor', 'Compuerta de activación cerrada'])
  })
  it('errores del servidor → textos claros; suspendido y no autorizado', () => {
    expect(mensajeErrorCanal('ACTIVACION_BLOQUEADA: x')).toMatch(/bloqueada en el servidor/)
    expect(mensajeErrorCanal('CUENTA_SUSPENDIDA')).toMatch(/suspendido/)
    expect(mensajeErrorCanal('NO_AUTORIZADO: solo Dirección')).toBe('Solo Dirección opera los canales.')
    expect(mensajeErrorCanal('ATENDIDA_POR_OTRO')).toMatch(/Otra persona/)
    expect(mensajeErrorCanal('CANAL_NO_HABILITADO')).toMatch(/espejo o con los envíos pausados/)
  })
  it('error no reconocido: genérico con referencia, sin texto crudo; se reporta sanitizado', async () => {
    const e = nuevo({ error: 'relation "cc_wa_salida" secret detail 5216671113464' }); const { cli, reportar } = clienteDe(e)
    const r = await cli.estado()
    expect(r.ok).toBe(false); if (!r.ok) { expect(r.error).toMatch(/referencia ATN-/); expect(r.error).not.toMatch(/cc_wa_salida|5216671113464/) }
    expect(reportar).toHaveBeenCalledTimes(1)
  })
  it('el cliente llama exactamente a las RPC del servidor (sin escribir tablas)', async () => {
    const { cli, llamadas } = clienteDe(nuevo())
    await cli.estado(); await cli.revision('whatsapp'); await cli.panel('whatsapp'); await cli.control('C1'); await cli.cambiar('whatsapp', { envio_pausado: true }, 'Pausa de prueba'); await cli.decidir('whatsapp', ['S1'], 'descartar', 'Motivo válido'); await cli.tomar('C1', '  ')
    expect(llamadas.map((l) => l.fn)).toEqual(['cc_canal_estado', 'cc_salida_revision', 'cc_canal_panel', 'cc_canal_conversacion_control', 'cc_canal_cambiar', 'cc_salida_decidir', 'cc_tomar_conversacion'])
    expect(llamadas[4].args).toEqual({ p_canal: 'whatsapp', p_cambios: { envio_pausado: true }, p_motivo: 'Pausa de prueba' })
    expect(llamadas[6].args).toEqual({ p_conv: 'C1', p_motivo: null })
  })
})

describe('<PanelOperativoCanal> · estado y controles', () => {
  it('lectura de estado: espejo, compuerta cerrada, última modificación, otros canales solo estado', async () => {
    const { cli } = clienteDe(nuevo())
    render(<PanelOperativoCanal cliente={cli} />)
    expect((await screen.findByTestId('res-compuerta')).textContent).toMatch(/cerrada/)
    await abrirControles()
    expect(screen.getByTestId('dato-modo').textContent).toBe('Espejo'); expect(screen.getByTestId('dato-compuerta').textContent).toBe('Cerrada')
    expect(screen.getByTestId('dato-modificado').textContent).not.toBe('—')
    expect(screen.getByTestId('explica-compuerta').textContent).toMatch(/Pausar, apagar la IA y volver a espejo siguen disponibles/)
    expect((screen.getByTestId('ctl-activar') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('ctl-activar-porque').textContent).toMatch(/bloqueada/)
    expect(screen.getByTestId('otro-instagram').textContent).toMatch(/Instagram: espejo/)
    expect(screen.getByTestId('otros-canales').querySelectorAll('button').length).toBe(0)   // sin controles de Instagram/Facebook
  })
  it('activación rechazada por el servidor aunque el botón se habilite (compuerta "abierta" en la pantalla, cerrada en la base)', async () => {
    const e = nuevo({ gate: true }); const { cli } = clienteDe(e)
    render(<PanelOperativoCanal cliente={cli} />); await abrirControles()
    e.gate = false   // la base manda: se cerró entre la lectura y la acción
    fireEvent.click(screen.getByTestId('ctl-activar'))
    await confirmarCon('confirmar-activar', 'Primera prueba supervisada')
    expect((await screen.findByTestId('confirmar-activar-error')).textContent).toMatch(/bloqueada en el servidor/)
    expect(e.wa.modo).toBe('espejo')
  })
  it('pausa y reanudación con confirmación y motivo; reanudar NO libera lo retenido', async () => {
    const e = nuevo({ wa: { modo: 'activo', ia_habilitada: true, envio_pausado: false } }); const { cli, llamadas } = clienteDe(e)
    render(<PanelOperativoCanal cliente={cli} />); await abrirControles()
    fireEvent.click(screen.getByTestId('ctl-pausar'))
    const m = await screen.findByTestId('confirmar-pausar')
    fireEvent.change(within(m).getByTestId('confirmar-pausar-motivo'), { target: { value: 'no' } })
    expect((within(m).getByTestId('confirmar-pausar-confirmar') as HTMLButtonElement).disabled).toBe(true)   // motivo corto
    await confirmarCon('confirmar-pausar', 'Revisión de cola')
    await waitFor(() => expect(screen.getByTestId('res-envio').textContent).toMatch(/PAUSADOS/))
    fireEvent.click(screen.getByTestId('ctl-reanudar'))
    expect((await screen.findByTestId('confirmar-reanudar')).textContent).toMatch(/Lo retenido NO sale solo/)
    await confirmarCon('confirmar-reanudar', 'Revisión terminada')
    await waitFor(() => expect(screen.getByTestId('res-envio').textContent).toBe('Envíos habilitados'))
    expect(e.salidas.filter((s) => s.estado === 'retenido').length).toBe(2)   // siguen retenidos
    expect(llamadas.filter((l) => l.fn === 'cc_salida_decidir').length).toBe(0)
    expect(screen.getAllByTestId('historial-fila').length).toBe(2)
  })
  it('cambio a espejo: apaga la IA en el mismo cambio', async () => {
    const e = nuevo({ wa: { modo: 'activo', ia_habilitada: true, envio_pausado: false } }); const { cli } = clienteDe(e)
    render(<PanelOperativoCanal cliente={cli} />); await abrirControles()
    fireEvent.click(screen.getByTestId('ctl-espejo'))
    await confirmarCon('confirmar-espejo', 'Volvemos a Leadsales')
    await waitFor(() => expect(screen.getByTestId('dato-modo').textContent).toBe('Espejo'))
    expect(e.wa).toEqual({ modo: 'espejo', ia_habilitada: false, envio_pausado: false })
  })
  it('usuario no autorizado / admin suspendido: no ve controles, solo el error del servidor', async () => {
    for (const [msg, txt] of [['NO_AUTORIZADO: solo Dirección', 'Solo Dirección opera los canales.'], ['CUENTA_SUSPENDIDA', 'Tu acceso fue suspendido por Dirección.']]) {
      const { cli } = clienteDe(nuevo({ error: msg }))
      render(<PanelOperativoCanal cliente={cli} />)
      expect((await screen.findByTestId('panel-canal-error')).textContent).toBe(txt)
      expect(screen.queryByTestId('ctl-pausar')).toBeNull(); cleanup()
    }
  })
})

describe('<RevisionDeSalidas> · retenidos, inciertos y descartados', () => {
  it('incierto: nunca se libera ni se reenvía; nunca se muestra como enviado', async () => {
    const e = nuevo({ wa: { modo: 'activo', ia_habilitada: true, envio_pausado: false } }); const { cli } = clienteDe(e)
    render(<PanelOperativoCanal cliente={cli} />); await abrirControles()
    const filas = await screen.findAllByTestId('salida-fila')
    const inc = filas.find((f) => /camino/.test(f.textContent ?? ''))!
    expect(within(inc).getByTestId('salida-estado').textContent).toBe('Incierto · no confirmado')
    fireEvent.click(within(inc).getByTestId('salida-check'))
    expect((screen.getByTestId('btn-liberar') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('porque-no-liberar').textContent).toMatch(/pudo haber llegado/)
    expect(screen.queryByText(/Reenviar/i)).toBeNull()
    expect(screen.getByTestId('revision-salidas').textContent).not.toMatch(/Enviado/)
    fireEvent.click(screen.getByTestId('btn-descartar'))
    await confirmarCon('confirmar-descartar', 'Verificado en el teléfono')
    expect((await screen.findByTestId('resultado-decision')).textContent).toMatch(/1 de 1.*descartado/s)
    expect(e.salidas.find((s) => s.id === 'S3')!.estado).toBe('descartado')
    expect(await screen.findByTestId('historial-descartados')).toBeTruthy()
  })
  it('liberar exige canal habilitado: en pausa el botón no procede', async () => {
    const { cli } = clienteDe(nuevo({ wa: { modo: 'activo', ia_habilitada: true, envio_pausado: true } }))
    render(<PanelOperativoCanal cliente={cli} />); await abrirControles()
    fireEvent.click((await screen.findAllByTestId('salida-check'))[0])
    expect((screen.getByTestId('btn-liberar') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('porque-no-liberar').textContent).toMatch(/activo y sin pausa/)
  })
  it('liberación autorizada en lote: resultado por mensaje (fuera de ventana se rechaza individualmente)', async () => {
    const e = nuevo({ wa: { modo: 'activo', ia_habilitada: true, envio_pausado: false } }); const { cli, llamadas } = clienteDe(e)
    render(<PanelOperativoCanal cliente={cli} />); await abrirControles()
    const filas = await screen.findAllByTestId('salida-fila')
    expect(within(filas[1]).getByTestId('salida-fuera-ventana')).toBeTruthy()
    fireEvent.click(within(filas[0]).getByTestId('salida-check')); fireEvent.click(within(filas[1]).getByTestId('salida-check'))
    expect(screen.getByTestId('n-seleccion').textContent).toMatch(/^2 seleccionado/)
    fireEvent.click(screen.getByTestId('btn-liberar'))
    await confirmarCon('confirmar-liberar', 'Avisos vigentes')
    const res = await screen.findByTestId('resultado-decision')
    expect(res.textContent).toMatch(/1 de 2/)
    const lineas = within(res).getAllByTestId('resultado-fila').map((x) => x.textContent)
    expect(lineas.some((t) => /catálogo.*Liberado/.test(t ?? ''))).toBe(true)
    expect(lineas.some((t) => /Aviso viejo.*fuera de la ventana de 24 h/.test(t ?? ''))).toBe(true)
    expect((llamadas.find((l) => l.fn === 'cc_salida_decidir')!.args!.p_ids as string[]).sort()).toEqual(['S1', 'S2'])
  })
})

describe('<BarraTomaCanal> · tomar conversación', () => {
  it('sin tomar: lee sin intervenir; toma correcta → la IA deja de responder y puede escribir', async () => {
    const e = nuevo({ wa: { modo: 'activo', ia_habilitada: true, envio_pausado: false } }); const { cli, llamadas } = clienteDe(e)
    const onControl = vi.fn()
    render(<BarraTomaCanal conversationId="C1" cliente={cli} onControl={onControl} intervaloMs={600_000} />)
    expect((await screen.findByTestId('toma-quien')).textContent).toBe('Atiende el asistente (IA)')
    expect(screen.getByTestId('toma-explica').textContent).toMatch(/Toma la conversación para responder/)
    fireEvent.click(screen.getByTestId('btn-tomar'))
    expect((await screen.findByTestId('confirmar-toma')).textContent).toMatch(/No se crea otra solicitud/)
    fireEvent.click(screen.getByTestId('confirmar-toma-confirmar'))   // motivo opcional
    expect((await screen.findByTestId('toma-aviso')).textContent).toMatch(/el asistente deja de responder/)
    await waitFor(() => expect(screen.getByTestId('toma-quien').textContent).toBe('La atiendes tú (Dirección)'))
    expect(onControl).toHaveBeenLastCalledWith(expect.objectContaining({ puede_escribir: true }))
    expect(llamadas.filter((l) => l.fn === 'cc_tomar_conversacion').length).toBe(1)
    expect(screen.queryByTestId('btn-tomar')).toBeNull()
  })
  it('toma concurrente: otra Dirección ganó → error claro y se muestra quién atiende', async () => {
    const e = nuevo({ wa: { modo: 'activo', ia_habilitada: true, envio_pausado: false } }); const { cli } = clienteDe(e)
    render(<BarraTomaCanal conversationId="C1" cliente={cli} intervaloMs={600_000} />)
    fireEvent.click(await screen.findByTestId('btn-tomar'))
    e.conv = { modo: 'human_active', tomada_por: 'A2', seller: null }   // la otra llegó primero
    fireEvent.click(await screen.findByTestId('confirmar-toma-confirmar'))
    expect((await screen.findByTestId('confirmar-toma-error')).textContent).toBe('Otra persona ya atiende esta conversación.')
    await waitFor(() => expect(screen.getByTestId('toma-quien').textContent).toBe('La atiende Otra Dirección (Dirección)'))
    expect(screen.queryByTestId('btn-tomar')).toBeNull()
  })
  it('canal en espejo: no se ofrece tomar', async () => {
    const { cli } = clienteDe(nuevo())
    render(<BarraTomaCanal conversationId="C1" cliente={cli} intervaloMs={600_000} />)
    expect((await screen.findByTestId('toma-no')).textContent).toMatch(/espejo/); expect(screen.queryByTestId('btn-tomar')).toBeNull()
  })
})

describe('integración: Conversaciones → Bandeja → Canales', () => {
  const conv = (): Conversacion => ({ conversation_id: 'C1', estado: 'abierta', modo: 'ai_active', rol: 'supervisor', ultimo_seq: 1, mensajes: [], whatsapp: { wa_id: '5216671113464', modo: 'activo', ventana_abierta: true, ventana_hasta: null, fallidos: 0 } })
  it('respuesta sin toma bloqueada en el redactor; tras tomar se habilita (el servidor vuelve a validar)', async () => {
    const e = nuevo({ wa: { modo: 'activo', ia_habilitada: true, envio_pausado: false } }); const s = servidor(e)
    const canalOp = new ClienteCanalOperacion(s.rpc, vi.fn()); const atencion = new ClienteAtencion(s.rpc, vi.fn())
    const chat = new ClienteChat(async (_f, { body }) => ({ data: body.action === 'leer' ? conv() : { ok: true }, error: null }), () => null)
    render(<AtencionComercial pestanas={['whatsapp']} cliente={atencion} chat={chat} canalOp={canalOp} />)
    expect(await screen.findByTestId('panel-canal')).toBeTruthy()
    fireEvent.click(await screen.findByTestId('wa-abrir'))
    await screen.findByTestId('barra-toma')
    const area = () => document.querySelector('.rc-composer textarea') as HTMLTextAreaElement
    await waitFor(() => expect(area().disabled).toBe(true))
    expect(area().placeholder).toMatch(/Toma la conversación para responder/)
    fireEvent.click(screen.getByTestId('btn-tomar')); fireEvent.click(await screen.findByTestId('confirmar-toma-confirmar'))
    await waitFor(() => expect(area().disabled).toBe(false))
  })
})

describe('contratos de la base (B2-4 solo lectura; B2-3b sin cambios)', () => {
  it('las lecturas del panel exigen Dirección, son stable, no escriben y no exponen el teléfono', () => {
    expect(mig).toMatch(/create function public\.cc_canal_conversacion_control\(p_conv uuid\) returns jsonb\n  language plpgsql stable security definer/)
    expect(mig).toMatch(/create function public\.cc_canal_panel\(p_canal text\) returns jsonb\n  language plpgsql stable security definer/)
    expect((mig.match(/not public\._cc_es_admin\(\)/g) ?? []).length).toBe(2)
    expect(mig).not.toMatch(/\b(insert into|update public\.|delete from)\b/i)
    expect(mig).not.toMatch(/'wa_id'|'psid'|telefono/)
    expect(migToma).toMatch(/TOMA_REQUERIDA: toma la conversación antes de responder/)
  })
})
