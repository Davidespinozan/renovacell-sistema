-- R4-C10 · Completa los 7 BORRADORES del Manual de ventas con hechos del ERP (formas de pago registradas, cuentas activas,
-- listas General/Mayoreo, crédito por pedido con vencimiento, empaques en hielera, devoluciones/reembolsos del sistema,
-- catálogo por categoría y marca). Siguen siendo BORRADORES: la IA no los usa hasta que Dirección los apruebe.
-- Solo toca borradores (estado 'draft'); lo aprobado o retirado es inmutable (guardia de la base).
begin;
create temp table _r4c10 (tema text, titulo text, contenido text) on commit drop;
insert into _r4c10 values
('empresa', 'Quiénes somos',
 'Renovacell es una empresa de Culiacán, Sinaloa, dedicada a la medicina estética y regenerativa de grado médico. Vendemos exclusivamente a profesionales de la salud con cédula profesional verificada.' || E'\n' ||
 'Manejamos un catálogo amplio: toxinas botulínicas, rellenos e implantes, bioestimuladores, péptidos, vitaminas y minerales inyectables, metabólicos, anestésicos y aparatología como microagujas y dermapen.' || E'\n' ||
 'Lo que nos distingue: cuidamos la cadena de frío desde nuestro almacén hasta tu consultorio, entregamos el mismo día en Culiacán, enviamos a todo el país y te atiende un asesor que conoce tu historial de compra.'),
('verificacion', 'Verificación de cédula profesional',
 'Solo vendemos a profesionales de la salud. Al registrarte en el portal capturas tu cédula profesional y nuestro equipo la revisa manualmente en horario de atención. En cuanto se aprueba se habilitan precios, disponibilidad y compras en el portal.' || E'\n' ||
 'Por WhatsApp no pedimos fotos de documentos: la verificación se hace en el portal. Si ya compras con un asesor de Renovacell, él te puede seguir atendiendo mientras tanto.'),
('pagos', 'Formas de pago',
 'Aceptamos transferencia bancaria, efectivo y tarjeta en sucursal.' || E'\n' ||
 'Los datos bancarios para transferir te los comparte tu asesor junto con el resumen de tu pedido, para que el pago quede ligado a tu compra; por eso no los enviamos sueltos por este chat.' || E'\n' ||
 'Si pagas por transferencia, envíale tu comprobante a tu asesor para validar el pago y liberar tu pedido.'),
('envios', 'Cuidado del producto en el envío',
 'Los productos que lo requieren viajan en hielera para conservar la cadena de frío, en el tamaño adecuado según tu pedido.' || E'\n' ||
 'En Culiacán te lo lleva nuestro chofer; al resto del país va por paquetería y te compartimos el número de guía para que le des seguimiento.' || E'\n' ||
 'Al recibir, revisa tu paquete; si algo llega dañado, avísanos de inmediato por este chat con fotos.'),
('facturacion', 'Facturación',
 'Emitimos factura electrónica (CFDI 4.0).' || E'\n' ||
 'Pídela a tu asesor al hacer tu pedido y compártele tu constancia de situación fiscal (RFC, razón social, régimen fiscal, código postal y uso de CFDI). Así la factura sale con tus datos correctos.'),
('devoluciones', 'Devoluciones y garantías',
 'Si tu pedido llega dañado, incompleto o con un producto distinto, repórtalo por este chat lo antes posible, de preferencia el mismo día que lo recibes, con fotos del paquete y del producto. Un asesor lo revisa y te da solución: reposición o reembolso.' || E'\n' ||
 'Por tratarse de productos médicos que requieren cadena de frío, no aceptamos devoluciones de producto abierto, usado o que haya salido de su conservación.' || E'\n' ||
 'Si necesitas cancelar un pedido antes de que salga, avísale a tu asesor.'),
('politica_comercial', 'Mayoreo, crédito y descuentos',
 'Manejamos precios de mayoreo según el volumen de compra: tu asesor te confirma si tu pedido aplica y te prepara la cotización.' || E'\n' ||
 'El crédito lo autoriza Dirección caso por caso, con fecha de pago acordada.' || E'\n' ||
 'Para cotizaciones formales, descuentos o cualquier condición especial te comunicamos con un asesor del equipo comercial.');
update public.cc_company_knowledge c
   set contenido = r.contenido, rev = c.rev + 1, updated_at = now(), importado_de = 'R4-C10 borrador completo (datos del ERP)'
  from _r4c10 r
 where c.tema = r.tema and c.titulo = r.titulo and c.estado = 'draft' and c.contenido is distinct from r.contenido;
select jsonb_build_object('borradores', (select count(*) from public.cc_company_knowledge where estado = 'draft'),
  'pendientes_completar', (select count(*) from public.cc_company_knowledge where estado = 'draft' and contenido ilike '%[COMPLETAR%'),
  'claims_prohibidos', (select count(*) from public.cc_company_knowledge k, jsonb_array_elements(public.cc_revisar_claims(k.titulo || ' ' || k.contenido)) x where k.estado = 'draft' and x ->> 'tipo' = 'prohibido')) as manual;
commit;
