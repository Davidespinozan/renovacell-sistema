// PAGOS EN LÍNEA · interruptor de Dirección (pagos_config, mig 20270202). Las Edges que INICIAN un cobro con tarjeta en
// línea lo leen con la llave de servidor y se niegan si está apagado. Falla cerrado: sin fila o con error, no hay cobro.
// deno-lint-ignore no-explicit-any
export async function tarjetaEnLineaActiva(admin: any): Promise<boolean> {
  try {
    const { data, error } = await admin.from('pagos_config').select('tarjeta_en_linea').eq('id', 1).maybeSingle()
    return !error && data?.tarjeta_en_linea === true
  } catch { return false }
}
export const RESPUESTA_APAGADO = { error: 'pagos_en_linea_apagados', message: 'El pago con tarjeta en línea aún no está disponible. Puedes pagar por transferencia, o en efectivo o con tarjeta en sucursal.' }
