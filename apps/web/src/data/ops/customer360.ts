// CUSTOMER 360 — modelo y cliente (C360-F2B → C360-F3).
//
// F2B componía la ficha en el navegador con varias consultas. C360-F3 la compone en el SERVIDOR
// (`cliente_360`), que agrega los dominios canónicos y REDACTA por rol:
//   identidad comercial → customers          portal/verificación → profiles (+ meta)
//   teléfonos           → customer_phones    domicilios → doctor_locations (+ tipo, municipio)
//   perfiles fiscales   → customer_fiscal_profiles (0..N)       vendedor → cc_cartera (CC-7)
//   atribución          → cc_visitors / prospects (aparte)      pedidos → orders por customer_id
//   pagos               → payment_entries / v_order_money (W2)   facturas → fiscal_documents (W3)
//   conversación        → cc_conversations (CC)                 actividad → customer_events + cartera + pedidos
// Las mutaciones son comandos del servidor (cliente_*); la cartera se asigna con los comandos de CC-7.
// Mostrar nunca modifica snapshots (orders.shipping_meta / invoice_meta / fiscal_documents.receiver).
import { hasSupabase, supabase } from '../../lib/supabase'
import { VERIF_LABEL, type VerificationStatus } from './verification'
import type { DoctorLocation } from './doctorLocation'

export type RolC360 = 'direccion' | 'vendedor' | 'dueno' | 'facturacion' | 'servicio'
export type EtiquetaTelefono = 'celular' | 'whatsapp' | 'consultorio' | 'recepcion' | 'otro'
export const ETIQUETAS_TELEFONO: Array<{ key: EtiquetaTelefono; label: string }> = [
  { key: 'celular', label: 'Celular' }, { key: 'whatsapp', label: 'WhatsApp' }, { key: 'consultorio', label: 'Consultorio' }, { key: 'recepcion', label: 'Recepción' }, { key: 'otro', label: 'Otro' },
]
export interface Telefono { id: string; numero: string; etiqueta: EtiquetaTelefono; es_principal: boolean; origen: 'manual' | 'migracion' | 'legado' }
export interface PerfilFiscal { id: string; alias: string; rfc: string; razon_social?: string; regimen?: string; cp?: string; uso_cfdi?: string; email_facturacion?: string; es_predeterminado: boolean; updated_at?: string }
export interface Nota { id: number; texto: string; autor_rol: string | null; autor: string | null; at: string }
export interface Pedido360 { id: string; folio: string | null; fecha: string; estado: string | null; total: number | null; estado_pago: string | null; cobrado?: number | null; saldo: number | null; factura_solicitada: boolean | null }
export interface Pago360 { pedido: string | null; fecha: string | null; direccion: string; metodo: string | null; monto: number; moneda: string | null }
export interface PagoReportado { pedido: string | null; fecha: string | null; metodo: string | null; monto: number; estado: string }
export interface Factura360 { pedido: string | null; tipo: string; estado: string; uuid: string | null; serie: string | null; folio: string | null; total: number | null; fecha: string; receptor_rfc?: string | null }
export interface Evento360 { at: string; tipo: string; actor_rol: string | null; actor: string | null }
export interface Cliente360 {
  customer_id: string
  rol: RolC360
  permisos: { contacto: string[]; telefonos: boolean; domicilios: boolean; fiscal: boolean; notas: boolean; cartera: boolean; adoptar_alta: boolean }
  resumen: {
    nombre: string; activo: boolean; creado_at: string | null; origen: string | null
    portal: { tiene: boolean; verificado: boolean; activo: boolean; profile_id?: string | null }
    vendedor: { id?: string | null; nombre: string | null; desde: string | null; elegible: boolean } | null
    vendedor_historico?: string | null
  }
  contacto: { email: string | null; ciudad: string | null; pais: string | null; email_portal?: string | null; telefonos: Telefono[]; alta: { telefono: string | null; ciudad: string | null } | null; notas?: Nota[] | null; nota_legada?: string | null }
  domicilios: { lista: DoctorLocation[]; archivados: number; alta: { line1?: string; colonia?: string; cp?: string; city?: string; state?: string } | null }
  facturacion: PerfilFiscal[]
  profesional?: { cedula: string | null; organizacion: string | null; especialidad: string | null; verificado: boolean; verification: { status?: string } | null; sep: Record<string, unknown> | null; identidad: Record<string, unknown> | null; ultimo_acceso: string | null }
  comercial?: {
    historial: Array<{ anterior: string | null; nuevo: string | null; motivo: string | null; at: string }> | null
    atribucion: { origen: string | null; referido: { vendedor: string | null; primer_contacto: Record<string, unknown> | null; at: string | null } | null; prospecto: { fuente: string | null; estado: string | null; at: string | null } | null }
    conversacion: { id: string; modo: string; estado: string; ultimo_mensaje_at: string | null; origen: string | null; ruteo_motivo: string | null; asesor: string | null } | null
    carrito: { id: string; n_items: number; handoff: string | null } | null
  }
  pedidos: Pedido360[]
  resumen_pedidos: { n: number; total: number; ultimo: string | null }
  pagos?: Pago360[]
  pagos_reportados?: PagoReportado[]
  facturas: Factura360[]
  actividad?: Evento360[]
}

// ── Pestañas: SOLO las que tienen datos canónicos para este rol ───────────────────────────────
export type Pestana = 'resumen' | 'contacto' | 'domicilios' | 'facturacion' | 'comercial' | 'pedidos' | 'pagos' | 'facturas' | 'conversacion' | 'actividad'
export const ETIQUETA_PESTANA: Record<Pestana, string> = {
  resumen: 'Resumen', contacto: 'Contacto', domicilios: 'Domicilios', facturacion: 'Facturación', comercial: 'Comercial',
  pedidos: 'Pedidos', pagos: 'Pagos', facturas: 'Facturas', conversacion: 'Conversación', actividad: 'Actividad',
}
export function pestanasDe(c: Cliente360): Pestana[] {
  const t: Pestana[] = ['resumen', 'contacto', 'domicilios', 'facturacion']
  if (c.comercial) t.push('comercial')
  t.push('pedidos')
  if (c.pagos) t.push('pagos')
  t.push('facturas')
  if (c.comercial) t.push('conversacion')
  if (c.actividad) t.push('actividad')
  return t
}

// ── Respuestas rápidas del Resumen (sin inventar: si no hay dato, null) ──────────────────────
export const telefonoPrincipal = (c: Cliente360): Telefono | null => c.contacto.telefonos.find((t) => t.es_principal) ?? c.contacto.telefonos[0] ?? null
export const domicilioPredeterminado = (c: Cliente360): DoctorLocation | null => c.domicilios.lista.find((l) => l.is_default) ?? c.domicilios.lista[0] ?? null
export const perfilFiscalPredeterminado = (c: Cliente360): PerfilFiscal | null => c.facturacion.find((f) => f.es_predeterminado) ?? null
export function estadoVerificacion(c: Cliente360): { status: VerificationStatus | 'sin_portal'; label: string } {
  if (!c.resumen.portal.tiene) return { status: 'sin_portal', label: 'Sin cuenta de portal' }
  if (c.resumen.portal.verificado) return { status: 'verified', label: VERIF_LABEL.verified }
  const s = c.profesional?.verification?.status
  const st = (s === 'rejected' || s === 'revoked' || s === 'pending' || s === 'verified' ? s : 'pending') as VerificationStatus
  return { status: st, label: VERIF_LABEL[st] ?? st }
}
export function lineaDomicilio(l: Pick<DoctorLocation, 'line1' | 'exterior_number' | 'interior_number' | 'neighborhood' | 'postal_code' | 'city' | 'state'> & { municipio?: string | null }): string {
  const calle = [l.line1, l.exterior_number && `#${l.exterior_number}`, l.interior_number && `int. ${l.interior_number}`].filter(Boolean).join(' ')
  return [calle, l.neighborhood, l.postal_code && `C.P. ${l.postal_code}`, l.municipio && l.municipio !== l.city ? l.municipio : null, l.city, l.state].map((s) => (s ?? '').toString().trim()).filter(Boolean).join(', ')
}
export const ETIQUETA_EVENTO: Record<string, string> = {
  contacto_actualizado: 'Contacto actualizado', telefono_agregado: 'Teléfono agregado', telefono_actualizado: 'Teléfono editado', telefono_principal: 'Teléfono principal cambiado', telefono_archivado: 'Teléfono archivado',
  domicilio_agregado: 'Domicilio agregado', domicilio_actualizado: 'Domicilio editado', domicilio_predeterminado: 'Domicilio predeterminado cambiado', domicilio_archivado: 'Domicilio archivado', domicilio_adoptado_alta: 'Domicilio del registro adoptado',
  fiscal_agregado: 'Perfil fiscal agregado', fiscal_actualizado: 'Perfil fiscal editado', fiscal_predeterminado: 'Perfil fiscal predeterminado cambiado', fiscal_archivado: 'Perfil fiscal archivado',
  nota_agregada: 'Nota agregada', cartera_asignada: 'Vendedor asignado', cartera_reasignada: 'Vendedor reasignado', cartera_retirada: 'Vendedor retirado', pedido_creado: 'Pedido creado', migracion: 'Migración',
}

// ── Cliente de comandos (RPC del servidor; inyectable en pruebas) ──────────────────────────────
type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
const rpcPorDefecto: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args)
export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }

export function mensajeError360(m: string | undefined): string {
  const t = m ?? ''
  if (/TELEFONO_DUPLICADO/.test(t)) return 'Ese número ya está registrado para este cliente.'
  if (/TELEFONO_INVALIDO/.test(t)) return 'El teléfono debe tener de 10 a 15 dígitos y solo números, espacios, +, -, paréntesis o punto (un número por registro).'
  if (/FISCAL_INVALIDO: (.+)/.test(t)) return 'Datos fiscales: ' + (t.match(/FISCAL_INVALIDO: ([^\n]+)/)?.[1] ?? 'revisa los campos') + '.'
  if (/DOMICILIO_INVALIDO: (.+)/.test(t)) return 'Domicilio: ' + (t.match(/DOMICILIO_INVALIDO: ([^\n]+)/)?.[1] ?? 'revisa los campos') + '.'
  if (/CAMPO_NO_PERMITIDO/.test(t)) return 'No puedes cambiar ese dato.'
  if (/CORREO_INVALIDO/.test(t)) return 'El correo no es válido.'
  if (/ARCHIVAD|INACTIVA/.test(t)) return 'Ese elemento está archivado.'
  if (/NO_AUTORIZADO|permission denied/.test(t)) return 'No tienes permiso para esta acción sobre este cliente.'
  if (/CLIENTE_INEXISTENTE/.test(t)) return 'No encontramos el expediente de este cliente.'
  return 'No se pudo completar. Intenta de nuevo.'
}

export class ClienteC360 {
  constructor(private rpc: Rpc = rpcPorDefecto) {}
  private async llamar<T>(fn: string, args?: Record<string, unknown>): Promise<Resultado<T>> {
    if (!hasSupabase && this.rpc === rpcPorDefecto) return { ok: false, error: 'Customer 360 requiere conexión con el servidor.' }
    try {
      const { data, error } = await this.rpc(fn, args)
      if (error) return { ok: false, error: mensajeError360(error.message) }
      return { ok: true, data: data as T }
    } catch { return { ok: false, error: 'No hay conexión con el servidor. Intenta de nuevo.' } }
  }
  leer(customerId: string | null) { return this.llamar<Cliente360>('cliente_360', { p_customer: customerId }) }
  perfilesFiscales(customerId: string | null) { return this.llamar<{ customer_id: string; puede_editar: boolean; perfiles: PerfilFiscal[] }>('cliente_perfiles_fiscales', { p_customer: customerId }) }
  guardarContacto(customerId: string | null, patch: Record<string, string>) { return this.llamar('cliente_contacto_guardar', { p_customer: customerId, p_patch: patch }) }
  guardarTelefono(customerId: string | null, id: string | null, numero: string, etiqueta: EtiquetaTelefono, principal?: boolean) {
    return this.llamar<{ id: string }>('cliente_telefono_guardar', { p_customer: customerId, p_telefono: id, p_numero: numero, p_etiqueta: etiqueta, p_principal: principal ?? null })
  }
  telefonoPrincipal(id: string) { return this.llamar('cliente_telefono_principal', { p_telefono: id }) }
  archivarTelefono(id: string) { return this.llamar('cliente_telefono_archivar', { p_telefono: id }) }
  guardarDomicilio(customerId: string | null, id: string | null, datos: Record<string, unknown>, predeterminado?: boolean) {
    return this.llamar<{ id: string }>('cliente_ubicacion_guardar', { p_customer: customerId, p_ubicacion: id, p_datos: datos, p_predeterminada: predeterminado ?? null })
  }
  domicilioPredeterminado(id: string) { return this.llamar('cliente_ubicacion_predeterminar', { p_ubicacion: id }) }
  archivarDomicilio(id: string) { return this.llamar('cliente_ubicacion_archivar', { p_ubicacion: id }) }
  adoptarAlta(customerId: string | null) { return this.llamar<{ adoptado: boolean; motivo?: string }>('cliente_ubicacion_adoptar_alta', { p_customer: customerId }) }
  guardarFiscal(customerId: string | null, id: string | null, datos: Record<string, unknown>, predeterminado?: boolean) {
    return this.llamar<{ id: string }>('cliente_fiscal_guardar', { p_customer: customerId, p_perfil: id, p_datos: datos, p_predeterminado: predeterminado ?? null })
  }
  fiscalPredeterminado(id: string) { return this.llamar('cliente_fiscal_predeterminar', { p_perfil: id }) }
  archivarFiscal(id: string) { return this.llamar('cliente_fiscal_archivar', { p_perfil: id }) }
  agregarNota(customerId: string, texto: string) { return this.llamar('cliente_nota_agregar', { p_customer: customerId, p_texto: texto }) }
}
export const cliente360 = new ClienteC360()
