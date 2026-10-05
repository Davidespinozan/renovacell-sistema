// Cliente ÚNICO de los comandos de inventario/pedido de W1 (RPC SECURITY DEFINER).
//
// Contrato:
//  · Cada intención del usuario lleva un `op_id` estable (newOpId / useOpId). Un
//    reintento de la MISMA intención reusa el MISMO op_id → el servidor no duplica
//    (devuelve `already_applied`). Una intención NUEVA usa un op_id nuevo.
//  · Nunca hay éxito optimista: el resultado es el que confirma el servidor.
//  · Error de NEGOCIO (RAISE 'CODIGO: …') ⇒ definitivo, mensaje de operador.
//  · Falla de TRANSPORTE (red, timeout, 5xx sin código) ⇒ AMBIGUO: se consulta el
//    registro de la operación (`inv_estado_operacion` en W1, `estado_operacion_dinero`
//    en W2); si el servidor ya la registró ⇒ éxito; si no, se reporta ambiguo
//    (NUNCA "no se aplicó") y la pantalla reintenta con el mismo op_id.
//  · W2 (dinero) usa su PROPIO registro de idempotencia (`money_operations`): un op_id
//    de dinero nunca se busca en el registro de inventario ni al revés.
import { supabase } from '../../lib/supabase'
import type { Database } from '../database.types'
import { atenderSuspension } from '../../auth/suspension'

type Fns = Database['public']['Functions']
// Comandos W1 que pasan por este cliente (firmas tipadas desde database.types.ts).
export type W1Rpc =
  | 'recibir_lote' | 'importar_lote' | 'cerrar_orden_compra' | 'ajustar_lote' | 'surtir_pedido' | 'vender_pos'
  | 'cancelar_pedido' | 'confirmar_reingreso' | 'recibir_devolucion' | 'disponer_devolucion' | 'anular_guia_manual'
export type W1Args<F extends W1Rpc> = Fns[F]['Args']

// Comandos W2 que escriben el libro de dinero (registro `money_operations`).
export type W2Rpc =
  | 'reportar_pago' | 'revisar_pago' | 'registrar_cobro'
  | 'autorizar_reembolso' | 'pagar_reembolso'
  | 'autorizar_credito' | 'revocar_credito' | 'reversar_asiento'
  | 'registrar_corte_caja' | 'anular_corte_caja'
export type W2Args<F extends W2Rpc> = Fns[F]['Args']

export type W1Status = 'applied' | 'already_applied' | 'already_cancelled' | 'already_verified' | 'already_rejected' | string

export type W1Result<T = Record<string, unknown>> =
  | { ok: true; status: W1Status; data: T }
  | { ok: false; error: string; code?: string; ambiguous?: boolean }

export const newOpId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16))

// Mensajes de operador para los códigos que RAISEan los comandos W1.
const MENSAJES: Record<string, string> = {
  NO_AUTORIZADO: 'No tienes permiso para esta operación.',
  CUENTA_SUSPENDIDA: 'Tu acceso fue suspendido por Dirección.',
  ACCESO_SOLO_POR_COMANDO: 'El acceso del personal se suspende o reactiva desde Equipo, no editando el perfil.',
  ROL_SOLO_POR_COMANDO: 'El rol se cambia desde Equipo, no editando el perfil.',
  AUTOSUSPENSION_PROHIBIDA: 'No puedes cambiar tu propio acceso.',
  SOLO_STAFF: 'Los doctores no se suspenden por aquí: su acceso se gobierna con la verificación.',
  STAFF_INEXISTENTE: 'Ese usuario no existe.',
  OP_ID_REUTILIZADO: 'Esta operación ya se registró con otros datos. Recarga la pantalla para ver el estado real antes de volver a intentar.',
  OP_ID_REQUERIDO: 'Falta el identificador de la operación. Recarga la pantalla.',
  MOTIVO_REQUERIDO: 'Escribe el motivo — es obligatorio.',
  CADUCIDAD_REQUERIDA: 'Indica la fecha de caducidad del lote.',
  CADUCIDAD_INVALIDA: 'La fecha de caducidad no es válida.',
  CADUCADO_NO_RECIBIBLE: 'Ese producto ya está caducado: no puede entrar como stock.',
  LOTE_CADUCIDAD_DISTINTA: 'Ese lote ya existe con otra fecha de caducidad. Revisa el código y la fecha: no se fusionan.',
  LOTE_REQUERIDO: 'Falta el código de lote.',
  CANTIDAD_INVALIDA: 'La cantidad debe ser mayor a cero.',
  RECEPCION_EXCEDE_PENDIENTE: 'La cantidad supera lo pendiente de la orden. El excedente se registra aparte con autorización de Dirección.',
  ORDEN_CERRADA: 'La orden ya está cerrada y no se reabre. Genera una orden nueva.',
  ORDEN_NO_ABIERTA: 'La orden ya no está abierta.',
  ORDEN_PRODUCTO_DISTINTO: 'La orden es de otro producto.',
  ORDEN_REQUERIDA: 'Selecciona la orden de compra o producción.',
  PEDIDO_INEXISTENTE: 'No se encontró el pedido.',
  PEDIDO_CANCELADO: 'El pedido está cancelado.',
  PEDIDO_YA_SURTIDO: 'Ese pedido ya fue surtido.',
  PEDIDO_NO_SURTIBLE: 'Ese pedido ya no está en un estado que permita surtirlo.',
  PEDIDO_NO_LIBERADO: 'Ese pedido no está liberado para surtir: registra el cobro o pide a Dirección que autorice crédito.',
  PEDIDO_SIN_RENGLONES: 'El pedido no tiene productos.',
  ASIGNACION_INCOMPLETA: 'Las cantidades por lote no cuadran con el pedido. Recarga el inventario y vuelve a intentar.',
  ASIGNACION_INVALIDA: 'Hay una asignación que no corresponde al pedido. Recarga e intenta de nuevo.',
  LOTE_DE_OTRO_PRODUCTO: 'Un lote asignado no corresponde al producto.',
  LOTE_CADUCADO: 'Un lote asignado está caducado; no se puede surtir ni vender.',
  INVENTARIO_INSUFICIENTE: 'No hay existencia suficiente en el lote. Recarga el inventario.',
  CANCELACION_REQUIERE_DIRECCION: 'Este pedido solo lo puede cancelar Dirección (ya hay pago o evidencia de pago).',
  USAR_DEVOLUCION: 'El pedido ya salió o se entregó: no se cancela, se registra una devolución.',
  GUIA_ACTIVA: 'El pedido tiene una guía de paquetería activa. Dirección debe registrar su anulación antes de cancelar.',
  GUIA_EN_RECONCILIACION: 'La guía está en estado desconocido con la paquetería; requiere reconciliación antes de anularla.',
  GUIA_EN_PROCESO: 'La guía todavía se está generando. Espera a que termine.',
  GUIA_NO_ANULABLE: 'Esa guía no se puede anular.',
  REFERENCIA_REQUERIDA: 'Escribe la referencia de la anulación en el portal de la paquetería.',
  REINGRESO_YA_CONFIRMADO: 'Ese reingreso ya fue confirmado.',
  REINGRESO_INCOMPLETO: 'Confirma cada renglón pendiente una sola vez.',
  DEVOLUCION_NO_PERMITIDA: 'Ese pedido no admite devolución en su estado actual.',
  DEVOLUCION_EXCEDE_SURTIDO: 'No se puede devolver más de lo que salió de ese lote en el pedido.',
  LOTE_NO_SURTIDO_EN_PEDIDO: 'Ese lote no salió en este pedido.',
  INSPECCION_REQUERIDA: 'Indica si cada producto llegó en buen estado o dañado.',
  VENDIBLE_NO_PERMITIDO: 'Ese producto no puede regresar a venta (dañado o caducado); solo a merma.',
  LINEA_YA_DISPUESTA: 'Ese renglón ya tiene destino asignado.',
  LINEA_SIN_INSPECCION: 'Almacén todavía no confirma ese reingreso.',
  MERMA_DEBE_SER_NEGATIVA: 'Una merma solo da de baja unidades.',
  CORRECCION_EXCEDE_RECEPCION: 'La corrección excede lo recibido en esa recepción.',
  PEDIDO_EXISTENTE: 'Ese identificador de venta ya pertenece a otro pedido. Recarga la caja.',

  // --- W2 · dinero -----------------------------------------------------------
  PAGO_SOLO_POR_COMANDO: 'El estado de pago no se edita a mano: se registra con un cobro, una verificación o un reembolso.',
  MONTO_INVALIDO: 'El monto debe ser mayor a cero.',
  METODO_INVALIDO: 'Selecciona una forma de pago válida.',
  FECHA_VALOR_FUTURA: 'La fecha del movimiento no puede ser futura.',
  FECHA_FUTURA: 'La fecha no puede ser futura.',
  CUENTA_INVALIDA: 'Esa cuenta bancaria no existe o está inactiva.',
  DECLARACION_ABIERTA: 'Ya hay un comprobante de este pedido en revisión. Espera la respuesta de Facturación.',
  DECLARACION_INEXISTENTE: 'No se encontró ese comprobante.',
  DECLARACION_RECHAZADA: 'Ese comprobante fue rechazado: el cliente debe enviar uno nuevo.',
  YA_VERIFICADO: 'Ese pago ya fue verificado: no se puede rechazar. Si el dinero no llegó, Dirección debe reversar el asiento.',
  SIN_SALDO: 'Ese pedido no tiene saldo por cobrar.',
  // El servidor usa este código en tres contextos (reembolso, tipo de custodia, tipo de
  // pérdida) y cada uno enumera sus opciones en el detalle. Por eso el mensaje base es
  // neutral y las opciones válidas se anexan desde el detalle (ver DETALLE_VOCABULARIO).
  TIPO_INVALIDO: 'El tipo indicado no es válido para esta operación.',
  REEMBOLSO_EXCEDE_COBRADO: 'No se puede reembolsar más de lo que se cobró de ese pedido.',
  REEMBOLSO_INEXISTENTE: 'No se encontró ese reembolso.',
  REEMBOLSO_YA_PAGADO: 'Ese reembolso ya se pagó.',
  VIA_DISTINTA_REQUIERE_DIRECCION: 'Devolver por una vía distinta a la del cobro requiere autorización de Dirección.',
  MOTIVO_VIA_REQUERIDO: 'Vas a devolver el dinero por una vía distinta a la del cobro: explica por qué.',
  CREDITO_YA_AUTORIZADO: 'Ese pedido ya tiene crédito vigente.',
  SIN_CREDITO_VIGENTE: 'Ese pedido no tiene crédito que revocar.',
  VENCIMIENTO_REQUERIDO: 'Indica la fecha límite de pago del crédito.',
  VENCIMIENTO_PASADO: 'La fecha límite no puede ser anterior a hoy.',
  ASIENTO_INEXISTENTE: 'No se encontró ese movimiento del libro.',
  ASIENTO_ES_REVERSA: 'Ese movimiento ya es una reversa: no se reversa una reversa.',
  ASIENTO_YA_REVERSADO: 'Ese movimiento ya fue reversado.',
  ALCANCE_INVALIDO: 'Selecciona el alcance del corte: del día o por cajero.',
  CAJERO_REQUERIDO: 'Selecciona el cajero del corte.',
  CORTE_INEXISTENTE: 'No se encontró ese corte de caja.',
  CORTE_YA_ANULADO: 'Ese corte ya fue anulado.',
  CORTE_ES_ANULACION: 'Ese registro es una anulación: no se vuelve a anular.',
  EFECTIVO_INSUFICIENTE: 'El efectivo recibido es menor al total de la venta.',

  // --- W2-C · custodia (eventos y consignación) ------------------------------
  // "En poder" = lo que el vendedor o el stand traen en la mano. "Disponible" = lo que
  // el almacén puede prometer: existencia propia menos lo que está en custodia.
  CUSTODIA_INEXISTENTE: 'No se encontró esa custodia. Recarga la pantalla.',
  CUSTODIA_CERRADA: 'Esta custodia ya está cerrada y no admite nuevas operaciones.',
  CUSTODIA_YA_ABIERTA: 'Esa persona ya tiene una custodia abierta de ese tipo. Usa la que ya existe o ciérrala antes de abrir otra.',
  CUSTODIA_CON_SALDO: 'La custodia todavía tiene producto en poder del responsable. Recibe la devolución, regístralo como vendido o asienta la pérdida antes de cerrarla.',
  CUSTODIA_EN_PODER: 'Esas unidades están en custodia de un vendedor o de un evento: no están en el almacén. Solo puedes usar las disponibles.',
  CUSTODIA_SALDO_INSUFICIENTE: 'El responsable no tiene tantas unidades de ese producto. Revisa su saldo antes de continuar.',
  DISPONIBILIDAD_INSUFICIENTE: 'No hay existencia disponible suficiente: parte del producto está en custodia de un vendedor o de un evento.',
  ENTREGA_SIN_RENGLONES: 'Indica qué producto y cuántas unidades vas a entregar.',
  DEVOLUCION_SIN_RENGLONES: 'Indica qué producto y cuántas unidades regresan.',
  PERDIDA_SIN_RENGLONES: 'Indica qué producto y cuántas unidades se perdieron.',
  INSPECCION_INVALIDA: 'Indica si el producto llegó en buen estado, dañado o caducado.',
  // Quién responde por la custodia: un usuario del sistema o un cliente del maestro.
  TENEDOR_REQUERIDO: 'Indica un solo responsable de la custodia: un usuario del sistema o un cliente registrado.',
  TENEDOR_INVALIDO: 'Indica qué tipo de responsable es: personal interno, doctor o tercero.',
  TENEDOR_INTERNO_REQUIERE_CUENTA: 'El personal interno se identifica con su usuario del sistema. Selecciónalo de la lista.',
  USUARIO_INEXISTENTE: 'Ese usuario no existe en el sistema.',
  CLIENTE_INEXISTENTE: 'Ese cliente no existe o está inactivo. Búscalo de nuevo o regístralo antes de continuar.',
  EVENTO_REQUIERE_NOMBRE: 'Escribe el nombre del evento.',
  CONSIGNACION_SIN_EVENTO: 'La consignación de un vendedor no lleva datos de evento. Si es un evento, créalo desde la pantalla de Eventos.',

  // --- Inventario y venta: códigos alcanzables que faltaban -------------------
  LOTE_INEXISTENTE: 'No se encontró ese lote. Recarga el inventario y vuelve a intentar.',
  VENTA_SIN_RENGLONES: 'Agrega al menos un producto antes de cobrar.',
  ASIGNACIONES_REQUERIDAS: 'Falta indicar de qué lotes sale el producto. Recarga la pantalla y vuelve a intentar.',
  CUSTOMER_INEXISTENTE: 'Ese cliente no existe o está inactivo.',
  TIPO_AJUSTE_INVALIDO: 'Tipo de movimiento no válido: usa merma, ajuste o corrección de recepción.',
  CORRECCION_DEBE_SER_NEGATIVA: 'Una corrección de recepción solo puede restar unidades. Si faltó capturar, registra otra entrada.',
  RECEPCION_REQUERIDA: 'Indica a qué recepción corresponde la corrección.',
  RECEPCION_INEXISTENTE: 'No se encontró esa recepción.',
  RECEPCION_DE_OTRO_LOTE: 'Esa recepción corresponde a otro lote.',
  RECEPCION_NO_APLICA: 'Solo una corrección de recepción se liga a una entrada previa.',

  // --- W3-A · intención fiscal --------------------------------------------------
  // La regla que ordena estos mensajes: un TIMEOUT no significa "no se timbró". Cuando
  // el estado es incierto NO se ofrece reintentar, se pide conciliar.
  FISCAL_SOLO_POR_COMANDO: 'La factura se solicita y se timbra con los comandos del sistema; no se edita a mano en el pedido.',
  DATOS_FISCALES_REQUERIDOS: 'Faltan datos fiscales completos del cliente: RFC, razón social, régimen, CP, uso de CFDI y correo. Complétalos antes de solicitar la factura.',
  FISCAL_INVALIDO: 'Los datos fiscales no son válidos. Revísalos y vuelve a guardarlos.',
  CFDI_EN_PROCESO: 'Ya hay un timbrado en curso para este pedido. Espera a que termine; no lo vuelvas a enviar.',
  CFDI_INCIERTO: 'No se sabe si el SAT ya timbró este pedido. Dirección debe conciliarlo antes de volver a intentar: un segundo intento podría generar una factura duplicada.',
  CFDI_CAMBIO_MATERIAL: 'El contenido a facturar cambió respecto de la solicitud registrada. Cancela la solicitud y créala de nuevo con los datos correctos.',
  YA_TIMBRADO: 'El CFDI ya fue emitido; el receptor no se puede cambiar. Si hay un error, requiere cancelación y refacturación.',
  FISCAL_SOLICITUD_CONGELADA: 'La solicitud de factura ya salió del sistema: su contenido no se modifica. Consulta el estado fiscal del pedido.',
  FISCAL_ESTADO_NO_DESCARTABLE: 'Solo se puede descartar una solicitud que todavía no se ha intentado timbrar.',
  FISCAL_DOCUMENTO_INEXISTENTE: 'No se encontró la solicitud de factura. Recarga la pantalla.',
  FISCAL_TRANSICION_INVALIDA: 'Ese cambio de estado fiscal no está permitido. Recarga la pantalla para ver el estado real.',
  FISCAL_TRANSICION_SOLO_POR_COMANDO: 'El estado fiscal solo lo cambia el sistema, con registro. Recarga la pantalla.',
  FISCAL_UUID_INMUTABLE: 'Ese pedido ya tiene un folio fiscal registrado y no se sobrescribe.',
  FISCAL_ENTORNO_INMUTABLE: 'No se puede cambiar el entorno de un comprobante ya timbrado.',
  FISCAL_IDENTIDAD_INMUTABLE: 'Una factura no cambia de pedido ni de tipo.',
  FISCAL_NO_SE_BORRA: 'Un documento fiscal no se elimina: es evidencia. Se cancela o se concilia.',
  CLAIM_REQUERIDO: 'Falta el identificador del intento. Recarga la pantalla.',
  w3_contencion: 'El timbrado de CFDI está bloqueado mientras se instala el nuevo camino fiscal. Tu solicitud de factura sí queda registrada y no se pierde.',
  config_incompleta: 'Falta configurar el entorno de facturación. Dirección debe declararlo antes de operar con el PAC.',

  // --- W3-B · numeración fiscal e identidad ante el proveedor -------------------
  EMISOR_SIN_RFC: 'Falta el RFC fiscal de la empresa en Configuración. Sin él no se puede numerar ni emitir un comprobante.',
  ENTORNO_FISCAL_INVALIDO: 'El entorno de facturación no es válido. Dirección debe declararlo como pruebas o producción.',
  SERIE_FISCAL_INEXISTENTE: 'No hay una serie fiscal activa configurada. Dirección debe definirla antes de facturar.',
  FISCAL_NUMERACION_SOLO_POR_COMANDO: 'La numeración fiscal la asigna el sistema; no se edita a mano.',
  FISCAL_IDENTIDAD_PROVEEDOR_CONGELADA: 'La serie, el folio y la fecha de este comprobante ya salieron del sistema y no se pueden cambiar: reutilizarlos tal cual es lo que evita una factura duplicada.',
  CFDI_YA_TIMBRADO: 'Este pedido ya tiene comprobante emitido; no se vuelve a timbrar.',
  FISCAL_ESTADO_NO_RECLAMABLE: 'La solicitud de factura no está en un estado que permita emitirla. Recarga la pantalla.',
  // --- W3-B · resultado del intento y conciliación ------------------------------
  FISCAL_SIN_RECLAMO_ACTIVO: 'Este intento de timbrado ya se resolvió. Recarga la pantalla para ver el estado real.',
  FISCAL_RECLAMO_AJENO: 'Otro intento tiene el control de este timbrado. No se registran dos resultados para el mismo comprobante.',
  FISCAL_TIMBRE_SIN_UUID: 'No se puede marcar como emitido sin el folio fiscal del SAT.',
  FISCAL_ESTADO_NO_ADOPTABLE: 'Ese comprobante no está en un estado que permita adoptar un folio encontrado.',
  FISCAL_ESTADO_NO_RESOLUBLE: 'Esa vía es solo para un comprobante cuyo resultado se desconoce. Recarga la pantalla.',
  FISCAL_EVIDENCIA_POSITIVA: 'Una búsqueda ya encontró comprobante para este pedido: no se puede declarar que no existe. Adóptalo o pide revisión manual.',
  FISCAL_INTENTO_RECIENTE: 'El intento es demasiado reciente para concluir que no se timbró. Espera y vuelve a consultar antes de decidir.',
  FISCAL_EVIDENCIA_INSUFICIENTE: 'Hacen falta al menos dos consultas al proveedor, separadas en el tiempo y sin resultado, antes de declarar que no existe comprobante.',
  SAT_NO_ENCONTRADO: 'El SAT no reconoce ese folio fiscal, así que no se adopta como comprobante de este pedido.',
  SAT_STATUS_INVALIDO: 'La respuesta del SAT no es un estatus reconocido. Vuelve a consultar.',
  RESULTADO_INVALIDO: 'Resultado de timbrado no válido.',
  construccion_fiscal_pendiente: 'La emisión de CFDI todavía no está habilitada: faltan decisiones fiscales de Dirección (impuestos por producto, clave de producto y forma de pago). Tu solicitud queda registrada.',

  // --- W3-C · catálogo fiscal del producto --------------------------------------
  // El catálogo real es heterogéneo (medicamentos y toxinas junto a sérums y
  // aparatología), así que no hay valor de respaldo: cada producto se valida.
  FISCAL_PRODUCTO_SOLO_POR_COMANDO: 'Los datos fiscales del producto se editan y se validan desde la pantalla de revisión fiscal, no a mano.',
  FISCAL_DEFAULTS_SOLO_POR_COMANDO: 'Los valores sugeridos por categoría los define Dirección desde la pantalla de revisión fiscal.',
  FISCAL_PRODUCTO_NO_SE_BORRA: 'La configuración fiscal de un producto no se elimina: se retira la validación indicando el motivo.',
  FISCAL_PRODUCTO_INMUTABLE: 'Una configuración fiscal no se puede pasar de un producto a otro.',
  FISCAL_PRODUCTO_SIN_CONFIGURAR: 'Ese producto todavía no tiene datos fiscales capturados. Captúralos antes de validarlo.',
  FISCAL_CONFIGURACION_INCOMPLETA: 'Faltan datos para poder validar este producto.',
  FUENTE_REQUERIDA: 'Indica en qué te basas para validar: criterio del contador, oficio o catálogo del SAT. Queda registrado junto con tu nombre.',
  CAMPO_FISCAL_DESCONOCIDO: 'Ese campo no es un dato fiscal editable. Revisa el nombre: no se aplicó ningún cambio.',
  SIN_CAMBIOS: 'No indicaste ningún dato fiscal a modificar.',
  PRODUCTO_REQUERIDO: 'Falta indicar el producto.',
  PRODUCTO_INEXISTENTE: 'Ese producto no existe en el catálogo.',
  CATEGORIA_REQUERIDA: 'Falta indicar la categoría.',
  DEFAULTS_CATEGORIA_INEXISTENTES: 'Dirección todavía no definió valores sugeridos para esa categoría.',
  ck_pf_tasa: 'La tasa no corresponde al tratamiento de IVA elegido: gravado lleva tasa mayor a cero, tasa cero lleva exactamente 0, y exento o no objeto no llevan tasa.',
  ck_pf_tratamiento: 'El tratamiento de IVA debe ser gravado, tasa cero, exento o no objeto.',
  ck_pf_objeto: 'El objeto de impuesto debe ser 01, 02 o 03.',
  ck_pf_clave_prod: 'La clave de producto o servicio del SAT son 8 dígitos.',
  ck_pf_clave_unidad: 'La clave de unidad del SAT son hasta 3 caracteres.',
  ck_pf_validado_completo: 'No se puede dejar validado un producto con datos fiscales incompletos.',

  // --- W3-C · C2 · evidencia histórica de precio --------------------------------
  // La evidencia es de PRECIO, nunca de impuesto: "el histórico coincide con el
  // final" no significa exento, y "histórico × 1.16" no autoriza el 16%.
  FISCAL_EVIDENCIA_SOLO_POR_COMANDO: 'La evidencia histórica de precios se carga con la importación del sistema, no a mano.',
  EVIDENCIA_VACIA: 'No hay filas que importar.',
  EVIDENCIA_CAMPO_DESCONOCIDO: 'Una de las filas trae un campo que no corresponde a la evidencia de precios. Revisa el archivo: no se importó nada.',
  EVIDENCIA_ORIGEN_REQUERIDO: 'Cada fila de la evidencia necesita su identificador de origen y el nombre histórico del producto.',
  ck_fpe_clasificacion: 'La clasificación de la evidencia debe ser una de las cuatro conocidas: histórico más 16%, histórico igual al final, no reconcilia, o sin referencia pública.',
  ck_fpe_procedencia: 'La procedencia de la evidencia debe ser coincidencia directa o a nivel de familia.',
  ck_fpe_mapeo_coherente: 'Para ligar una fila histórica a un producto hay que indicar también cómo se obtuvo la coincidencia: directa o por familia.',
  ck_fpe_familia: 'Una coincidencia a nivel de familia debe indicar de qué familia publicada proviene.',
  ck_fpe_motivo: 'Una fila que no se pudo ligar a ningún producto debe explicar por qué.',
  ck_fpe_sin_referencia: 'Una fila sin referencia en el listado público no puede traer precio publicado.',
  ck_pf_procedencia: 'La procedencia de la evidencia debe ser coincidencia directa o a nivel de familia.',
}

// El ÚNICO código cuyo detalle hay que anexar: TIPO_INVALIDO lo usan tres operaciones
// distintas (reembolso, tipo de custodia, tipo de pérdida) y el detalle es lo que
// distingue cuál. En los demás casos el mensaje base ya enumera las opciones en español,
// y el detalle del servidor traería tokens internos ("staff", "correccion_recepcion").
const DETALLE_VOCABULARIO = new Set(['TIPO_INVALIDO'])

// Un identificador interno (uuid) no le dice NADA al operador y no debe salir a pantalla.
// Se quita del detalle antes de mostrarlo; si al quitarlo el detalle deja de aportar,
// simplemente no se anexa y queda el mensaje base.
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
// Vocabulario interno de la base: viene en minúsculas con guion bajo
// ("correccion_recepcion", "pending_payment"). Tampoco sale a pantalla.
const TOKEN_INTERNO = /\b[a-z]+(?:_[a-z]+)+\b/g
export function limpiarDetalle(detalle: string): string {
  return detalle
    .replace(UUID, '')
    .replace(TOKEN_INTERNO, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/[\s,;:]+$/, '')
    .trim()
}

// Extrae el código de negocio ('CODIGO: detalle') o el nombre de restricción.
export function w1Code(message: string): string | undefined {
  const m = /\b([A-Z][A-Z0-9_]{3,})(?=:|\b)/.exec(message)
  return m && MENSAJES[m[1]] ? m[1] : m?.[1]
}

// Una violación de constraint llega como mensaje de Postgres, con el nombre en
// minúsculas: `... violates check constraint "ck_pf_tasa"`. El extractor de códigos
// solo reconoce tokens en MAYÚSCULAS, así que sin esto los mensajes de constraint
// jamás llegaban al operador y caían al texto degradado. Y es justo cuando más
// falta hace una explicación clara: el operador acaba de capturar algo incoherente.
const CONSTRAINT = /violates (?:check |unique )?constraint "([a-z][a-z0-9_]+)"/i
export function constraintCode(message: string): string | undefined {
  const m = CONSTRAINT.exec(message)
  return m && MENSAJES[m[1]] ? m[1] : undefined
}

// Código o restricción que SÍ está en el catálogo de mensajes. `w1Code` devuelve
// cualquier palabra en mayúsculas ("ERROR", "JWT"…), así que no sirve para decidir
// si el servidor respondió algo que sabemos leer: para eso está esta función.
export function codigoConocido(message: string): string | undefined {
  const ck = constraintCode(message)
  if (ck) return ck
  const code = w1Code(message)
  return code && MENSAJES[code] ? code : undefined
}

export function w1Message(message: string): string {
  const ck = constraintCode(message)
  if (ck) return MENSAJES[ck]
  const code = w1Code(message)
  if (code && MENSAJES[code]) {
    // Conserva el detalle del servidor cuando aporta: una cantidad concreta
    // (p. ej. "pendiente 40") o la lista de opciones válidas. Los identificadores
    // internos se eliminan antes de mostrarlo.
    const detail = limpiarDetalle(message.includes(':') ? message.slice(message.indexOf(':') + 1).trim() : '')
    const base = MENSAJES[code]
    const aporta = /\d/.test(detail) || DETALLE_VOCABULARIO.has(code)
    return aporta && detail !== '' && !['OP_ID_REUTILIZADO'].includes(code) ? `${base} (${detail})` : base
  }
  // Sin código conocido: se muestra lo que dijo el servidor, también sin identificadores.
  return limpiarDetalle(message.replace(/^[A-Z_]+:\s*/, '')) || 'No se pudo completar la operación.'
}

// ¿La falla es de transporte (resultado desconocido) y no una respuesta del servidor?
export function isAmbiguous(err: { message?: string; code?: string; status?: number } | null | undefined): boolean {
  if (!err) return false
  const msg = err.message ?? ''
  if (/Failed to fetch|NetworkError|Load failed|network|fetch failed|timeout|timed out|aborted|ECONN/i.test(msg)) return true
  if (!err.code && (err.status === undefined || err.status >= 500 || err.status === 0)) return !/[A-Z_]{4,}:/.test(msg)
  return false
}

export const AMBIGUO_MSG = 'No se pudo confirmar la operación con el servidor. Reintenta: el sistema NO la duplicará.'

// Consulta si el servidor ya registró la operación (recuperación tras respuesta ambigua).
// Cada ola tiene su propio registro: inventario (W1) y dinero (W2) no se mezclan.
async function estadoDe(registro: 'inv_estado_operacion' | 'estado_operacion_dinero', opId: string): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await supabase.rpc(registro, { p_op_id: opId })
    if (error) return null
    return (data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null)
  } catch {
    return null
  }
}

export const estadoOperacion = (opId: string) => estadoDe('inv_estado_operacion', opId)
export const estadoOperacionDinero = (opId: string) => estadoDe('estado_operacion_dinero', opId)

async function run<T>(rpc: string, params: unknown, opId: string,
                      registro: 'inv_estado_operacion' | 'estado_operacion_dinero'): Promise<W1Result<T>> {
  let resp: { data: unknown; error: { message?: string; code?: string; status?: number } | null }
  try {
    // La firma se verifica en compilación en runW1Command / runW2Command (abajo).
    resp = await supabase.rpc(rpc as W1Rpc, params as never) as unknown as typeof resp
  } catch (e) {
    resp = { data: null, error: { message: (e as Error)?.message ?? 'network' } }
  }
  const { data, error } = resp
  if (error) {
    if (isAmbiguous(error)) {
      const prev = await estadoDe(registro, opId)
      if (prev) return { ok: true, status: 'already_applied', data: prev as T }
      return { ok: false, ambiguous: true, error: AMBIGUO_MSG }
    }
    const msg = error.message ?? ''
    atenderSuspension(msg)
    return { ok: false, code: w1Code(msg), error: w1Message(msg) }
  }
  const obj = (data && typeof data === 'object' ? data : { value: data }) as Record<string, unknown>
  return { ok: true, status: (obj.status as string) ?? 'applied', data: obj as T }
}

// Comando de inventario/pedido (W1): idempotencia en `inventory_operations`.
export const runW1Command = <T = Record<string, unknown>, F extends W1Rpc = W1Rpc>(rpc: F, params: W1Args<F>, opId: string) =>
  run<T>(rpc, params, opId, 'inv_estado_operacion')

// Comando de dinero (W2): idempotencia en `money_operations`.
export const runW2Command = <T = Record<string, unknown>, F extends W2Rpc = W2Rpc>(rpc: F, params: W2Args<F>, opId: string) =>
  run<T>(rpc, params, opId, 'estado_operacion_dinero')
