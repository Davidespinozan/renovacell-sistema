// Entorno de Facturama — FAIL-CLOSED (W3-A · punto 9 del diseño congelado).
//
// Antes: `FACTURAMA_URL ?? 'https://api.facturama.mx'`. Es decir, cualquier despliegue
// sin configurar apuntaba SIN AVISO a PRODUCCIÓN del PAC. Un comprobante de prueba y uno
// fiscalmente real quedaban a un descuido de distancia.
//
// Ahora el entorno es una DECISIÓN EXPLÍCITA y la URL se DERIVA de ella:
//   FACTURAMA_ENV = 'sandbox' | 'produccion'   (sin default, sin URL libre)
// Ausente o inválido ⇒ la operación fiscal queda bloqueada.
//
// Puro (sin Deno, sin red) para poder probarlo fuera del runtime.

export type EntornoFacturama = 'sandbox' | 'produccion'

export type ResolucionFacturama =
  | { ok: true; entorno: EntornoFacturama; base: string }
  | { ok: false; error: 'config_incompleta'; message: string }

// Las bases son parte del código, no de la configuración: así no existe forma de
// apuntar el timbrado a un host arbitrario desde una variable de entorno.
const BASES: Record<EntornoFacturama, string> = {
  sandbox: 'https://apisandbox.facturama.mx',
  produccion: 'https://api.facturama.mx',
}

export function resolverFacturama(raw: string | null | undefined): ResolucionFacturama {
  const env = (raw ?? '').trim().toLowerCase()
  if (env === '') {
    return {
      ok: false,
      error: 'config_incompleta',
      message: 'Falta declarar el entorno fiscal (FACTURAMA_ENV = sandbox o produccion). La operación queda bloqueada: no se asume producción.',
    }
  }
  if (env !== 'sandbox' && env !== 'produccion') {
    return {
      ok: false,
      error: 'config_incompleta',
      message: `Entorno fiscal no válido ("${env}"). Usa sandbox o produccion. La operación queda bloqueada: no se asume producción.`,
    }
  }
  return { ok: true, entorno: env, base: BASES[env] }
}
