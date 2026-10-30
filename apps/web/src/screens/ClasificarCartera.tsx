// HERRAMIENTAS DEL VENDEDOR · bloque B · "Clasifica tu cartera": cada vendedor marca a sus clientes como Doctor o Clínica y
// su especialidad, en una lista rápida (un toque por cliente; se guarda solo). Sin esto, la difusión "a los dermatólogos"
// no encuentra a nadie. El jefe de ventas y Dirección clasifican a todos. Dirección agrega especialidades.
import React, { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Search, Tags } from 'lucide-react'
import { perfilComercial as clientePorDefecto, type ClientePerfilComercial, type FilaClasificar, type MisClientesPerfil, type TipoCliente } from '../data/ops/perfilComercial'
import { ControlesPerfil, olvidarEspecialidades, useEspecialidades } from '../app/PerfilComercialEditor'
import { capitalizarNombre } from '../lib/nombres'
import { useRoleOpcional } from '../auth/RoleContext'

const PAGINA = 50

export function ClasificarCartera({ cliente = clientePorDefecto, abiertoInicial = false }: { cliente?: ClientePerfilComercial; abiertoInicial?: boolean }) {
  const esDireccion = useRoleOpcional()?.role === 'admin'
  const [abierto, setAbierto] = useState(abiertoInicial)
  const [q, setQ] = useState('')
  const [soloSin, setSoloSin] = useState(true)
  const [pagina, setPagina] = useState(0)
  const [datos, setDatos] = useState<MisClientesPerfil | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [versionEsp, setVersionEsp] = useState(0)
  const especialidades = useEspecialidades(cliente)
  void versionEsp
  const cargar = useCallback(async () => {
    const r = await cliente.misClientes(q.trim(), soloSin, PAGINA, pagina * PAGINA)
    if (!r.ok) { setError(r.mensaje); return }
    setError(null); setDatos(r.data)
  }, [cliente, q, soloSin, pagina])
  useEffect(() => { const h = window.setTimeout(() => void cargar(), q ? 300 : 0); return () => window.clearTimeout(h) }, [cargar, q])
  useEffect(() => { setPagina(0) }, [q, soloSin])

  const guardar = async (f: FilaClasificar, t: TipoCliente | null, esp: string | null, otra: string | null) => {
    if (esp === 'otra' && !otra) { setDatos((d) => d && { ...d, clientes: d.clientes.map((x) => (x.customer_id === f.customer_id ? { ...x, tipo: t, especialidad: esp } : x)) }); return }
    setOcupado(f.customer_id)
    const r = await cliente.guardar(f.customer_id, t, esp, otra)
    setOcupado(null)
    if (!r.ok) { setError(r.mensaje); return }
    // Se queda en la lista hasta recargar (para poder poner la especialidad después del tipo); el avance se actualiza.
    setDatos((d) => d && {
      ...d, clasificados: d.clasificados + (f.tipo == null && t != null ? 1 : f.tipo != null && t == null ? -1 : 0),
      doctores: d.doctores + (t === 'doctor' ? 1 : 0) - (f.tipo === 'doctor' ? 1 : 0), clinicas: d.clinicas + (t === 'clinica' ? 1 : 0) - (f.tipo === 'clinica' ? 1 : 0),
      clientes: d.clientes.map((x) => (x.customer_id === f.customer_id ? { ...x, tipo: t, especialidad: esp, especialidad_otra: otra } : x)),
    })
  }
  const agregarEspecialidad = async () => {
    const nombre = window.prompt('Nueva especialidad (aparecerá en la lista para todos):')
    if (!nombre?.trim()) return
    const r = await cliente.agregarEspecialidad(nombre.trim())
    if (!r.ok) { setError(r.mensaje); return }
    olvidarEspecialidades(); setVersionEsp((v) => v + 1)
  }

  const pct = datos && datos.total ? Math.round((datos.clasificados / datos.total) * 100) : 0
  return (
    <section className="card ccar" data-testid="clasificar-cartera">
      <button type="button" className="ccar-h" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} data-testid="clasificar-abrir">
        <span className="ccar-ico" aria-hidden><Tags size={17} /></span>
        <span className="ccar-tx"><b>{esDireccion ? 'Clasificación de clientes' : 'Clasifica tu cartera'}</b>
          <small>{datos ? `${datos.clasificados.toLocaleString('es-MX')} de ${datos.total.toLocaleString('es-MX')} clasificados · ${datos.doctores} ${datos.doctores === 1 ? 'doctor' : 'doctores'} · ${datos.clinicas} ${datos.clinicas === 1 ? 'clínica' : 'clínicas'}` : 'Doctor o clínica y su especialidad, para mandarles difusiones'}</small></span>
        {datos && <span className="ccar-barra" aria-hidden><span style={{ width: `${pct}%` }} /></span>}
        {abierto ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {abierto && (
        <div className="ccar-b">
          <div className="ccar-filtros">
            <span className="searchbox" style={{ flex: 1, minWidth: 200 }}><Search size={15} aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente" aria-label="Buscar cliente para clasificar" data-testid="clasificar-q" /></span>
            <label className="pc-check"><input type="checkbox" checked={soloSin} onChange={(e) => setSoloSin(e.target.checked)} data-testid="clasificar-solo-sin" /> Solo sin clasificar</label>
            {esDireccion && <button type="button" className="btn ghost sm" onClick={() => void agregarEspecialidad()} data-testid="agregar-especialidad"><Plus size={14} /> Especialidad</button>}
          </div>
          {error && <div className="pce-error" role="alert">{error}</div>}
          {datos && datos.clientes.length === 0 && <div className="ccar-vacio">{soloSin && !q ? '¡Listo! Toda tu cartera está clasificada.' : 'Sin clientes con ese nombre.'}</div>}
          <ul className="ccar-lista">
            {(datos?.clientes ?? []).map((f) => (
              <li key={f.customer_id} className="ccar-fila" data-testid="clasificar-fila">
                <span className="ccar-nom"><b>{capitalizarNombre(f.nombre)}</b>{f.ciudad && <small>{f.ciudad}</small>}</span>
                <ControlesPerfil tipo={f.tipo} especialidad={f.especialidad} otra={f.especialidad_otra} especialidades={especialidades} compacto
                  ocupado={ocupado === f.customer_id} onCambio={(t, e, o) => void guardar(f, t, e, o)} />
              </li>
            ))}
          </ul>
          {datos && datos.encontrados > PAGINA && (
            <div className="ccar-pag">
              <button type="button" className="btn ghost sm" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>Anteriores</button>
              <span>{pagina * PAGINA + 1}–{Math.min((pagina + 1) * PAGINA, datos.encontrados)} de {datos.encontrados}</span>
              <button type="button" className="btn ghost sm" disabled={(pagina + 1) * PAGINA >= datos.encontrados} onClick={() => setPagina((p) => p + 1)}>Siguientes</button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
