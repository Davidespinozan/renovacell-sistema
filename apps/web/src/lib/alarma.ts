// AVISO RUIDOSO (2 nov 2026, dueño: "estamos perdiendo clientes… que le salga una notificación muy ruidosa"). Alarma del
// equipo comercial dentro del sistema: tres tonos fuertes (sin archivos de audio), vibración si el equipo la soporta y el
// título de la pestaña parpadeando hasta que la persona vuelve a ella. El navegador solo deja sonar después de un primer
// toque en la página: se "desbloquea" con el primer clic o tecla de la sesión.
let ctx: AudioContext | null = null
let desbloqueado = false
let parpadeo: ReturnType<typeof setInterval> | null = null
let tituloOriginal = ''

function contexto(): AudioContext | null {
  try {
    const C = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
    if (!C) return null
    if (!ctx) ctx = new C()
    return ctx
  } catch { return null }
}
export function prepararAlarma(): void {
  if (desbloqueado || typeof window === 'undefined') return
  const abrir = () => { const c = contexto(); if (c && c.state === 'suspended') void c.resume(); desbloqueado = true; window.removeEventListener('pointerdown', abrir); window.removeEventListener('keydown', abrir) }
  window.addEventListener('pointerdown', abrir, { once: false }); window.addEventListener('keydown', abrir, { once: false })
}

/** Tres tonos fuertes y ascendentes (~1.2 s). Nunca lanza. */
export function sonarAlarma(): void {
  try {
    const c = contexto(); if (!c) return
    if (c.state === 'suspended') void c.resume()
    const t0 = c.currentTime + 0.02
    ;[880, 1175, 1568].forEach((f, i) => {
      const o = c.createOscillator(); const g = c.createGain()
      o.type = 'square'; o.frequency.value = f
      g.gain.setValueAtTime(0.0001, t0 + i * 0.4); g.gain.exponentialRampToValueAtTime(0.6, t0 + i * 0.4 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.4 + 0.34)
      o.connect(g).connect(c.destination); o.start(t0 + i * 0.4); o.stop(t0 + i * 0.4 + 0.36)
    })
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.([400, 150, 400, 150, 700])
  } catch { /* sin audio: queda la tarjeta y el push */ }
}

/** El título parpadea hasta que la pestaña vuelve a estar visible y con foco. */
export function parpadearTitulo(texto: string): void {
  if (typeof document === 'undefined') return
  if (parpadeo) return
  tituloOriginal = document.title
  let on = false
  parpadeo = setInterval(() => {
    if (document.visibilityState === 'visible' && document.hasFocus()) { detenerParpadeo(); return }
    on = !on; document.title = on ? texto : tituloOriginal
  }, 900)
}
export function detenerParpadeo(): void {
  if (parpadeo) { clearInterval(parpadeo); parpadeo = null; if (tituloOriginal) document.title = tituloOriginal }
}

/** Avisos que suenan: lo que pide que alguien del equipo actúe YA. */
export const KINDS_ALARMA: ReadonlySet<string> = new Set(['handoff_asignado', 'handoff_aviso', 'handoff_escalado', 'handoff_sin_vendedor', 'retoma', 'cliente_escribe', 'senal_compra', 'verificacion_wa'])
export const textoAlarma = (kind: string) => (kind === 'cliente_escribe' ? '💬 Tu cliente está escribiendo' : kind === 'retoma' ? '🔔 Tu cliente volvió' : kind === 'senal_compra' ? '🛒 Señal de compra' : kind === 'verificacion_wa' ? '🪪 Verificar a un cliente' : '🔔 Cliente esperando')
