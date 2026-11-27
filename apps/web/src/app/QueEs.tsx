// QUÉ ES ESTA PANTALLA (27 nov 2026, dueño: «necesito que expliques de manera clara ahí en el sistema qué es cada
// sección… siento que no se entiende»). Un bloque igual en todas: arriba, SIEMPRE a la vista, qué es y para qué sirve;
// debajo, cómo se usa, qué hay dentro y qué significan las palabras raras. En computadora el detalle viene abierto la
// primera vez; en el celular viene cerrado (ahí el detalle empujaba la pantalla más de una pantalla hacia abajo) y se
// abre con «Cómo se usa». La elección se recuerda en ese dispositivo: quien ya sabe no carga con el texto.
// El texto vive en `explicaciones.ts`.
import React, { useState } from 'react'
import { Info } from 'lucide-react'
import { EXPLICACIONES, parteDe, type Explicacion, type IdExplicacion } from './explicaciones'
import { useAnchoMinimo } from './useAnchoMinimo'

const CLAVE = (id: string) => `rc_quees_${id}`
/** Lo que la persona eligió para esa pantalla: abierto, oculto, o null si nunca tocó el botón. */
const elegido = (id: string): boolean | null => { try { const v = localStorage.getItem(CLAVE(id)); return v === '1' ? true : v === '0' ? false : null } catch { return null } }
const recordar = (id: string, abierto: boolean) => { try { localStorage.setItem(CLAVE(id), abierto ? '1' : '0') } catch { /* sin almacenamiento: se recuerda solo en esta visita */ } }

/** `sinPartes`: la pantalla ya explica cada pestaña interna con <QueEsParte> al elegirla; aquí no se repiten. */
export function QueEs({ id, sinPartes = false }: { id: IdExplicacion; sinPartes?: boolean }) {
  const e: Explicacion = EXPLICACIONES[id]
  const ancho = useAnchoMinimo(700)
  const [pref, setPref] = useState<boolean | null>(() => elegido(id))
  const abierto = pref ?? ancho
  const alternar = () => { const v = !abierto; setPref(v); recordar(id, v) }
  const partes = sinPartes ? [] : (e.partes ?? [])
  const conDetalle = !!(e.pasos?.length || partes.length || e.palabras?.length || e.nota)
  return (
    <section className="quees" data-testid={`quees-${id}`} aria-label={`Qué es ${e.titulo}`}>
      <div className="quees-cab">
        <Info aria-hidden className="quees-ico" />
        <p className="quees-que" data-testid="quees-que"><b>{e.titulo}.</b> {e.que}</p>
        {conDetalle && (
          <button type="button" className="quees-alternar" aria-expanded={abierto} onClick={alternar} data-testid="quees-alternar">{abierto ? 'Ocultar' : 'Cómo se usa'}</button>
        )}
      </div>
      {conDetalle && abierto && (
        <div className="quees-cuerpo" data-testid="quees-cuerpo">
          <div className="quees-bloques">
          {e.pasos && e.pasos.length > 0 && (
            <div className="quees-bloque">
              <h3>Cómo se usa</h3>
              <ol>{e.pasos.map((p) => <li key={p}>{p}</li>)}</ol>
            </div>
          )}
          {partes.length > 0 && (
            <div className="quees-bloque">
              <h3>Qué hay en esta pantalla</h3>
              <dl>{partes.map(([n, q]) => <div key={n}><dt>{n}:</dt> <dd>{q}</dd></div>)}</dl>
            </div>
          )}
          {e.palabras && e.palabras.length > 0 && (
            <div className="quees-bloque">
              <h3>Palabras que vas a ver</h3>
              <dl>{e.palabras.map(([n, q]) => <div key={n}><dt>{n}:</dt> <dd>{q}</dd></div>)}</dl>
            </div>
          )}
          </div>
          {e.nota && <p className="quees-nota" data-testid="quees-nota"><b>Para tener en cuenta:</b> {e.nota}</p>}
        </div>
      )}
    </section>
  )
}

/** Una línea bajo el selector de una pestaña interna: qué es ESA parte. Usa el mismo texto que el bloque de arriba. */
export function QueEsParte({ id, parte }: { id: IdExplicacion; parte: string }) {
  const texto = parteDe(id, parte)
  return texto ? <p className="quees-parte" data-testid="quees-parte"><b>{parte}:</b> {texto}</p> : null
}
