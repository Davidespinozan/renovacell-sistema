-- FONDO DE CAJA en el arqueo (auditoría P2).
-- El cajón abre con un fondo de cambio (efectivo inicial). El esperado a contar es
-- fondo + ventas en efectivo; sin este campo el arqueo marcaba el fondo como "sobrante"
-- todos los días. Se guarda el fondo del corte para que el cuadre quede auditable.
alter table public.cash_closings add column if not exists fondo numeric not null default 0;
