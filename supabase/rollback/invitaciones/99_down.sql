-- INVITACIONES · rollback de la migración 153. Aplicar en UNA transacción. Las cuentas ya creadas por invitación se
-- conservan (ligadas y verificadas): solo se retira el mecanismo.
do $pre$ begin
  if to_regclass('public.cliente_invitaciones') is null then raise exception 'INVITACIONES rollback: la migración no está aplicada'; end if;
end $pre$;
drop function public.cliente_invitacion_aceptar(text, uuid);
drop function public.cliente_invitacion_ver(text);
drop function public.cliente_invitacion_crear(uuid);
drop table public.cliente_invitaciones;
alter table public.customer_events drop constraint ck_ce_tipo;
alter table public.customer_events add constraint ck_ce_tipo check (tipo = any (array['contacto_actualizado', 'telefono_agregado', 'telefono_actualizado', 'telefono_principal', 'telefono_archivado', 'domicilio_agregado', 'domicilio_actualizado', 'domicilio_predeterminado', 'domicilio_archivado', 'domicilio_adoptado_alta', 'fiscal_agregado', 'fiscal_actualizado', 'fiscal_predeterminado', 'fiscal_archivado', 'nota_agregada', 'migracion', 'vendedor_asignado', 'cliente_baja', 'cliente_reactivado'])) not valid;
