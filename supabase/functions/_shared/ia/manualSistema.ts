// ASISTENTE DEL EQUIPO · manual del sistema (lo lee el asistente en cada pregunta; es fijo y va en caché). Los nombres entre
// «» son los del menú real (apps/web/src/app/roles.ts) o botones del chat; una prueba revisa que existan. Si una pantalla
// cambia de nombre, se actualiza aquí.
export const MANUAL_SISTEMA = `# Manual del sistema de Renovacell

Renovacell es una distribuidora de productos médicos y antiedad para doctores (venden solo a profesionales verificados). El sistema tiene: el panel del equipo (este), el portal del doctor y la atención por WhatsApp/Instagram/Messenger con un asistente de IA.

## Roles y su menú
- Dirección (admin): «Inicio» (la bandeja del día), «Tablero», «Ventas», «Clientes» (pestañas «Clientes», «Embudo de ventas», «Plazos de cartera», «Por verificar», «Invitar clientes»), «Conversaciones» (pestañas «Bandeja», «Asignadas», «Correos al cliente», «Difusiones», «Asesora IA»), «Catálogo» («Productos», «Precios», «Promociones», «Conocimiento de producto», «Manual de ventas»), «Sitio web», «Compras a proveedores», «Control de inventario» («Existencias», «Entradas», «Trazabilidad», «Mermas», «Custodias», «Eventos»), «Envíos» («Despacho», «Seguimiento»), «Finanzas» («Finanzas», «Cierre de caja»), «Cobros» («Pagos por validar», «Links de pago», «Revisión económica»), «Facturación» («Facturación», «Revisión fiscal»), «Equipo» («Personas», «Cartera y horario», «Metas y comisiones»), «Configuración» («Configuración», «Bitácora»).
- Ventas (pos): «Punto de venta», «Links de pago», «Clientes», «Mi inventario» (lo que tiene en custodia), «Productos» (quién compró cada producto), «Embudo de ventas», «Por vencer» (clientes cuya cartera vence), «Pendientes» (seguimientos por retomar), «Difusiones», «Promociones», y «Conversaciones» si tiene el permiso «Atender conversaciones». El jefe de ventas además ve «Metas y comisiones».
- Almacén (warehouse): «Inventario», «Por caducar», «Promociones», «Compras a proveedores» (solo ver qué viene), «Recibir mercancía» (aquí nace el inventario), «Devoluciones», «Custodia», «Preparar pedidos», «Por enviar», «Guías», «Despacho», «Seguimiento», «Horarios de entrega». Solo Almacén hace guías y recibe mercancía.
- Auxiliar de almacén (packing): «Inventario», «Por caducar», «Preparar pedidos», «Por enviar», «Despacho», «Horarios de entrega».
- Chofer (driver): «Chofer / Seguimiento» y «Horarios de entrega».
- Todos: «Avisos del equipo», «Chat del equipo» y la campana de avisos. Permisos extra por persona: «Diseño», «Eventos», «Catálogo y sitio web».

## Conversaciones con clientes
- Cada contacto (WhatsApp, Instagram, Messenger o el chat del portal) tiene UNA conversación. Estados: "ai_active" = la atiende la IA; "human_requested" = pidió asesor, nadie la tiene; "human_assigned" = asignada a un vendedor que todavía no la inicia (debe tocar «Iniciar»); "human_active" = un vendedor la está atendiendo; "human_ended" = terminó la atención (si el cliente vuelve a escribir, contesta la IA).
- ¿A quién le toca? Primero gana la CARTERA: si el contacto está ligado a un cliente con vendedor, va a ese vendedor. Si no está ligado (por ejemplo un WhatsApp cuyo número no está en su ficha) se REPARTE al azar entre los vendedores que reciben clientes nuevos; si en unos minutos nadie la inicia, pasa a otro (rotación). Por eso un cliente de un vendedor puede caerle a otro cuando su conversación no está ligada a su ficha.
- Menú «+» del chat (acciones con el cliente): «Vincular a un cliente» (liga la conversación a su ficha, guarda su número y la pasa sola al vendedor de su cartera), «Verificar y dar de alta» (cliente nuevo con cédula e INE), «Mandar acceso al portal», «Cotizar», «Levantar pedido», «Registrar pago» (con la foto del comprobante; Dirección lo valida), «Mandar recibo», «Ver su ficha», «Pasar a otro vendedor» (quien la tiene o Dirección, con motivo; la cartera no cambia), «Mandar ubicación» (la sucursal, la ubicación actual o un enlace de Google Maps; por WhatsApp llega como pin), «Dejar seguimiento» (te avisa el día que elijas) y, solo Dirección, «Eliminar conversación».
- Junto al campo de texto: el clip manda foto, video o documento; el rayo abre las respuestas rápidas (o escribe «/»).
- WhatsApp solo deja contestar libremente dentro de 24 horas desde el último mensaje del cliente; después, el sistema avisa; para retomar se usa una plantilla aprobada por Meta (solo si Dirección ya las activó).
- Si arriba del chat sale «Parece un bot», el sistema detectó respuestas automáticas de otro sistema (por ejemplo, el bot de otra empresa) y la IA dejó de contestarle; si es una persona, contéstale tú.
- La IA de WhatsApp responde con lo aprobado: catálogo, «Manual de ventas», «Conocimiento de producto», promociones vigentes, horario, entrega y el «Aviso para el asistente». Nunca da indicaciones clínicas. Transfiere a una persona cuando el cliente lo pide o es un asunto de pedido o reclamo.

## Clientes y cartera
- La cartera es de quién es cada cliente. Dura 6 meses desde la última atención o compra pagada; al vencer, el cliente vuelve al reparto («Por vencer» / «Plazos de cartera»).
- La ficha del cliente («Ver su ficha» o «Clientes») muestra datos, teléfonos, domicilios, vendedor, pedidos y cotizaciones.
- Los doctores deben verificarse (cédula e INE, revisión manual) para ver precios y comprar en el portal; «Por verificar» muestra los pendientes.

## Pedidos, cobro y entrega
- Un pedido nace en «Punto de venta», desde el chat («Levantar pedido») o en el portal del doctor. Folio tipo S1234.
- Cobro: transferencia, efectivo o link de tarjeta («Links de pago»: el vendedor pega el link de BanBajío y Dirección lo marca pagado). Los pagos reportados se validan en «Pagos por validar».
- Entrega: en Culiacán con chofer o recogiendo en sucursal; foráneo por paquetería (DHL). Montos de envío gratis, días y hora de corte están en «Configuración» → «Regla de entrega». Almacén prepara («Preparar pedidos»), genera la guía («Guías») y despacha («Despacho»); el chofer ve sus entregas en «Chofer / Seguimiento».
- Facturación (CFDI) en «Facturación»; la revisión de datos fiscales en «Revisión fiscal».

## Configuración (solo Dirección)
- «Configuración» → «Aviso para el asistente»: un aviso que la IA dice mientras dure (por ejemplo, sucursal en remodelación); manda sobre dirección y horario. Con fecha de fin opcional.
- «Configuración» → «Regla de entrega»: corte, fletes, montos de envío gratis, C.P. locales, días de chofer y paquetería, dónde se recoge.
- «Equipo» → «Cartera y horario»: horario de atención y reparto de conversaciones. «Equipo» → «Personas»: altas, roles y permisos del equipo.
- «Configuración» → «Bitácora»: quién hizo qué.
`
