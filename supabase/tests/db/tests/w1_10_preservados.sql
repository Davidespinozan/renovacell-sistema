-- W1 · Componentes que DEBEN quedar sin cambios (md5 de pg_get_functiondef capturado antes de W1,
-- idéntico a producción: ver supabase/rollback/w1/00_prod_snapshot.sql).
begin;
do $t$
declare r record;
begin
  for r in select * from (values
    ('admin_approve_doctor(uuid,uuid,jsonb)',                 'ae578fcf8652206d6db0c611d7a4a5ef'),
    -- W6-A1 (autorizado): auth_role/has_cap/log_audit/profiles_guard fallan cerrado ante una
    -- cuenta suspendida. Sus hashes se re-anclan aquí; el resto sigue intacto.
    ('auth_role()',                                           '663618f6d4eedf568db532bca55cddc5'),
    ('confirmar_entrega(uuid,text,text)',                     '312b5ba18dac4f4a9419e1aaff4e80cb'),
    ('crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)', '408d0b2d90ae8431a3f4583988d11a32'),   -- re-anclado 20261031130000 (folio del servidor: texto W1 íntegro + folio único/servidor; payload +folio)
    ('finalize_shipment(uuid,jsonb)',                         'a1cf5c01877e87f41ee0e9635b478e34'),
    ('freeze_movement_cost()',                                'f1eb88ca3b5969cbd4d15a67754542ce'),
    ('handle_new_user()',                                     'd31936c0f165c984cd4cf28362d91a52'),
    ('has_cap(text)',                                         '1d95d08f28e6934aae23e69699302bc6'),
    ('ledger_append_only()',                                  '7563f161c00630c2725591c680a354f2'),
    ('log_audit()',                                           '7026276516a63fb54f0dd7287a927ecc'),
    ('log_audit(text,text,text,text)',                        'f4988217401e0bc29d27f459516292f7'),
    ('orders_estado_terminal()',                              '6c44978c08600b0ffd7777743757c359'),
    ('pay_order(uuid,text,text)',                             '3717294aa7b93a4322f5c378f6db9e38'),
    ('precio_de(uuid,uuid)',                                  'b256810a5e089355712bdeffcb423832'),
    -- CX-0A (autorizado): precio_de/3 recibe la barrera de autorización (mismo alcance que la RLS de product_prices);
    -- el cálculo no cambia. Hash re-anclado; el de producción previo (9efe1950…) lo restaura supabase/rollback/cx0.
    ('precio_de(uuid,uuid,integer)',                          '349176d8415cc46db01f1eaf887c9255'),
    -- CC-0A (autorizado): profiles_guard protege además la evidencia de verificación y la
    -- autoridad comercial en meta (META_PROTEGIDA). Hash re-anclado; el resto sigue intacto.
    ('profiles_guard()',                                      'e6267b13b03215e08fefce7fdb417024'),
    ('refunds_append_only()',                                 '5f2ede8dcfe36c334b67b03bea2c4821'),
    ('shipments_guard()',                                     '1e31cbc3ff2cd1e22e94d2e64584d617'),
    -- C360-F3 (autorizado): upsert_customer_fiscal queda como COMPATIBILIDAD sobre el perfil fiscal canónico
    -- predeterminado y pierde la autoridad de pos (solo Dirección, facturación y el doctor dueño). Hash re-anclado.
    ('upsert_customer_fiscal(uuid,jsonb)',                    'b6041b322c1b9657139591b28dcad316')
  ) as t(sig, h) loop
    perform tests.eq(md5(pg_get_functiondef(('public.' || r.sig)::regprocedure)), r.h, 'sin cambios: ' || r.sig);
  end loop;
  -- W2 · reemplazos AUTORIZADOS (la firma vieja desaparece → el frontend viejo falla cerrado).
  perform tests.ok(to_regprocedure('public.review_transfer_payment(uuid,text,text)') is null
                   and to_regprocedure('public.revisar_pago(uuid,uuid,text,numeric,date,text)') is not null,
                   'W2: review_transfer_payment → revisar_pago (reemplazo autorizado)');
  perform tests.ok(to_regprocedure('public.registrar_devolucion(uuid,text,numeric,text,text,jsonb)') is null
                   and to_regprocedure('public.autorizar_reembolso(uuid,uuid,text,numeric,text,uuid,text)') is not null,
                   'W2: registrar_devolucion → autorizar_reembolso (reemplazo autorizado)');
  perform tests.ok(to_regprocedure('public.pay_order(uuid,text,text)') is not null
                   and not has_function_privilege('authenticated', 'public.pay_order(uuid,text,text)', 'EXECUTE'),
                   'W2: pay_order sigue existiendo pero ya no es ejecutable por clientes');
  -- W2-C · RETIRO autorizado de la custodia legacy (D-W2-C-6): C4 la dejó inerte y C6 la
  -- eliminó. Ya no se preserva `event_sell`: mutaba un contador jsonb sin op_id, sin
  -- bitácora, sin inventario y sin dinero. Su reemplazo es el libro de custodia.
  perform tests.ok(to_regprocedure('public.event_sell(uuid,jsonb)') is null
                   and to_regclass('public.custody_lines') is not null,
                   'W2-C: event_sell → libro de custodia (retiro autorizado)');
  perform tests.ok(to_regclass('public.events') is null and to_regclass('public.consignment_stock') is null
                   and to_regclass('public.custodies') is not null,
                   'W2-C: events / consignment_stock → custodies (retiro autorizado)');
  -- W3-A · CAMBIO AUTORIZADO en set_order_fiscal_snapshot. Conserva su firma y su contrato
  -- (el frontend y el POS siguen llamándola igual) y se endurece en dos puntos: no toca un
  -- pedido cuya intención fiscal ya salió de `pendiente`, y mantiene sincronizado el receptor
  -- del documento fiscal vivo para que la huella material no quede desfasada.
  perform tests.eq(md5(pg_get_functiondef('public.set_order_fiscal_snapshot(uuid,jsonb)'::regprocedure)),
                   'd27eba9834466d71e5a3439614801bb7',
                   'W3-A: set_order_fiscal_snapshot endurecida (cambio autorizado, misma firma)');
  perform tests.ok(to_regprocedure('public.set_order_fiscal_snapshot(uuid,jsonb)') is not null
                   and has_function_privilege('authenticated', 'public.set_order_fiscal_snapshot(uuid,jsonb)', 'EXECUTE'),
                   'W3-A: set_order_fiscal_snapshot sigue existiendo y ejecutable por el cliente');
  -- Y lo que W3-A añade: la evidencia fiscal pasa a ser del servidor, con libro propio.
  perform tests.ok(to_regclass('public.fiscal_documents') is not null
                   and to_regclass('public.fiscal_document_events') is not null
                   and to_regprocedure('public.solicitar_cfdi(uuid,uuid,jsonb)') is not null,
                   'W3-A: la intención fiscal durable existe (fiscal_documents + solicitar_cfdi)');

  -- Comandos de W1 que NO se tocan (existencia + firma exacta).
  perform tests.ok((select count(*) = 9 from unnest(array[
      'public.recibir_lote(uuid,uuid,text,date,integer,uuid,text,numeric,text,text)',
      'public.importar_lote(uuid,text,text,text,integer)',
      'public.ajustar_lote(uuid,uuid,integer,text,text,uuid)',
      'public.confirmar_reingreso(uuid,uuid,jsonb)',
      'public.recibir_devolucion(uuid,uuid,jsonb,text)',
      'public.disponer_devolucion(uuid,jsonb)',
      'public.anular_guia_manual(uuid,uuid,text,text)',
      'public.conciliar_inventario()',
      'public.auditoria_bajas(timestamptz,timestamptz)']) sig
    where to_regprocedure(sig) is not null), 'W1: los 9 comandos preservados siguen con su firma exacta');

  -- Triggers existentes siguen presentes
  perform tests.ok(exists (select 1 from pg_trigger where tgname = 'trg_inventory_movements_append_only'), 'kardex sigue append-only');
  perform tests.ok(exists (select 1 from pg_trigger where tgname = 'trg_audit_logs_append_only'), 'audit_logs sigue append-only');
  perform tests.ok(exists (select 1 from pg_trigger where tgname = 'trg_freeze_movement_cost'), 'costo congelado por movimiento sigue');
  perform tests.ok(exists (select 1 from pg_trigger where tgname = 'trg_orders_estado_terminal'), 'estado terminal de pedidos sigue');
  perform tests.ok(exists (select 1 from pg_trigger where tgname = 'orders_audit_trigger'), 'auditoría de pedidos sigue');
end
$t$;
rollback;
