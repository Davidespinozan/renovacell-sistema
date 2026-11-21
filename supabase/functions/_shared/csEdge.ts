// CyberSource (BanBajío) · utilidades de E/S compartidas por las Edges cs-* (solo Deno; los contratos puros viven en
// cybersource.ts, csJwt.ts y csBitacora.ts y se prueban desde vitest).
//   · obtenedorJwkCS: llave pública de Flex por kid (GET /flex/v2/public-keys/{kid}, mismo host del ambiente) con caché en memoria.
//   · llamarCS: una solicitud firmada (sin reintentos) + fila de la bitácora de pruebas cuando el ambiente es sandbox.
import { solicitarCS, type ConfigCS, type SolicitudCS, type RespuestaCS } from './cybersource.ts'
import { conCacheJwk, jwkDeRespuesta, rutaLlavePublicaCS, type ObtenerJwkCS } from './csJwt.ts'
import { bitacoraActiva, conBitacora, type FilaBitacora } from './csBitacora.ts'

// deno-lint-ignore no-explicit-any
type Admin = { from: (t: string) => any }

export function obtenedorJwkCS(cfg: ConfigCS): ObtenerJwkCS {
  return conCacheJwk(cfg.host, async (kid) => {
    const r = await solicitarCS(cfg, { metodo: 'GET', ruta: rutaLlavePublicaCS(kid) })
    return r.ok ? jwkDeRespuesta(r.data, kid) : null
  })
}

export function guardarBitacoraCS(admin: Admin): (f: FilaBitacora) => Promise<unknown> {
  return async (f) => { await admin.from('cs_bitacora_pruebas').insert(f) }
}

/** solicitarCS + bitácora de pruebas (solo sandbox: ambiente test en apitest.cybersource.com o CS_ENTORNO=sandbox). */
export function llamarCS<T = unknown>(cfg: ConfigCS, admin: Admin, attemptId: string, paso: FilaBitacora['paso'], s: SolicitudCS): Promise<RespuestaCS<T>> {
  return conBitacora({ activa: bitacoraActiva(cfg, Deno.env.get('CS_ENTORNO')), attemptId, paso, metodo: s.metodo, ruta: s.ruta, cuerpo: s.cuerpo, guardar: guardarBitacoraCS(admin) },
    () => solicitarCS<T>(cfg, s))
}
