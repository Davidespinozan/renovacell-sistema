// ETIQUETAS EN LA FICHA (15 nov 2026, equipo: "etiquetas para los clientes"). Las etiquetas de la vendedora son sus listas
// de Difusiones: aquí se ven, se ponen o quitan con un toque y se crea una nueva sin salir del chat.
import React, { useCallback, useEffect, useState } from 'react'
import { Plus, Tag } from 'lucide-react'
import { difusiones as clientePorDefecto, type ClienteDifusiones } from '../../data/ops/difusiones'

export function EtiquetasCliente({ customerId, cliente = clientePorDefecto }: { customerId: string; cliente?: ClienteDifusiones }) {
  const [lista, setLista] = useState<Array<{ id: string; nombre: string; puesta: boolean }> | null>(null)
  const [nueva, setNueva] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const cargar = useCallback(async () => { const r = await cliente.etiquetasDe(customerId); if (r.ok) setLista(r.data); else setError(r.mensaje) }, [cliente, customerId])
  useEffect(() => { void cargar() }, [cargar])
  const alternar = async (id: string, puesta: boolean) => {
    setLista((l) => l?.map((e) => (e.id === id ? { ...e, puesta: !puesta } : e)) ?? l)   // al instante; si falla, se recarga
    const r = await cliente.cambiarClientes(id, [customerId], !puesta)
    if (!r.ok) { setError(r.mensaje); void cargar() }
  }
  const crear = async (e: React.FormEvent) => {
    e.preventDefault()
    const nombre = nueva.trim(); if (nombre.length < 2) return
    setOcupado(true); setError(null)
    const g = await cliente.guardarLista(null, nombre)
    if (g.ok) { const c = await cliente.cambiarClientes(g.data.id, [customerId], true); if (!c.ok) setError(c.mensaje); setNueva('') } else setError(g.mensaje)
    setOcupado(false); void cargar()
  }
  return (
    <div className="cli-etiquetas" data-testid="etiquetas-cliente">
      <small className="pc-sec"><Tag size={13} aria-hidden /> Etiquetas</small>
      {lista === null && !error && <small>Cargando…</small>}
      <div className="cli-etiquetas-chips">
        {lista?.map((e) => (
          <button key={e.id} type="button" aria-pressed={e.puesta} onClick={() => void alternar(e.id, e.puesta)} data-testid="etiqueta">{e.nombre}</button>
        ))}
      </div>
      <form onSubmit={crear} className="cli-etiquetas-nueva">
        <input value={nueva} onChange={(e) => setNueva(e.target.value)} maxLength={60} placeholder="Nueva etiqueta (ej. Compra cada mes)" aria-label="Nueva etiqueta" data-testid="etiqueta-nueva" />
        <button type="submit" disabled={ocupado || nueva.trim().length < 2} aria-label="Crear y poner la etiqueta"><Plus size={16} /></button>
      </form>
      {error && <small role="alert" className="cli-etiquetas-error">{error}</small>}
    </div>
  )
}
