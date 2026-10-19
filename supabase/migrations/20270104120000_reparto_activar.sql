-- REPARTO DE ASESORÍAS · ACTIVAR EN PRODUCCIÓN (migración 182, SOLO DATOS): enciende el reparto aleatorio (181) con el plazo
-- por defecto (5 min hábiles) y cartera fija al vendedor que toma la asesoría. Decisión del dueño (18 oct 2026). Dirección
-- puede ajustarlo después en Atención comercial → Horario y alertas. En el arnés de pruebas se omite (las pruebas lo
-- encienden explícitamente). Rollback: update public.cc_atencion_config set reparto_activo = false where id = 1.
do $m$ begin
  if not exists (select 1 from information_schema.columns where table_name = 'cc_atencion_config' and column_name = 'reparto_activo') then raise exception 'REPARTO-ACTIVAR: falta la 181'; end if;
  update public.cc_atencion_config set reparto_activo = true, updated_at = now() where id = 1;
  if not found then raise exception 'REPARTO-ACTIVAR: no existe la configuración de atención'; end if;
end $m$;
