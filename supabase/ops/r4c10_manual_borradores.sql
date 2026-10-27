-- R4-C10 · BORRADORES INICIALES del Manual de ventas (cc_company_knowledge). Solo BORRADORES: la IA no los usa hasta que
-- Dirección los revise y apruebe en Catálogo → Manual de ventas. Lo que solo sabe el dueño va marcado [COMPLETAR: …] y la
-- pantalla no deja aprobarlo hasta completarlo. Idempotente: no inserta un (tema, título) que ya exista en cualquier estado.
-- Los datos que ya salen del ERP (dirección, horario, teléfono, costos y tiempos de envío) NO se repiten aquí.
begin;
insert into public.cc_company_knowledge (tema, titulo, contenido, version, audiencia, importado_de)
select b.tema, b.titulo, b.contenido, 1, 'public', 'R4-C10 borrador inicial'
  from (values
  ('empresa', 'Quiénes somos',
   'Renovacell es una empresa de Culiacán, Sinaloa, especializada en medicina regenerativa y estética de grado médico. Vendemos exclusivamente a profesionales de la salud con cédula profesional verificada.' || E'\n' ||
   'Lo que nos distingue: [COMPLETAR: por qué comprarle a Renovacell y no a otro distribuidor (origen y autenticidad del producto, marcas que representan, atención, años en el mercado).]'),
  ('como_comprar', 'Cómo comprar',
   'Para comprar hay dos caminos:' || E'\n' ||
   '1) Por este WhatsApp: dinos qué producto, presentación y cuántas piezas necesitas, y un asesor de Renovacell toma tu pedido y te acompaña hasta la entrega.' || E'\n' ||
   '2) En nuestro portal para profesionales: te registras, verificamos tu cédula y desde ahí ves precios, disponibilidad, armas tu carrito y eliges recoger o envío.' || E'\n' ||
   'Si ya compras con una vendedora de Renovacell, ella te sigue atendiendo.'),
  ('verificacion', 'Verificación de cédula profesional',
   'Solo vendemos a profesionales de la salud. Al registrarte en el portal capturas tu cédula profesional y nuestro equipo la revisa manualmente. Al aprobarse se habilitan precios, disponibilidad y compras en el portal.' || E'\n' ||
   'Tiempo de revisión: [COMPLETAR: en cuánto tiempo se verifica normalmente y qué pasa si falta algún dato.]' || E'\n' ||
   'Por WhatsApp no pedimos fotos de documentos: todo se hace en el portal.'),
  ('pagos', 'Formas de pago',
   '[COMPLETAR: formas de pago aceptadas (transferencia, tarjeta, efectivo en sucursal, liga de pago), si hay meses sin intereses, y si la IA puede compartir los datos bancarios o solo el asesor.]'),
  ('envios', 'Cuidado del producto en el envío',
   'Los costos, días y tiempos de entrega los toma el sistema directamente del ERP.' || E'\n' ||
   '[COMPLETAR: cómo se empaca y se protege el producto (cadena de frío si aplica), qué paquetería se usa, cómo se entrega la guía de rastreo.]'),
  ('facturacion', 'Facturación',
   'Emitimos factura electrónica (CFDI).' || E'\n' ||
   'Para facturar necesitamos: RFC, razón social, régimen fiscal, código postal fiscal y uso de CFDI (idealmente tu constancia de situación fiscal).' || E'\n' ||
   '[COMPLETAR: cómo se pide la factura (al comprar o después), en cuánto tiempo se entrega y hasta cuándo se puede pedir.]'),
  ('devoluciones', 'Devoluciones y garantías',
   '[COMPLETAR: qué se acepta (producto dañado, error de surtido), en qué plazo hay que reportarlo, cómo se tramita y qué no se acepta (producto abierto, cadena de frío rota).]' || E'\n' ||
   'Cualquier reclamación la atiende directamente un asesor de Renovacell.'),
  ('politica_comercial', 'Mayoreo, crédito y descuentos',
   'Las condiciones especiales (mayoreo, crédito, cotizaciones formales y descuentos) las define y autoriza el equipo comercial de Renovacell caso por caso: la IA no las negocia, pasa la conversación a un asesor.' || E'\n' ||
   '[COMPLETAR: reglas generales que sí se pueden decir (por ejemplo desde cuántas piezas hay precio de mayoreo, a quién se le da crédito).]'),
  ('atencion', 'Cómo te atendemos',
   'Te atiende primero el asistente virtual de Renovacell, que resuelve dudas de productos, compras, envíos y la empresa. Cuando quieres comprar, negociar o necesitas a una persona, te pasamos con un asesor del equipo comercial por este mismo chat.' || E'\n' ||
   'Si escribes fuera del horario de atención, tu mensaje queda registrado y el asesor te contesta en cuanto el equipo esté disponible.')
  ) as b(tema, titulo, contenido)
 where not exists (select 1 from public.cc_company_knowledge c where c.tema = b.tema and c.titulo = b.titulo);
select jsonb_build_object('borradores', (select count(*) from public.cc_company_knowledge where estado = 'draft'),
  'pendientes_completar', (select count(*) from public.cc_company_knowledge where estado = 'draft' and contenido ilike '%[COMPLETAR%'),
  'aprobados', (select count(*) from public.cc_company_knowledge where estado = 'approved')) as manual;
commit;
