-- TRAZABILIDAD COFEPRIS en consignación.
--
-- Problema que resuelve: el lote se descuenta del central al ASIGNAR al vendedor
-- (reference 'CONSIGNA-<correo>'), pero al VENDER al cliente final el renglón del
-- pedido se guardaba con lot_id nulo. Resultado: en un recall era imposible saber
-- qué lote recibió ese cliente — justo en un canal que toca al paciente sin pasar
-- por Almacén.
--
-- Solución: el saldo del vendedor deja de ser solo un número y guarda de QUÉ LOTES
-- se compone (`lots`: [{lot_id, qty}], en orden FEFO de asignación). Al vender se
-- toma de ahí y se estampa el lot_id en el renglón del pedido. No se vuelve a tocar
-- el stock (ya se descontó al asignar): esto solo registra el vínculo lote→cliente.
ALTER TABLE public.consignment_stock
  ADD COLUMN IF NOT EXISTS lots jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.consignment_stock.lots IS
  'Desglose por lote del saldo NO vendido: [{"lot_id":uuid,"qty":int}] en orden FEFO. Sostiene la trazabilidad lote→cliente en venta por consignación.';