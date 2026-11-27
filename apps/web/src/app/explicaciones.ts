// QUÉ ES CADA PANTALLA (27 nov 2026, dueño: «necesito que expliques de manera clara ahí en el sistema qué es cada sección:
// la facturación, y también trazabilidad, mermas y control de inventario… en facturación específicamente la revisión
// fiscal; ahorita siento que no se entiende qué son esas secciones»).
//
// Las pantallas ya traían una explicación, pero escondida detrás de «Cómo funciona» y escrita con palabras del oficio
// («kardex», «borrador fiscal», «disponer»). Aquí vive el texto de cada pantalla en lenguaje llano; lo pinta <QueEs>.
// Reglas del texto (las cuida `explicaciones.test.ts`):
//   · `que` dice QUÉ ES y para qué sirve en una o dos frases, sin tecnicismos. Siempre está a la vista.
//   · `pasos` es cómo se usa, en orden, nombrando los botones tal como se llaman en la pantalla.
//   · `partes` explica lo que hay dentro (sus pestañas internas o sus cifras), con el MISMO nombre que se ve.
//   · `palabras` define cada palabra rara que la pantalla sí usa. Ninguna palabra del oficio se queda sin definir.
export interface Explicacion {
  titulo: string
  que: string
  pasos?: string[]
  partes?: Array<[nombre: string, queEs: string]>
  palabras?: Array<[palabra: string, significa: string]>
  nota?: string
}

export const EXPLICACIONES = {
  facturacion: {
    titulo: 'Facturación',
    que: 'Aquí se hacen las facturas de las ventas. Están todos los pedidos; los que pidieron factura y todavía no la tienen salen en «Por emitir».',
    pasos: [
      'Toca «Por emitir» y abre el pedido.',
      'Revisa los datos fiscales del cliente: RFC, nombre, régimen, código postal y uso. Si faltan, captúralos ahí mismo y guárdalos.',
      'Toca «Solicitar factura» y después «Timbrar factura».',
      'Listo: al cliente le llega por correo. En el mismo pedido puedes descargarla o mandarla por WhatsApp.',
    ],
    palabras: [
      ['Timbrar', 'Registrar la factura ante el SAT. En ese momento la factura ya existe; después no se corrige, solo se cancela y se hace otra.'],
      ['CFDI', 'El nombre oficial de la factura electrónica. CFDI y factura son lo mismo.'],
      ['Por emitir', 'Pedidos que pidieron factura y todavía no la tienen.'],
      ['Emitidos', 'Pedidos que ya tienen su factura.'],
      ['Por cobrar', 'Pedidos vendidos que todavía no se pagan. No tiene que ver con si ya se facturaron.'],
      ['Factura global', 'Una sola factura al mes, a «público en general», con las ventas que nadie pidió facturar a su nombre. Está al final de esta pantalla.'],
    ],
    nota: 'Para timbrar, cada producto del pedido tiene que estar validado en la pestaña «Revisión fiscal»; si falta alguno, el pedido te dice cuál. El cliente puede pedir su factura hasta el último día del mes de la venta.',
  },
  revision_fiscal: {
    titulo: 'Revisión fiscal',
    que: 'Antes de facturar un producto, una persona tiene que confirmar con qué datos del SAT sale en la factura: su clave, su unidad y su IVA. Esa confirmación se hace aquí, producto por producto, y se llama «validar».',
    pasos: [
      'En la lista busca el producto y toca «Revisar».',
      'Compara los «Datos para la factura» con lo que indicó el contador. Si algo está mal, corrígelo y toca «Guardar borrador».',
      'Escribe en qué te basas (por ejemplo: «hoja del contador») y toca «Validar este producto».',
      'Repite con los demás. Conviene empezar por los que más se venden.',
    ],
    partes: [
      ['Productos', 'La lista de productos para validar. Aquí es donde se trabaja.'],
      ['Sugerencias por categoría', 'Datos sugeridos para toda una categoría, para no teclearlos producto por producto. Aplicar una sugerencia rellena lo que falta, pero no valida nada.'],
      ['Histórico sin producto', 'Renglones de los archivos históricos de ventas que no se pudieron ligar a ningún producto. Es solo consulta: aquí no hay nada que hacer.'],
      ['Envío', 'Los datos del SAT para el cobro de envío. Se validan una sola vez; sin eso no se puede facturar ningún pedido que lleve envío.'],
    ],
    palabras: [
      ['Validado', 'Ya se puede facturar.'],
      ['Completo sin validar', 'Tiene todos sus datos; solo falta que una persona los confirme.'],
      ['Incompleto', 'Le falta algún dato (la lista dice cuál). Hay que pedírselo al contador.'],
      ['Clave del SAT', 'El número con el que el SAT identifica el tipo de producto. La define el contador.'],
      ['Evidencia histórica', 'Precios a los que se vendió antes, tomados de los archivos históricos. Sirven de referencia; no deciden el IVA ni la clave.'],
      ['Timbrar', 'Registrar la factura ante el SAT. Se hace en la pestaña «Facturación».'],
    ],
    nota: 'Mientras un producto no esté validado, no se puede timbrar ninguna factura que lo incluya. No existe «validar todo»: cada producto queda con el nombre de quien lo confirmó.',
  },
  trazabilidad: {
    titulo: 'Trazabilidad',
    que: 'Sirve para saber a dónde fue a parar cada producto. Si un lote sale con problema, aquí ves a qué clientes se les entregó para poder avisarles.',
    partes: [
      ['Seguir un lote', 'Eliges un lote y ves de dónde vino, a qué clientes llegó y cuánto queda.'],
      ['Revisar un pedido', 'Eliges un pedido y ves con qué lotes se surtió.'],
    ],
    palabras: [
      ['Lote', 'El número que trae la caja de fábrica. Todas las piezas del mismo lote se fabricaron juntas y caducan el mismo día.'],
      ['Recall', 'Retirar del mercado un lote con problema: avisar a quienes lo recibieron y recoger el producto.'],
    ],
    nota: 'Es solo consulta: aquí no se cambia nada. Es el respaldo ante la autoridad sanitaria (COFEPRIS).',
  },
  mermas: {
    titulo: 'Mermas',
    que: 'Merma es producto que se perdió y ya no se puede vender: caducó, se dañó o se rompió. Aquí ves cuánto se perdió y cuánto dinero representa.',
    partes: [
      ['Pérdida por merma', 'Las piezas perdidas, por lo que le costaron a la empresa (su costo, no su precio de venta).'],
      ['Unidades dadas de baja', 'Cuántas piezas se perdieron.'],
      ['Eventos de merma', 'Cuántas veces se dio de baja producto.'],
      ['(mínimo)', 'Aparece cuando hay bajas viejas sin costo registrado: la pérdida real es mayor que la que se muestra.'],
    ],
    nota: 'Es solo un reporte: aquí no se captura nada. La merma la registra Almacén con «Dar de baja» en Existencias o en Por caducar, y aparece aquí sola. Arriba eliges ver este mes o todo el histórico.',
  },
  control_inventario: {
    titulo: 'Control de inventario',
    que: 'Es la revisión de Dirección sobre el inventario. Aquí decides qué se hace con el producto que regresa, compruebas que las existencias cuadren y ves lo que Almacén dio de baja.',
    partes: [
      ['Devoluciones por disponer', 'Producto que un cliente regresó y Almacén ya recibió y revisó. Tú decides su destino: «Vendible» (regresa al inventario) o «Merma» (se da de baja).'],
      ['Conciliación', 'El sistema suma las entradas y salidas de cada lote y revisa que den lo mismo que la existencia registrada. Toca «Conciliar ahora»; lo normal es 0 diferencias.'],
      ['Bajas de almacén', 'Lo que Almacén dio de baja en los últimos 30 días, quién lo hizo y por qué. Almacén no pide permiso para dar de baja: aquí lo revisas después.'],
    ],
    palabras: [
      ['Disponer', 'Decidir el destino de un producto devuelto.'],
      ['Kardex', 'La lista de todas las entradas y salidas de un lote.'],
      ['Conciliar', 'Comparar dos cuentas para ver que coincidan.'],
    ],
    nota: 'Si la conciliación marca diferencias, repórtalas antes de seguir operando: no deberían existir.',
  },
} satisfies Record<string, Explicacion>

export type IdExplicacion = keyof typeof EXPLICACIONES

/** Lo que es UNA parte de una pantalla (una de sus pestañas internas), por el nombre que se ve. Null si no está descrita. */
export function parteDe(id: IdExplicacion, nombre: string): string | null {
  const e: Explicacion = EXPLICACIONES[id]
  return e.partes?.find(([n]) => n === nombre)?.[1] ?? null
}
