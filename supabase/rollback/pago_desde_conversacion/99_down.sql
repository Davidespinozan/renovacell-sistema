-- PAGO-DESDE-CONVERSACIÓN (20270210) · down: se retiran la lectura y el comando. Las declaraciones ya creadas se quedan
-- (son pagos reportados como cualquier otro y Dirección los resuelve en "Pagos por validar").
drop function if exists public.cc_cliente_pedidos(uuid);
drop function if exists public.cc_reportar_pago_cliente(uuid, uuid, text, numeric, text, uuid, text);
drop function if exists public.cc_pago_comprobante_preparar(uuid, uuid);
drop function if exists public._cc_pago_ruta(uuid, uuid, text);
drop function if exists public._cc_pago_adjunto(uuid, uuid);
