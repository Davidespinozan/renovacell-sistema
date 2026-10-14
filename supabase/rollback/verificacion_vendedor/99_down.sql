-- VERIFICACIÓN POR VENDEDOR · rollback de la migración 154. Aplicar en UNA transacción. Las verificaciones ya
-- aprobadas se conservan; solo se retira el mecanismo.
do $pre$ begin
  if to_regprocedure('public.doctor_verificar(uuid,boolean,text)') is null then raise exception 'VERIF-VENDEDOR rollback: la migración no está aplicada'; end if;
  if md5(pg_get_functiondef('public.cc_contacto_de(uuid)'::regprocedure)) <> '5d74821846ae2e08ac78c4aaa8165b80' then raise exception 'VERIF-VENDEDOR rollback: cc_contacto_de no es la de la 154'; end if;
end $pre$;
drop function public.doctor_verificacion_de_conversacion(uuid);
drop function public.doctor_verificar(uuid, boolean, text);
drop function public.doctor_verificacion_ver(uuid);
drop function public._puede_verificar(uuid);
CREATE OR REPLACE FUNCTION public.cc_contacto_de(p_conv uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- Datos de contacto que dejó quien escribe por el enlace. Solo Dirección o el asesor asignado a ESA conversación.
declare c record; r public.cc_prerregistros;
begin
  select id, visitor_id, profile_id, seller_profile_id into c from public.cc_conversations where id = p_conv;
  if not found or not (public.auth_role() = 'admin' or (c.seller_profile_id is not null and c.seller_profile_id = auth.uid() and public._cc_puede_atender(auth.uid()))) then
    raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege';
  end if;
  if c.visitor_id is null then return null; end if;
  select * into r from public.cc_prerregistros where visitor_id = c.visitor_id;
  if not found then return null; end if;
  return jsonb_build_object('nombre', r.nombre, 'telefono', r.telefono, 'email', r.email, 'es_medico', r.es_medico, 'cedula', r.cedula,
    'posible_cliente', (select cu.full_name from public.customers cu where cu.id = r.posible_customer_id),
    'confirmado', c.profile_id is not null, 'desde', r.created_at);
end;
$function$;
alter table public.customer_events drop constraint ck_ce_tipo;
alter table public.customer_events add constraint ck_ce_tipo check (tipo = any (array['contacto_actualizado', 'telefono_agregado', 'telefono_actualizado', 'telefono_principal', 'telefono_archivado', 'domicilio_agregado', 'domicilio_actualizado', 'domicilio_predeterminado', 'domicilio_archivado', 'domicilio_adoptado_alta', 'fiscal_agregado', 'fiscal_actualizado', 'fiscal_predeterminado', 'fiscal_archivado', 'nota_agregada', 'migracion', 'vendedor_asignado', 'cliente_baja', 'cliente_reactivado', 'invitacion_creada', 'cuenta_creada'])) not valid;
do $post$ begin
  if md5(pg_get_functiondef('public.cc_contacto_de(uuid)'::regprocedure)) <> 'd6bc94190c8a5205f95920bce5027243' then raise exception 'VERIF-VENDEDOR rollback: cc_contacto_de no volvió'; end if;
end $post$;
