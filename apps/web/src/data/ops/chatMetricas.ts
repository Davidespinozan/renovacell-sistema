// CHAT V2-D3 · Instrumentación MÍNIMA de latencia del aviso del chat flotante (solo en memoria del navegador; sin red,
// sin contenido de mensajes, sin escrituras). Para medir en D4 sin tocar datos comerciales:
//   creado (servidor) → señal recibida (Realtime) → lectura canónica (inicio/fin) → aviso pintado.
// `via` dice QUÉ despertó la lectura que produjo el aviso (no se atribuye a Realtime lo que llegó por sondeo).
// Consulta: en la consola del navegador `window.__rcChatMetricas()`; con localStorage `rc_diag_chat=1` se imprime.
export type ViaLectura = 'realtime' | 'reconexion' | 'sondeo' | 'visibilidad' | 'episodio' | 'pestana' | 'diferido' | 'cierre'
export interface MedicionAviso {
  seq: number; via: ViaLectura
  creadoServidor: string            // created_at del mensaje (reloj del servidor)
  senalMs: number | null            // Date.now() al recibir la señal Realtime que despertó la lectura (si la hubo)
  lecturaInicioMs: number; lecturaFinMs: number; avisoMs: number
  extremoAExtremoMs: number | null  // avisoMs − creadoServidor (incluye el desfase de reloj del dispositivo)
  internoMs: number                 // avisoMs − (señal o inicio de lectura): sin desfase de reloj
}
const MAX = 50
const buffer: MedicionAviso[] = []
export function registrarAviso(m: Omit<MedicionAviso, 'extremoAExtremoMs' | 'internoMs'>): MedicionAviso {
  const creado = Date.parse(m.creadoServidor)
  const fila: MedicionAviso = { ...m, extremoAExtremoMs: Number.isFinite(creado) ? m.avisoMs - creado : null, internoMs: m.avisoMs - (m.senalMs ?? m.lecturaInicioMs) }
  buffer.push(fila); if (buffer.length > MAX) buffer.shift()
  try { if (localStorage.getItem('rc_diag_chat') === '1') console.info('[rc-chat] aviso', fila) } catch { /* sin storage */ }
  return fila
}
export const metricasAviso = (): MedicionAviso[] => [...buffer]
export const _limpiarMetricas = () => { buffer.length = 0 }
if (typeof window !== 'undefined') (window as unknown as { __rcChatMetricas?: () => MedicionAviso[] }).__rcChatMetricas = metricasAviso
