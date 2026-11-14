// PLANTILLAS DESDE EL SISTEMA (14 nov 2026, dueño: «en Leadsales hacían plantillas y las mandaban a verificación; deberían
// poder hacer eso desde adentro»). Puro: lo usan la pantalla de Dirección (escribir, vista previa) y la Edge `wa-plantillas`
// (mandar a Meta, leer su estado). Dirección escribe con datos legibles ({{cliente}}, {{vendedor}}…); a Meta se le manda
// con {{1}}, {{2}}… en ese orden, con un ejemplo de cada uno (Meta lo exige para revisarla).

export const VARIABLES = ['cliente', 'vendedor', 'promocion', 'promocion_hasta'] as const
export type Variable = (typeof VARIABLES)[number]
export const ETIQUETA_VARIABLE: Record<Variable, string> = { cliente: 'nombre del cliente', vendedor: 'nombre del vendedor', promocion: 'nombre de la promoción', promocion_hasta: 'fecha de fin de la promoción' }
export const EJEMPLO_VARIABLE: Record<Variable, string> = { cliente: 'Dra. López', vendedor: 'Roberto', promocion: 'Golden Placenta', promocion_hasta: '30 de noviembre' }

export type Categoria = 'MARKETING' | 'UTILITY'
export interface Borrador { etiqueta: string; categoria: Categoria; texto: string; botones: string[] }
export interface PlantillaLista { nombre: string; categoria: Categoria; cuerpo: string; variables: Variable[]; botones: string[] }

/** Nombre técnico para Meta: minúsculas, números y guion bajo (máx. 60). */
export function nombreTecnico(etiqueta: string): string {
  return etiqueta.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)
}

/** {{cliente}} … → {{1}} … en orden de aparición (una variable repetida usa el mismo número). */
export function aNumeradas(texto: string): { cuerpo: string; variables: Variable[] } | { error: string } {
  const variables: Variable[] = []
  let error: string | null = null
  const cuerpo = texto.replace(/\{\{\s*([^}]*?)\s*\}\}/g, (m, k: string) => {
    const v = k.toLowerCase() as Variable
    if (!(VARIABLES as readonly string[]).includes(v)) { error = `«{{${k}}}» no es un dato que el sistema pueda llenar. Usa los botones de datos.`; return m }
    let i = variables.indexOf(v); if (i < 0) { variables.push(v); i = variables.length - 1 }
    return `{{${i + 1}}}`
  })
  return error ? { error } : { cuerpo, variables }
}

/** {{1}} … → {{cliente}} … (para editar o mostrar una que ya existe). */
export function aLegibles(cuerpo: string, variables: string[]): string {
  return cuerpo.replace(/\{\{(\d+)\}\}/g, (m, n: string) => (variables[Number(n) - 1] ? `{{${variables[Number(n) - 1]}}}` : m))
}

/** Reglas de Meta que más rechazan, revisadas antes de mandar (Meta revisa el resto). */
export function validar(b: Borrador): { ok: true; plantilla: PlantillaLista } | { ok: false; error: string } {
  const etiqueta = b.etiqueta.trim()
  if (etiqueta.length < 3) return { ok: false, error: 'Ponle un nombre a la plantilla (mínimo 3 letras).' }
  const nombre = nombreTecnico(etiqueta)
  if (!/^[a-z0-9_]{3,60}$/.test(nombre)) return { ok: false, error: 'El nombre debe tener letras o números.' }
  if (b.categoria !== 'MARKETING' && b.categoria !== 'UTILITY') return { ok: false, error: 'Elige el tipo de plantilla.' }
  const texto = b.texto.replace(/[ \t]+\n/g, '\n').trim()
  if (texto.length < 10) return { ok: false, error: 'Escribe el mensaje.' }
  if (texto.length > 1024) return { ok: false, error: 'El mensaje es muy largo (máximo 1024 caracteres).' }
  const n = aNumeradas(texto)
  if ('error' in n) return { ok: false, error: n.error }
  if (/^\{\{\d+\}\}/.test(n.cuerpo) || /\{\{\d+\}\}[\s.!?¿¡,]*$/.test(n.cuerpo)) return { ok: false, error: 'Meta no acepta que el mensaje empiece o termine con un dato; agrega texto antes o después.' }
  if (n.variables.includes('promocion_hasta') && !n.variables.includes('promocion')) return { ok: false, error: 'La fecha de fin va junto con el nombre de la promoción: agrega también {{promocion}}.' }
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(n.cuerpo)) return { ok: false, error: 'Meta no acepta dos datos seguidos; separa con texto.' }
  if (/\n{3,}/.test(n.cuerpo)) return { ok: false, error: 'Quita los renglones vacíos de más.' }
  const botones = b.botones.map((x) => x.trim()).filter(Boolean)
  if (botones.length > 3) return { ok: false, error: 'Máximo 3 botones.' }
  if (botones.some((x) => x.length > 25)) return { ok: false, error: 'Cada botón puede tener máximo 25 caracteres.' }
  if (new Set(botones).size !== botones.length) return { ok: false, error: 'Hay botones repetidos.' }
  return { ok: true, plantilla: { nombre, categoria: b.categoria, cuerpo: n.cuerpo, variables: n.variables, botones } }
}

/** Lo que se le manda a Meta (POST /{waba}/message_templates). */
export function payloadMeta(p: PlantillaLista, idioma = 'es_MX'): Record<string, unknown> {
  const body: Record<string, unknown> = { type: 'BODY', text: p.cuerpo }
  if (p.variables.length) body.example = { body_text: [p.variables.map((v) => EJEMPLO_VARIABLE[v])] }
  const components: Record<string, unknown>[] = [body]
  if (p.botones.length) components.push({ type: 'BUTTONS', buttons: p.botones.map((text) => ({ type: 'QUICK_REPLY', text })) })
  return { name: p.nombre, language: idioma, category: p.categoria, components }
}

/** Estado de Meta → lo que ve Dirección. */
export const ESTADO_META: Record<string, { texto: string; tono: 'p-ok' | 'p-warn' | 'p-dang' | 'p-neu' }> = {
  sin_enviar: { texto: 'Sin mandar a Meta', tono: 'p-neu' },
  PENDING: { texto: 'En revisión de Meta', tono: 'p-warn' },
  IN_APPEAL: { texto: 'En apelación', tono: 'p-warn' },
  APPROVED: { texto: 'Aprobada', tono: 'p-ok' },
  REJECTED: { texto: 'Rechazada', tono: 'p-dang' },
  PAUSED: { texto: 'Pausada por Meta', tono: 'p-dang' },
  DISABLED: { texto: 'Desactivada por Meta', tono: 'p-dang' },
  PENDING_DELETION: { texto: 'Borrándose', tono: 'p-neu' },
}
export const editable = (estado: string | null | undefined) => !estado || estado === 'sin_enviar' || estado === 'REJECTED'

/** Error de Meta en palabras (sin códigos). */
export function errorMeta(e: { message?: string; error_user_msg?: string; error_user_title?: string; code?: number; error_subcode?: number } | null | undefined): string {
  if (!e) return 'Meta no respondió. Intenta de nuevo.'
  if (e.error_subcode === 2388023 || /already exists|ya existe/i.test(e.error_user_msg ?? e.message ?? '')) return 'Ya existe una plantilla con ese nombre en Meta. Usa otro nombre o espera a que se borre.'
  if (e.code === 190) return 'El acceso del sistema a Meta venció. Hay que renovar el token de WhatsApp.'
  if (e.code === 10 || e.code === 200) return 'El sistema no tiene permiso para crear plantillas en Meta (falta whatsapp_business_management).'
  return (e.error_user_msg || e.error_user_title || e.message || 'Meta rechazó la solicitud.').slice(0, 300)
}
