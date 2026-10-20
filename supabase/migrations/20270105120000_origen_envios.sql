-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- ORIGEN DE ENVÍOS ESTRUCTURADO (migración 183) · T1-A: Dirección captura el domicilio desde donde salen los paquetes por
--   CAMPOS (calle, número exterior, número interior/local, colonia, referencias) además de los que ya existían (CP, ciudad,
--   estado, país, contacto). Lo usan DHL y T1 como remitente; es independiente del domicilio fiscal (direccion/ciudad/cp).
--   Compatibilidad: `shipping_address` NO se borra ni se reinterpreta. Mientras los campos nuevos estén vacíos, DHL sigue
--   usando `shipping_address` tal cual. Cuando calle y número exterior están capturados, un trigger ARMA `shipping_address`
--   = "Calle Número[ Interior]" (una sola verdad: lo que ve Configuración es lo que viaja a la paquetería) y rechaza si pasa
--   de 45 caracteres (límite de la línea 1 del remitente en DHL). T1 exige los campos estructurados; sin ellos no hay guía.
--   Permisos: los de siempre (lee personal autenticado, escribe Dirección: política company_settings_write).
--   Aditiva y sin datos: no se divide "Nuevo Mundo 1045-17" automáticamente; Dirección lo captura en Configuración.
--   Rollback: supabase/rollback/origen_envios/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.company_settings') is null then raise exception 'ORIGEN-ENVIOS: falta company_settings'; end if;
  if not exists (select 1 from information_schema.columns where table_name = 'company_settings' and column_name = 'shipping_address') then raise exception 'ORIGEN-ENVIOS: falta la 20260927 (shipping_*)'; end if;
  if exists (select 1 from information_schema.columns where table_name = 'company_settings' and column_name = 'shipping_street') then raise exception 'ORIGEN-ENVIOS: ya aplicada'; end if;
end $pre$;

alter table public.company_settings
  add column shipping_street      text,
  add column shipping_ext_number  text,
  add column shipping_int_number  text,
  add column shipping_colonia     text,
  add column shipping_references  text;
comment on column public.company_settings.shipping_address is 'Línea 1 del remitente para la paquetería. Si hay shipping_street + shipping_ext_number, la arma el trigger (máx. 45).';

-- Una sola verdad: con calle y número exterior capturados, la línea de dirección se arma aquí (y se valida su largo).
create function public._origen_envios_sync() returns trigger
  language plpgsql set search_path = public as
$$
declare v_calle text := nullif(btrim(coalesce(new.shipping_street, '')), ''); v_ext text := nullif(btrim(coalesce(new.shipping_ext_number, '')), ''); v_int text := nullif(btrim(coalesce(new.shipping_int_number, '')), ''); v_linea text;
begin
  new.shipping_street := v_calle; new.shipping_ext_number := v_ext; new.shipping_int_number := v_int;
  new.shipping_colonia := nullif(btrim(coalesce(new.shipping_colonia, '')), ''); new.shipping_references := nullif(btrim(coalesce(new.shipping_references, '')), '');
  if v_calle is not null and v_ext is null then raise exception 'ORIGEN_ENVIOS: captura el número exterior (o S/N) junto con la calle' using errcode = 'check_violation'; end if;
  if v_calle is null and v_ext is not null then raise exception 'ORIGEN_ENVIOS: captura la calle junto con el número exterior' using errcode = 'check_violation'; end if;
  if v_calle is not null then
    v_linea := v_calle || ' ' || v_ext || coalesce(' ' || v_int, '');
    if length(v_linea) > 45 then raise exception 'ORIGEN_ENVIOS: "%" tiene % caracteres; la paquetería acepta 45 en la línea de dirección. Abrevia la calle.', v_linea, length(v_linea) using errcode = 'check_violation'; end if;
    new.shipping_address := v_linea;
  end if;
  return new;
end;
$$;
create trigger trg_origen_envios_sync before insert or update on public.company_settings for each row execute function public._origen_envios_sync();

do $post$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_origen_envios_sync') then raise exception 'ORIGEN-ENVIOS: falta el trigger'; end if;
  if (select count(*) from public.company_settings) <> 1 then raise exception 'ORIGEN-ENVIOS: company_settings debe seguir siendo singleton'; end if;
end $post$;
