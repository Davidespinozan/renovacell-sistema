-- ALTA COMPLETA (23 nov 2026, dueño: «esto es información demasiado pobre… haz una auditoría»). El alta de un cliente
-- ahora captura todo lo que la ficha guarda. Faltaba un comando para la CÉDULA de un cliente SIN cuenta del portal (solo
-- el alta desde una conversación la guardaba, en customers.meta.cedula). Mismas reglas que el nombre (VENDEDOR-NOMBRE):
-- Dirección, o la vendedora ASIGNADA. La cédula de quien ya tiene portal la maneja él en su verificación.
-- Capturar la cédula NO verifica al cliente: verificar sigue siendo una decisión de una persona.
create or replace function public.cliente_cedula_guardar(p_customer uuid, p_cedula text)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare v_c uuid := public._c360_cliente(p_customer); a text; v_ced text := regexp_replace(coalesce(p_cedula, ''), '[^0-9]', '', 'g');
  v_profile uuid; v_otro text;
begin
  if v_c is null then raise exception 'CLIENTE_INEXISTENTE'; end if;
  a := public._c360_exige(v_c, array['direccion', 'vendedor']);
  if a = 'vendedor' and public._cc_vendedor_de_cliente(v_c) is distinct from auth.uid() then
    raise exception 'NO_AUTORIZADO: solo la vendedora asignada o Dirección registran la cédula' using errcode = 'insufficient_privilege'; end if;
  select profile_id into v_profile from public.customers where id = v_c;
  if v_profile is not null then
    raise exception 'CEDULA_DE_CUENTA: este cliente tiene cuenta del portal; su cédula la registra él en su verificación' using errcode = 'check_violation'; end if;
  if v_ced !~ '^[0-9]{7,8}$' then raise exception 'CEDULA_INVALIDA: la cédula profesional tiene 7 u 8 dígitos' using errcode = 'check_violation'; end if;
  select coalesce(initcap(lower(x.full_name)), 'otro cliente') into v_otro from public.customers x
   where x.id <> v_c and x.meta ->> 'cedula' = v_ced limit 1;
  if v_otro is null then
    select coalesce(p.full_name, 'una cuenta del portal') into v_otro from public.profiles p where p.meta ->> 'cedula' = v_ced limit 1;
  end if;
  if v_otro is not null then raise exception 'CEDULA_DUPLICADA: esa cédula ya es de «%»', v_otro using errcode = 'check_violation'; end if;
  update public.customers set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('cedula', v_ced), updated_at = now() where id = v_c;
  perform public._c360_evento(v_c, 'contacto_actualizado', jsonb_build_object('campos', jsonb_build_array('cedula')), a);
  return jsonb_build_object('customer_id', v_c, 'cedula', '••••' || right(v_ced, 3));
end;
$f$;
revoke all on function public.cliente_cedula_guardar(uuid, text) from public, anon;
grant execute on function public.cliente_cedula_guardar(uuid, text) to authenticated;
