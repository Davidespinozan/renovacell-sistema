-- DHL D1 (190) · down: retira reconciliar_guia, las columnas de evidencia del intento y el tipo de operación.
-- OJO · pierde la evidencia de reconciliación guardada en shipping_attempts.request/reconciliacion (los estados de los
-- intentos y los envíos registrados se conservan). El registro append-only inventory_operations no se toca: si ya hay
-- filas 'reconciliacion_guia', la restricción anterior se vuelve a crear NOT VALID.
-- Ejecutar en UNA transacción:  psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
do $pre$ begin
  if to_regprocedure('public.reconciliar_guia(uuid,uuid,text,jsonb,text,text)') is null then raise exception 'DHL D1 down: no está aplicada'; end if;
end $pre$;

drop function public.reconciliar_guia(uuid, uuid, text, jsonb, text, text);

alter table public.shipping_attempts drop constraint if exists ck_shipping_attempts_reconciliacion;
alter table public.shipping_attempts
  drop column if exists request,
  drop column if exists reconciliacion,
  drop column if exists reconciled_by,
  drop column if exists reconciled_at;

do $k$
declare v_name text; v_hay boolean;
begin
  select conname into v_name from pg_constraint
   where conrelid = 'public.inventory_operations'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%recepcion%carga_inicial%';
  if v_name is not null then execute format('alter table public.inventory_operations drop constraint %I', v_name); end if;
  select exists (select 1 from public.inventory_operations where kind = 'reconciliacion_guia') into v_hay;
  if v_hay then
    alter table public.inventory_operations add constraint inventory_operations_kind_check check (kind in (
                 'recepcion','carga_inicial','cierre_compra','ajuste','surtido','venta_pos',
                 'cancelacion','reingreso_cancelacion','recepcion_devolucion',
                 'disposicion_devolucion','anulacion_guia',
                 'alta_compra')) not valid;
  else
    alter table public.inventory_operations add constraint inventory_operations_kind_check check (kind in (
                 'recepcion','carga_inicial','cierre_compra','ajuste','surtido','venta_pos',
                 'cancelacion','reingreso_cancelacion','recepcion_devolucion',
                 'disposicion_devolucion','anulacion_guia',
                 'alta_compra'));
  end if;
end $k$;

do $post$ begin
  if to_regprocedure('public.reconciliar_guia(uuid,uuid,text,jsonb,text,text)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shipping_attempts' and column_name in ('request', 'reconciliacion', 'reconciled_by', 'reconciled_at'))
     or exists (select 1 from pg_constraint where conrelid = 'public.inventory_operations'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%reconciliacion_guia%') then
    raise exception 'DHL D1 down: no quedó como antes de la 190';
  end if;
  if md5(pg_get_functiondef('public.finalize_shipment(uuid,jsonb)'::regprocedure)) <> 'a1cf5c01877e87f41ee0e9635b478e34'
     or md5(pg_get_functiondef('public.anular_guia(uuid,uuid,text)'::regprocedure)) <> '35015b5940b8848f001e18ce8d6e1356' then
    raise exception 'DHL D1 down: los comandos existentes cambiaron';
  end if;
end $post$;
