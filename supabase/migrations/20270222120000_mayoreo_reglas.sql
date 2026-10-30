-- ============================================================================
-- MAYOREO-REGLAS (30 oct 2026) · reglas del dueño sobre el PEDIDO completo (no renglón por renglón):
--   1. Si un producto llega a su escalón de MAYOREO, TODO el pedido se cobra a mayoreo: cada producto a su mejor precio
--      por cantidad (el suyo propio; si solo tiene medio mayoreo, ese).
--   2. Los productos cuyo MEDIO MAYOREO empieza en 10 piezas se juntan: si entre todos suman 10 o más, cada uno se cobra a
--      su propio medio mayoreo (5 + 5). Juntar solo alcanza el medio mayoreo, nunca el mayoreo. Los de 5 no se juntan.
-- Cómo: cada escalón dice qué nivel es (product_volume_prices.nivel: 'medio' | 'mayoreo'); _qty_volumen calcula, con todo
-- el pedido, la cantidad que cuenta para el volumen de cada producto y precio_de/4 la usa SOLO para el escalón por
-- volumen (las promociones siguen contando las piezas reales). Todos los que cobran (pedido del portal y del chat, punto de
-- venta, cotización y carrito) pasan las líneas del pedido; el precio de un solo producto (IA) no cambia.
-- ============================================================================

-- ── 1 · Nivel de cada escalón ─────────────────────────────────────────────────────────────────────────
alter table public.product_volume_prices add column if not exists nivel text not null default 'medio';
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_pvp_nivel') then
    alter table public.product_volume_prices add constraint ck_pvp_nivel check (nivel in ('medio', 'mayoreo'));
  end if;
end $c$;
-- Mayoreo = la hoja «PRECIOS MAYOREO - OCTUBRE 2026» (incluye Botox 100 y Botaone que cargó el dueño, y los productos cuyo
-- único escalón es el de la hoja, como Revage R y Xélaju N) + el escalón más alto de todo producto con dos o más.
update public.product_volume_prices set nivel = 'mayoreo' where (product_id, min_quantity) in (values
    ('e2ce81ee-ebdb-4d29-8fbb-696c8b942d4e'::uuid, 10),
    ('3b8a1d0d-dc84-4d86-95ea-1ee0eb17636b'::uuid, 10),
    ('4e42ea74-ca5e-4042-bd9a-a7404a2bef3c'::uuid, 10),
    ('36c2e2fe-efc8-422a-b01b-f28e9ef35bcd'::uuid, 10),
    ('2d453484-2b65-41c0-b93f-49e1d0f25850'::uuid, 10),
    ('04d4360f-27be-4866-8982-4970123cc9bb'::uuid, 10),
    ('01f337ab-4cae-4516-a186-dc8d8284271f'::uuid, 10),
    ('58e5d59d-95f1-430f-a0e5-f42d81251c01'::uuid, 10),
    ('03b839c2-b094-40e6-85a5-b289e6b501cb'::uuid, 10),
    ('17a980dd-47bb-4f1d-8045-eda7dd6951cd'::uuid, 10),
    ('74c3b72e-f938-413e-8479-45e0075c2c26'::uuid, 10),
    ('60ed8e0b-634b-4260-9ee0-9c9b63e98987'::uuid, 10),
    ('df88b7f0-c12a-4bc3-9982-d58f323ed348'::uuid, 10),
    ('2688abc2-293a-474d-8646-23a1a5c9bc07'::uuid, 10),
    ('a3986e55-eeb1-426a-ab2b-9a295be3820f'::uuid, 10),
    ('4323f6b6-71b1-46a8-aa0c-39aaaa8553e4'::uuid, 10),
    ('ecf4b7e5-b63b-4f71-9126-e95a2876c206'::uuid, 10),
    ('76cc56cb-6567-4d53-8330-99ece52bef7d'::uuid, 10),
    ('b09dfd5d-31e0-44c8-946a-45f7e991280c'::uuid, 10),
    ('e1f9a301-ae40-4ea5-bc40-21c63394160e'::uuid, 10),
    ('f9b2695b-74cd-4a98-81ee-4321092c8d62'::uuid, 10),
    ('1c961bee-0345-4dbf-8d48-e5c9f7842a27'::uuid, 10),
    ('f08bc3f5-6456-4ca3-b3cf-6e68e4934e47'::uuid, 10),
    ('e2ece653-9734-4486-96cd-7c1ac126beb1'::uuid, 10),
    ('1b965a38-6512-488e-9d8b-716840cfa192'::uuid, 10),
    ('c66df1cf-a529-40a6-bad2-17aa56e19719'::uuid, 10),
    ('8663e890-ea63-42ea-aca2-e699c83b165a'::uuid, 10),
    ('b922370f-c4eb-415c-aa64-c49072edeacf'::uuid, 10),
    ('3f53991d-4070-46f0-b721-16988308b0d5'::uuid, 20),
    ('c816fa68-6269-437b-8947-482643cad516'::uuid, 20),
    ('9cf3e8cf-dc4f-473f-9055-603aac4ff595'::uuid, 20),
    ('f51b9f60-886f-4916-99e7-e85ead847bcb'::uuid, 20),
    ('6f9d3c3e-d57b-4e3f-ac57-63ae2002b953'::uuid, 20),
    ('ffdf4a85-6ce4-41a5-95d0-bac036806db4'::uuid, 20),
    ('37bb528b-e793-4e45-8a3b-e07a4f81c2d0'::uuid, 20),
    ('aba7f11b-1dd5-4e9c-b6a0-8fe23da38bdc'::uuid, 20),
    ('1109fa3b-405a-4c0d-97e2-a126d8d80542'::uuid, 20),
    ('4415b7be-c5a9-4b9e-bfda-9b399a7a1686'::uuid, 20),
    ('0eb73911-aac3-41f3-bcc1-715d9db13968'::uuid, 20),
    ('ec483bbe-2b4e-4da8-8355-d28d994df9c1'::uuid, 20),
    ('17fd4361-537d-4fb1-9f72-afaae86f62a0'::uuid, 20),
    ('2ffad776-1f74-45e4-ad85-18f85e0683df'::uuid, 20),
    ('9744ed0d-a4b1-44a9-81ee-b064362f6bc8'::uuid, 20),
    ('54ce127b-ce48-47a0-a4dd-022769375170'::uuid, 20),
    ('a1ae62d6-cc54-4739-b44c-7a9cf85874ff'::uuid, 20),
    ('69044226-b5c8-422f-9ad3-95f006384c77'::uuid, 20),
    ('efe74557-c485-4f16-8eff-eeafc9b16a6d'::uuid, 20),
    ('5e0acc26-1092-4bbe-a20b-93f6f09dd1fb'::uuid, 20),
    ('4d5df95c-c3a4-4f7f-a057-0bc238191da5'::uuid, 20),
    ('2cea1445-61eb-46fb-9363-203b79c6830d'::uuid, 20),
    ('7cc605b9-759e-4ba7-85fc-9bb4e8b9acc7'::uuid, 20),
    ('94700e24-e152-4350-b548-db8413fb8db3'::uuid, 20),
    ('66c7464c-e412-44f4-b3b6-dd3819acc92e'::uuid, 20),
    ('0207fef1-44da-49bd-b2ed-8312f4438966'::uuid, 20),
    ('04e06ca5-5b0f-4267-9af2-64068fa72365'::uuid, 20),
    ('b3337744-8597-4bf4-ad87-d8dfdf7d1274'::uuid, 20),
    ('41608051-5699-4642-b6c6-33ff9c1fee88'::uuid, 20),
    ('1cd85116-5c60-481c-b0cf-a3571108b9dc'::uuid, 20),
    ('796386c2-5878-4324-9f8e-9a3d0bc7ae58'::uuid, 20),
    ('166b81f0-4151-4605-8c85-04e97e48edf9'::uuid, 20),
    ('7b930a8c-2847-430e-a8b0-fa9591c4c549'::uuid, 20),
    ('a1a91e38-7a33-4ff3-9957-eeb08e758e39'::uuid, 20),
    ('76a9f366-f9bb-453c-b5e4-faa57953801d'::uuid, 20),
    ('6e953acf-1596-42e6-8571-35688400c612'::uuid, 20),
    ('6265b38d-30e5-4976-8e88-bce3ddd3c6dc'::uuid, 20),
    ('22e46646-c7f7-4a70-b1e6-2632795c05ca'::uuid, 20),
    ('f3fe9078-889d-4910-a43a-94239e162f6c'::uuid, 20),
    ('d9890a86-8fca-467c-9b8a-eb4545ca4823'::uuid, 20),
    ('ee561e0e-3fb2-439e-8637-4f8ffd0cd0b3'::uuid, 20),
    ('d2689b12-4586-43af-b1ab-c84d060d7070'::uuid, 20),
    ('18c1aa28-d233-4e91-b840-ed874b312b9a'::uuid, 20),
    ('4c723990-7a79-4b58-bc0b-91ff39cbec23'::uuid, 20),
    ('a894ed6b-6e33-4419-b62b-5dd00215e5df'::uuid, 20),
    ('3043a620-5274-44ed-ab25-a0d60b56d706'::uuid, 20),
    ('eae8a07e-4051-44c9-ac89-263bf941c635'::uuid, 20),
    ('faaa7f43-6784-4f30-bfd7-1fd7570489b9'::uuid, 20),
    ('86e85877-31be-405c-a31f-205aef1112dc'::uuid, 20),
    ('d5383ab3-e57d-403b-80f2-ca593367245c'::uuid, 20),
    ('37897db4-9fc0-4935-b18d-64e131c3f9dc'::uuid, 20),
    ('fc50e014-1a96-498f-b8d5-f6a172c7777d'::uuid, 20),
    ('547558e6-7955-4f5e-8246-cff4bdf3a7fb'::uuid, 20),
    ('e2cbb1c3-fd5f-4eb0-b544-91455d1a94a5'::uuid, 20),
    ('6416e3e3-f60e-4929-8c48-791bfe27ba40'::uuid, 20),
    ('8d1f067e-2309-4358-ac92-7ec7bd7ef535'::uuid, 20),
    ('1f6b0805-11b2-4695-802f-f8f4001f258b'::uuid, 20),
    ('9e0db293-38bc-4131-bbf6-8e789b8d0734'::uuid, 20),
    ('8e0cdfce-c90c-41c4-b33a-7ba245bdce58'::uuid, 20),
    ('3144dd17-2fc6-40d4-9962-6acac489c941'::uuid, 20),
    ('04d5e143-aa49-4257-ab69-db9a35fdfc82'::uuid, 20),
    ('36b12f02-704d-4c36-865f-b4a98d7133ce'::uuid, 20),
    ('c45bfac0-940d-4cb0-99d3-6957f3c774d7'::uuid, 20),
    ('57a14e21-92bf-4666-bbb5-badcbbc386b7'::uuid, 20),
    ('30adf787-c7d7-46cd-a7a4-3b1e4d90f938'::uuid, 20),
    ('7e338736-0ce2-4070-a1b0-92f8507c9101'::uuid, 20),
    ('de183c46-5240-4664-bba1-10576167bae3'::uuid, 20),
    ('a3fa587f-8d5f-405b-a7eb-33bfef03b8fe'::uuid, 20),
    ('eef9ee73-9bd3-47e0-846f-317bb83a299a'::uuid, 20),
    ('f99c03a1-a02e-48c1-acbb-65594a6cae6a'::uuid, 20),
    ('1bb9ca5f-4c87-447a-b177-121ee9a29103'::uuid, 20),
    ('3024a702-9dfb-4c00-937e-58d9ce96f261'::uuid, 20),
    ('e89185ff-3a08-4b67-952c-8325fee48c61'::uuid, 20),
    ('dd2eba06-f449-4764-b4cc-0c3273c86acf'::uuid, 20),
    ('b8be3e8f-f3b2-4254-9c37-2426a868c09f'::uuid, 20),
    ('b1b706cb-6994-4baf-ba57-e840148153a3'::uuid, 20),
    ('3794a6e8-84d8-45c6-89cd-f552902dcfa2'::uuid, 20),
    ('34541e8a-469d-4bb3-973e-408565a338f2'::uuid, 20),
    ('cc8704b9-44f4-403a-90ce-1e658960b9cd'::uuid, 20),
    ('c49654b3-517b-4976-8d82-1d685664e932'::uuid, 20),
    ('2eac6877-1a42-4f27-b49e-699a4b3c814a'::uuid, 20),
    ('e2102321-c25d-4bac-9677-8b589ef3d7eb'::uuid, 20),
    ('52518557-0343-45c1-b875-3b8795ea99d0'::uuid, 20),
    ('b7536cdf-d53e-48d7-b756-50a7be950e24'::uuid, 20),
    ('bbabaff6-17ad-4715-a567-a6bfa0d7b02a'::uuid, 20),
    ('9f6ba8cc-4904-4095-9182-a00136ceb1c0'::uuid, 20),
    ('69bd4cfd-fc39-49b1-8758-46689076140c'::uuid, 20),
    ('26286a27-ace6-4748-ae50-4b7be02a5ed3'::uuid, 20),
    ('562ded89-c089-4daa-9d0a-1609c4ef5d23'::uuid, 10),
    ('a2c6548c-a147-42e6-91bf-2ce5a6504d59'::uuid, 10),
    ('3a033bfd-b930-470a-adfc-66daa545dca7'::uuid, 10),
    ('5886daac-c49d-45ed-88ce-4f041087a951'::uuid, 50),
    ('5ae20ea5-a0f4-42ed-a0e4-2ecf4eff9b65'::uuid, 50),
    ('17a43a49-8740-4599-93e5-1e57d1ffe2ca'::uuid, 50),
    ('73ad079f-d986-4326-b7ee-c727611a880f'::uuid, 50),
    ('10425136-a7d9-4dd4-b0e3-96f555c5b281'::uuid, 50),
    ('38b60970-76d9-4fe0-8919-6e5c5536a0c1'::uuid, 50),
    ('75840f69-ad51-4ec3-9c3b-4cb55ceac6b8'::uuid, 10),
    ('5fc74cbf-167e-4e54-ac68-d430a915fb13'::uuid, 10),
    ('e845a3bb-5d42-467a-923a-0998752d47c3'::uuid, 20),
    ('e19f09e2-cae1-448f-8b1a-2b1f17d231ef'::uuid, 20),
    ('a42d3957-21a1-4510-80ee-8c169a26563a'::uuid, 20),
    ('f5e81e86-212e-4a40-ab08-868c2be840fd'::uuid, 20),
    ('c0110398-bab1-4636-9134-b02eb6a632b4'::uuid, 20),
    ('e1f342ee-d5a3-4dec-980c-9909ca0f7316'::uuid, 20),
    ('c610f58a-a406-4568-b652-70cf9cf09b19'::uuid, 20),
    ('90b59637-02a8-402e-afe0-d6100e72f9e0'::uuid, 10),
    ('feee98bb-6a30-4e6b-98f4-50bc38a93157'::uuid, 20),
    ('3bbc195a-e623-4330-89e5-60885e3022c7'::uuid, 50),
    ('79fc0c64-decd-4275-a836-2f6da3e59624'::uuid, 50),
    ('4be3454f-e044-464d-b8ae-a0280fd21598'::uuid, 10),
    ('12759c19-4649-49d7-a660-bfed483969ad'::uuid, 50),
    ('a729386b-bd45-4c65-a6e8-87337531507f'::uuid, 20),
    ('5903120c-62a4-46cb-ba9b-2073e52848c2'::uuid, 50),
    ('e1b65d0b-bb7a-4799-9326-3d85ed9bb1fa'::uuid, 20),
    ('56c24be2-fcdc-4fa5-8cde-e88e40238598'::uuid, 20),
    ('e0fa6b83-877a-445a-b142-b1f08b3734eb'::uuid, 50),
    ('d67db7b5-7686-4585-8080-d4460482e935'::uuid, 30),
    ('97a8cfc9-870d-4310-9876-dc0ca600bf15'::uuid, 20),
    ('1b500652-6c6f-478c-af54-203db86a9b3e'::uuid, 50),
    ('4e6ca313-75b8-41c6-aebe-9236dd758450'::uuid, 50),
    ('743d5d6d-ba92-4102-bcc3-171e961df997'::uuid, 50),
    ('5d06d155-da32-4494-9cc9-a4cefa654596'::uuid, 10),
    ('310abfad-054c-40af-a542-3a439bf47131'::uuid, 50),
    ('cf5d09a6-0193-4a83-b0d2-188603daad3e'::uuid, 50),
    ('48450218-8b33-47d4-acc8-ab7bedc0373c'::uuid, 50),
    ('81d8d807-4925-466c-bbc2-dbc921923532'::uuid, 50),
    ('866328fd-6c97-43a1-98a0-5a1fccfe7a91'::uuid, 10),
    ('f2986bca-5a58-4fff-a492-4ed4b074ee2e'::uuid, 10),
    ('1d5cc41b-bedf-4989-ab88-0df18b7ba245'::uuid, 50));
update public.product_volume_prices v set nivel = 'mayoreo'
 where v.active and exists (select 1 from public.product_volume_prices o where o.product_id = v.product_id and o.active and o.min_quantity < v.min_quantity)
   and not exists (select 1 from public.product_volume_prices o where o.product_id = v.product_id and o.active and o.min_quantity > v.min_quantity);

-- ── 2 · Cantidad que cuenta para el volumen, con TODO el pedido ───────────────────────────────────────
create or replace function public._qty_volumen(p_lines jsonb) returns jsonb
  language sql stable security definer set search_path = public as
$$
  with l as (
    select (x ->> 'product_id')::uuid pid, sum((x ->> 'qty')::int) q
      from jsonb_array_elements(case when jsonb_typeof(p_lines) = 'array' then p_lines else '[]'::jsonb end) x
     where nullif(x ->> 'product_id', '') is not null and (x ->> 'qty') ~ '^[0-9]+$'
     group by 1),
  t as (
    select l.pid, l.q,
           (select max(v.min_quantity) from public.product_volume_prices v where v.product_id = l.pid and v.active) t_max,
           (select min(v.min_quantity) from public.product_volume_prices v where v.product_id = l.pid and v.active and v.nivel = 'medio') t_medio,
           (select min(v.min_quantity) from public.product_volume_prices v where v.product_id = l.pid and v.active and v.nivel = 'mayoreo') t_mayoreo
      from l),
  r as (select coalesce(bool_or(q >= t_mayoreo), false) mayoreo, coalesce(sum(q) filter (where t_medio = 10), 0) junta10 from t)
  select coalesce(jsonb_object_agg(t.pid, greatest(t.q,
           case when r.mayoreo then coalesce(t.t_max, 0) else 0 end,                 -- regla 1
           case when t.t_medio = 10 and r.junta10 >= 10 then 10 else 0 end)), '{}'::jsonb)   -- regla 2
    from t, r;
$$;
create or replace function public._qty_volumen_carrito(p_cart uuid) returns jsonb
  language sql stable security definer set search_path = public as
$$ select public._qty_volumen((select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'qty', i.quantity)) from public.cc_cart_items i where i.cart_id = p_cart)); $$;

-- ── 3 · precio_de con la cantidad del volumen aparte ─────────────────────────────────────────────────
create or replace function public.precio_de(p_product uuid, p_list uuid, p_qty integer, p_qty_volumen integer)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_claim_rol text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_rol_sesion text := coalesce(current_setting('role', true), '');
  v_base numeric; v_vol numeric; v_promo numeric;
begin
  if not (v_claim_rol = 'service_role' or (v_claim_rol = '' and v_rol_sesion not in ('authenticated', 'anon'))) then
    if public.auth_role() = any (array['admin', 'billing', 'pos', 'warehouse', 'packing', 'comm']) then
      null;
    elsif public.puede_ver_precio()
          and (p_list is null or p_list = (select p.price_list_id from public.profiles p where p.id = auth.uid())) then
      null;
    else
      raise exception 'PRECIO_NO_AUTORIZADO: no tienes acceso a este precio' using errcode = 'insufficient_privilege';
    end if;
  end if;

  select coalesce(
           (select pp.price from public.product_prices pp where pp.product_id = p_product and pp.list_id = p_list),
           (select pr.price from public.products pr where pr.id = p_product))
    into v_base;
  -- MAYOREO-REGLAS · el escalón por volumen se busca con la cantidad que cuenta en el pedido (nunca menos que la real).
  select pv.price into v_vol from public.product_volume_prices pv
   where pv.product_id = p_product and pv.active and pv.min_quantity <= greatest(p_qty, coalesce(p_qty_volumen, p_qty))
   order by pv.min_quantity desc limit 1;
  -- PROMO-1 · la promoción vigente entra como un candidato más (con las piezas reales): nunca más que el precio normal.
  v_promo := public._promo_precio(p_product, p_list, p_qty);
  return (select min(x) from unnest(array[v_base, v_vol, v_promo]) x);
end;
$function$;

create or replace function public.precio_de(p_product uuid, p_list uuid, p_qty integer)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select public.precio_de(p_product, p_list, p_qty, p_qty); $function$;

-- ── 4 · Quienes cobran pasan el pedido completo (definiciones vigentes + la cantidad del volumen) ─────────
create or replace function public.crear_pedido(p_order_id uuid, p_folio text, p_doctor_id uuid, p_lines jsonb, p_shipping_meta jsonb DEFAULT NULL::jsonb, p_invoice_requested boolean DEFAULT false, p_customer_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ln jsonb; pid uuid; q int; up numeric; tot numeric := 0;
  list uuid; act boolean; out_items jsonb := '[]'::jsonb;
  v_cname text; v_cphone text; v_meta jsonb; v_folio text; v_intento int;
  v_cust uuid; v_cust_profile uuid;
  v_attr jsonb; v_placed text;
  v_vq jsonb := public._qty_volumen(p_lines);   -- MAYOREO-REGLAS · cantidad que cuenta para el volumen
begin
  if p_doctor_id is null and p_customer_id is null then
    raise exception 'FALTA_IDENTIDAD: el pedido requiere doctor_id o customer_id';
  end if;
  if not (
    (public.auth_role() = 'doctor' and p_doctor_id = auth.uid() and public.is_verified())
    or public.auth_role() = any (array['admin','pos'])
  ) then
    raise exception 'No autorizado';
  end if;
  -- CX-0b · CUENTA COMERCIAL del pedido, decidida en el servidor.
  --   Doctor (portal): SU cuenta, derivada de la identidad autenticada (_cc_chk_customer: customers.profile_id = auth.uid()
  --   y activa). p_customer_id solo se acepta si ES esa cuenta; cualquier otra (ajena, inexistente o inactiva) → el MISMO
  --   error genérico (no se puede sondear si una cuenta existe ni de quién es).
  --   ⇢ B2B-3 sustituye SOLO esta derivación por: cuenta seleccionada + membresía activa + permiso de compra.
  --   Personal (admin/pos): cualquier cuenta activa (facultad existente); si además hay comprador, la pareja debe ser
  --   coherente: la cuenta ligada a ese comprador, o una cuenta sin portal cuando el comprador no tiene cuenta ligada.
  if public.auth_role() = 'doctor' then
    v_cust := public._cc_chk_customer(auth.uid());
    if p_customer_id is not null and p_customer_id is distinct from v_cust then
      raise exception 'CUENTA_NO_AUTORIZADA: el pedido solo puede crearse para tu propia cuenta' using errcode = 'insufficient_privilege';
    end if;
    if v_cust is not null then
      select full_name, phone into v_cname, v_cphone from public.customers where id = v_cust;
    end if;
  else
    v_cust := p_customer_id;
    if v_cust is not null then
      select full_name, phone, profile_id into v_cname, v_cphone, v_cust_profile from public.customers where id = v_cust and active = true;
      if not found then raise exception 'CUSTOMER_INEXISTENTE: customer inexistente o inactivo'; end if;
      if p_doctor_id is not null
         and v_cust_profile is distinct from p_doctor_id
         and (v_cust_profile is not null or exists (select 1 from public.customers c where c.profile_id = p_doctor_id)) then
        raise exception 'PAR_INCONSISTENTE: el comprador y la cuenta comercial no corresponden';
      end if;
    end if;
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'El pedido no tiene renglones';
  end if;
  if exists (select 1 from public.orders where id = p_order_id) then
    return (select jsonb_build_object('order_id', o.id, 'total', o.total, 'folio', o.external_ref, 'idempotent', true)
            from public.orders o where o.id = p_order_id);
  end if;

  if p_doctor_id is not null then
    select price_list_id into list from public.profiles where id = p_doctor_id;
  end if;

  for ln in select * from jsonb_array_elements(p_lines) loop
    pid := nullif(ln ->> 'product_id','')::uuid;
    q   := (ln ->> 'qty')::int;
    if pid is null then raise exception 'Producto inválido'; end if;
    if q is null or q <= 0 then raise exception 'Cantidad inválida (debe ser > 0)'; end if;
    select active into act from public.products where id = pid;
    if not found then raise exception 'Producto % no existe', pid; end if;
    if act is not true then raise exception 'Producto % no está activo', pid; end if;
    up := public.precio_de(pid, list, q, coalesce((v_vq ->> pid::text)::int, q));   -- ← precio autorizado con CANTIDAD (volumen, reglas del pedido)
    if up is null then raise exception 'Producto % sin precio válido', pid; end if;
    tot := tot + up * q;
    out_items := out_items || jsonb_build_array(jsonb_build_object('product_id', pid, 'qty', q, 'unit_price', up));
  end loop;

  -- CX-0b · el snapshot del cliente lo escribe SOLO el servidor (el que venga del navegador se descarta).
  -- CX-0c · lo mismo la ATRIBUCIÓN: seller / seller_profile_id / seller_origen / placed_by del navegador se descartan.
  v_meta := p_shipping_meta - 'customer' - 'seller' - 'seller_profile_id' - 'seller_origen' - 'placed_by';
  if v_cust is not null then
    v_meta := jsonb_set(coalesce(v_meta, '{}'::jsonb), '{customer}', jsonb_build_object('id', v_cust, 'name', v_cname, 'phone', v_cphone), true);
  end if;
  -- CX-0c · D2: vendedor = cartera (el capturista NO es vendedor). Sin asignación válida o no resoluble → sin vendedor.
  v_attr := public._cx0c_atribucion(v_cust, p_doctor_id);
  v_meta := coalesce(v_meta, '{}'::jsonb) || case when v_attr ->> 'estado' = 'cartera'
      then jsonb_build_object('seller', v_attr ->> 'seller', 'seller_profile_id', v_attr ->> 'seller_profile_id', 'seller_origen', 'cartera')
      else jsonb_build_object('seller_origen', case when v_attr ->> 'estado' = 'no_resoluble' then 'no_resoluble' else 'sin_vendedor' end) end;
  -- CX-0c · D4/D5: capturista del SERVIDOR. «Checkout canónico (CC-6)» solo si el checkout canónico marcó ESTE pedido
  -- (app.cc_checkout_pedido = p_order_id, fijado por cc_checkout_confirmar justo antes y borrado justo después).
  if public.auth_role() = 'doctor' then
    v_placed := case when current_setting('app.cc_checkout_pedido', true) = p_order_id::text
                     then 'Checkout canónico (CC-6)' else 'Pedido directo del portal' end;
  elsif public.auth_role() = 'admin' then
    v_placed := 'Administración';
  else
    select coalesce(nullif(btrim(full_name), ''), 'Ventas') || ' (Ventas)' into v_placed from public.profiles where id = auth.uid();
  end if;
  v_meta := v_meta || jsonb_build_object('placed_by', coalesce(v_placed, 'Ventas'));

  -- FOLIO: el del cliente solo si viene y no existe; si no, el del servidor (único, no reciclable).
  -- Ante una colisión CONCURRENTE (dos clientes con el mismo folio, o la secuencia alcanzando un folio
  -- histórico), el índice único lo detecta y se reintenta con folio del servidor: nunca un duplicado,
  -- nunca un pedido perdido.
  v_folio := nullif(btrim(coalesce(p_folio, '')), '');
  if v_folio is null or exists (select 1 from public.orders where external_ref = v_folio) then v_folio := public.siguiente_folio(); end if;
  for v_intento in 1..5 loop
    begin
      insert into public.orders (id, external_ref, doctor_id, customer_id, total, currency, status, payment_method, payment_status, invoice_requested, shipping_meta)
      values (p_order_id, v_folio, p_doctor_id, v_cust, tot, 'MXN', 'pending_payment', 'contra_pedido', 'pending', coalesce(p_invoice_requested, false), v_meta);
      exit;
    exception when unique_violation then
      if v_intento = 5 then raise; end if;
      v_folio := public.siguiente_folio();
    end;
  end loop;

  insert into public.order_items (order_id, product_id, qty, unit_price)
  select p_order_id, (i->>'product_id')::uuid, (i->>'qty')::int, (i->>'unit_price')::numeric
  from jsonb_array_elements(out_items) i;

  return jsonb_build_object('order_id', p_order_id, 'folio', v_folio, 'total', tot, 'items', out_items);
end;
$function$;

create or replace function public.vender_pos(p_order_id uuid, p_folio text, p_total numeric, p_payment_method text, p_doctor_id uuid, p_shipping_meta jsonb, p_lines jsonb, p_allocations jsonb, p_invoice_requested boolean DEFAULT false, p_invoice_meta jsonb DEFAULT NULL::jsonb, p_customer_id uuid DEFAULT NULL::uuid, p_efectivo_recibido numeric DEFAULT NULL::numeric, p_custody_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_vq jsonb;   -- MAYOREO-REGLAS · cantidad que cuenta para el volumen (pedido completo)
  v_uid uuid := auth.uid();
  v_req jsonb; v_prev jsonb;
  a record; ln record; v_nlines int; qty int; pid uuid; up numeric; tot numeric := 0;
  v_items uuid[] := '{}'; v_item uuid; v_bad int;
  v_cname text; v_cphone text; v_meta jsonb; v_metodo text;
  v_cus record; v_falta record;
  v_cust_profile uuid;
  v_attr jsonb; v_cajero_email text;
  v_inv jsonb;
begin
  if not (public.auth_role() = any (array['admin','pos'])) then
    raise exception 'No autorizado';
  end if;
  v_req := jsonb_build_object('folio', p_folio, 'total', p_total, 'payment_method', p_payment_method,
             'doctor', p_doctor_id, 'shipping_meta', p_shipping_meta, 'lines', p_lines, 'allocations', p_allocations,
             'invoice_requested', p_invoice_requested, 'invoice_meta', p_invoice_meta, 'customer', p_customer_id,
             'custody', p_custody_id);
  v_prev := public._w1_op_begin(p_order_id, 'venta_pos', v_req);
  if v_prev is not null then return true; end if;  -- ya aplicada: éxito idempotente

  -- SEC-C4-FISCAL-2 · el receptor fiscal lo valida y lo normaliza el SERVIDOR, aquí: después de la idempotencia y ANTES
  -- de cualquier escritura (pedido, inventario, custodia, cobro). Se persiste solo {receiver:{6 campos}}; cualquier otra
  -- clave (status, uuid, fechas de timbrado…) se rechaza. Sin factura solicitada, lo recibido se ignora (v_inv NULL).
  -- La huella de idempotencia (v_req) sigue calculándose sobre la ENTRADA recibida: los reintentos no cambian.
  v_inv := public._fiscal_entrada_pos(p_invoice_requested, p_invoice_meta);

  if p_customer_id is not null then
    select full_name, phone, profile_id into v_cname, v_cphone, v_cust_profile from public.customers where id = p_customer_id and active = true;
    if not found then raise exception 'CUSTOMER_INEXISTENTE: customer inexistente o inactivo'; end if;
  end if;
  -- CX-0b · comprador opcional (NULL = mostrador / cuenta histórica sin portal). Si viene, debe ser un comprador real
  -- (perfil doctor) y la pareja con la cuenta debe ser coherente: la cuenta ligada a ese comprador, o una cuenta sin
  -- portal cuando el comprador no tiene cuenta ligada. Misma regla que crear_pedido (personal).
  --   ⇢ B2B-3: la coherencia pasa a ser membresía activa del comprador en la cuenta con permiso de compra.
  if p_doctor_id is not null then
    if not exists (select 1 from public.profiles where id = p_doctor_id and role_id = 'doctor') then
      raise exception 'COMPRADOR_INVALIDO: el comprador indicado no es válido';
    end if;
    if p_customer_id is not null
       and v_cust_profile is distinct from p_doctor_id
       and (v_cust_profile is not null or exists (select 1 from public.customers c where c.profile_id = p_doctor_id)) then
      raise exception 'PAR_INCONSISTENTE: el comprador y la cuenta comercial no corresponden';
    end if;
  end if;
  if exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'PEDIDO_EXISTENTE: el id % ya pertenece a otro pedido', p_order_id;
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'VENTA_SIN_RENGLONES';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'ASIGNACIONES_REQUERIDAS';
  end if;
  v_nlines := jsonb_array_length(p_lines);
  v_vq := public._qty_volumen(p_lines);
  v_metodo := case when p_payment_method in ('efectivo','tarjeta','transferencia','stripe') then p_payment_method else 'otro' end;

  for ln in select value as j, ordinality as n from jsonb_array_elements(p_lines) with ordinality loop
    pid := nullif(ln.j ->> 'product_id', '')::uuid; qty := (ln.j ->> 'qty')::int;
    if pid is null then raise exception 'Producto inválido'; end if;
    if qty is null or qty <= 0 then raise exception 'Cantidad inválida'; end if;
    up := public.precio_de(pid, null, qty, coalesce((v_vq ->> pid::text)::int, qty));
    if up is null then raise exception 'Producto % sin precio válido', pid; end if;
    tot := tot + up * qty;
  end loop;

  for a in
    select x.line_index, x.lot_id, x.qty, l.product_id as lot_product, l.expiry_date,
           nullif(p_lines -> x.line_index ->> 'product_id', '')::uuid as line_product
      from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int)
      left join public.lots l on l.id = x.lot_id
  loop
    if a.line_index is null or a.line_index < 0 or a.line_index >= v_nlines then
      raise exception 'ASIGNACION_INVALIDA: renglón % inexistente', a.line_index;
    end if;
    if a.qty is null or a.qty <= 0 then raise exception 'CANTIDAD_INVALIDA: cada asignación debe ser mayor a cero'; end if;
    if a.lot_product is null then raise exception 'LOTE_INEXISTENTE: %', a.lot_id; end if;
    if a.lot_product <> a.line_product then raise exception 'LOTE_DE_OTRO_PRODUCTO: el lote % no es del producto del renglón', a.lot_id; end if;
    if public.lote_caducado(a.expiry_date) then raise exception 'LOTE_CADUCADO: el lote % caducó el %', a.lot_id, a.expiry_date; end if;
  end loop;
  select count(*) into v_bad
    from generate_series(0, v_nlines - 1) g(i)
    left join (select x.line_index, sum(x.qty) s from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int)
                group by 1) s on s.line_index = g.i
   where coalesce(s.s, 0) <> (p_lines -> g.i ->> 'qty')::int;
  if v_bad > 0 then raise exception 'ASIGNACION_INCOMPLETA: % renglón(es) no cuadran con la cantidad vendida', v_bad; end if;

  -- W2-C · VENTA DESDE CUSTODIA. Todo lo anterior (precio del servidor, lote vigente,
  -- asignaciones completas) ya se validó igual que en mostrador; aquí solo se añade lo
  -- propio de la custodia. El cerrojo de la custodia serializa dos ventas simultáneas
  -- del mismo saldo.
  if p_custody_id is not null then
    select * into v_cus from public.custodies where id = p_custody_id for update;
    if not found then raise exception 'CUSTODIA_INEXISTENTE'; end if;
    if v_cus.status <> 'abierta' then raise exception 'CUSTODIA_CERRADA: esa custodia ya se cerró'; end if;
    -- SEC-C2b · comparación NULL-safe: con titular "tercero" (holder_user_id NULL) la igualdad daba NULL y CUALQUIER pos
    -- vendía de esa custodia. Vende Dirección o el titular-usuario; correo, teléfono, cartera, Odoo o customers.profile_id NO autorizan.
    if not (public.auth_role() = 'admin' or coalesce(v_cus.holder_user_id = v_uid, false)) then
      raise exception 'NO_AUTORIZADO: solo el tenedor de la custodia (o Dirección) vende de ella';
    end if;
    -- Cada lote asignado tiene que estar EN PODER de esa custodia, y alcanzar.
    -- Se agrega por lote: una venta puede partir un renglón en dos lotes y dos
    -- renglones pueden tocar el mismo lote.
    select x.lot_id, sum(x.qty)::int as pedido, public.custody_held_en(p_custody_id, x.lot_id) as en_poder
      into v_falta
      from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int)
     group by x.lot_id
    having sum(x.qty) > public.custody_held_en(p_custody_id, x.lot_id)
     limit 1;
    if found then
      raise exception 'CUSTODIA_SALDO_INSUFICIENTE: del lote % tienes % y la venta pide %',
        v_falta.lot_id, v_falta.en_poder, v_falta.pedido;
    end if;
  end if;

  if p_efectivo_recibido is not null and v_metodo = 'efectivo' and p_efectivo_recibido < tot then
    raise exception 'EFECTIVO_INSUFICIENTE: recibido % para un total de %', p_efectivo_recibido, tot;
  end if;

  -- CX-0b · el snapshot del cliente lo escribe SOLO el servidor (el que venga del navegador se descarta).
  -- CX-0c · la atribución también: el seller que mande la caja se ignora; placed_by no aplica en mostrador.
  v_meta := p_shipping_meta - 'customer' - 'seller' - 'seller_profile_id' - 'seller_origen' - 'placed_by';
  -- CX-0c · D3: 1) vendedor de cartera válido; 2) sin asignación → cajero AUTENTICADO; 3) no resoluble → sin vendedor
  -- (nunca se usa al cajero para encubrir una relación comercial incierta). Mostrador sin cuenta ni comprador → cajero.
  if p_customer_id is null and p_doctor_id is null then
    v_attr := jsonb_build_object('estado', 'sin_asignacion');
  else
    v_attr := public._cx0c_atribucion(p_customer_id, p_doctor_id);
  end if;
  select email into v_cajero_email from public.profiles where id = v_uid;
  v_meta := coalesce(v_meta, '{}'::jsonb) || case v_attr ->> 'estado'
      when 'cartera' then jsonb_build_object('seller', v_attr ->> 'seller', 'seller_profile_id', v_attr ->> 'seller_profile_id', 'seller_origen', 'cartera')
      when 'sin_asignacion' then jsonb_build_object('seller', v_cajero_email, 'seller_profile_id', v_uid, 'seller_origen', 'pos_cajero')
      else jsonb_build_object('seller_origen', 'no_resoluble') end;
  if p_customer_id is not null then
    v_meta := jsonb_set(coalesce(v_meta, '{}'::jsonb), '{customer}', jsonb_build_object('id', p_customer_id, 'name', v_cname, 'phone', v_cphone), true);
  end if;

  -- El POS cobra al momento: payment_status='paid' queda respaldado por el asiento de abajo.
  insert into public.orders (id, external_ref, doctor_id, customer_id, total, currency, status, payment_method, payment_status, invoice_requested, invoice_meta, shipping_meta)
  values (p_order_id, p_folio, p_doctor_id, p_customer_id, tot, 'MXN', 'delivered', p_payment_method, 'paid', coalesce(p_invoice_requested, false), v_inv, v_meta);

  for ln in select value as j, ordinality as n from jsonb_array_elements(p_lines) with ordinality loop
    pid := (ln.j ->> 'product_id')::uuid; qty := (ln.j ->> 'qty')::int;
    insert into public.order_items (order_id, product_id, lot_id, qty, unit_price)
    values (p_order_id, pid,
            (select (e.j ->> 'lot_id')::uuid from jsonb_array_elements(p_allocations) with ordinality as e(j, k)
              where (e.j ->> 'line_index')::int = ln.n - 1 order by e.k limit 1),
            qty, public.precio_de(pid, null, qty, coalesce((v_vq ->> pid::text)::int, qty)))
    returning id into v_item;
    v_items := v_items || v_item;
  end loop;

  perform 1 from public.lots
   where id in (select x.lot_id from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int))
   order by id for update;

  -- W2-C: el libro de custodia se escribe ANTES del descuento. Así `custody_held` ya
  -- refleja que esas unidades dejaron de estar en poder del tenedor y el descuento de
  -- abajo usa EXACTAMENTE la misma condición que una venta de mostrador: una sola
  -- semántica de disponibilidad, sin excepciones ni banderas.
  if p_custody_id is not null then
    insert into public.custody_lines (id, custody_id, kind, product_id, lot_id, qty, held_delta,
                                      unit_price, order_id, order_item_id, actor, actor_role, op_id)
    select gen_random_uuid(), p_custody_id, 'venta', l.product_id, x.lot_id, x.qty, -x.qty,
           public.precio_de(l.product_id, null, (p_lines -> x.line_index ->> 'qty')::int, coalesce((v_vq ->> l.product_id::text)::int, (p_lines -> x.line_index ->> 'qty')::int)),
           p_order_id, v_items[x.line_index + 1], v_uid, coalesce(public.auth_role(), ''), p_order_id
      from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int)
      join public.lots l on l.id = x.lot_id;
  end if;

  for a in select x.line_index, x.lot_id, x.qty from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int) loop
    -- W2-C · W2-X1: se descuenta contra la DISPONIBILIDAD (propio − en custodia).
    update public.lots set quantity = quantity - a.qty
     where id = a.lot_id and quantity - a.qty >= public.custody_held(a.lot_id);
    if not found then
      if exists (select 1 from public.lots l where l.id = a.lot_id and l.quantity >= a.qty) then
        raise exception 'CUSTODIA_EN_PODER: el lote % tiene % unidades en custodia; disponibles %',
          a.lot_id, public.custody_held(a.lot_id),
          (select l.quantity - public.custody_held(l.id) from public.lots l where l.id = a.lot_id);
      end if;
      raise exception 'Inventario insuficiente en el lote %', a.lot_id;
    end if;
    insert into public.inventory_movements (lot_id, change, reason, reference, created_by, op_id, order_id, order_item_id)
    values (a.lot_id, -a.qty, 'venta', p_folio, v_uid, p_order_id, p_order_id, v_items[a.line_index + 1]);
  end loop;

  -- W2 · F-1: el cobro de mostrador nace como ASIENTO en el libro, en esta misma
  -- transacción. El efectivo recibido queda como evidencia para el corte de caja.
  perform public._w2_asiento(gen_random_uuid(), p_order_id, 'in', v_metodo, tot, public.hoy_local(),
    null, null, null, null,
    case when v_metodo = 'efectivo' and p_efectivo_recibido is not null
         then format('recibido=%s;cambio=%s', p_efectivo_recibido, p_efectivo_recibido - tot) end);

  perform public._w1_op_finish(p_order_id, 'venta_pos', v_req,
    jsonb_build_object('status', 'applied', 'order_id', p_order_id, 'total', tot));
  return true;
end;
$function$;

create or replace function public.cc_cotizacion_crear(p_customer uuid, p_lineas jsonb, p_notas text DEFAULT NULL::text, p_conversation uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cu record; v_list uuid; l jsonb; pr record; q int; up numeric; v_lineas jsonb := '[]'::jsonb; v_sub numeric := 0; v_id uuid; r public.cotizaciones; v_vq jsonb;
begin
  perform public._cot_exige(p_customer);
  select id, profile_id, active into cu from public.customers where id = p_customer;
  if not cu.active then raise exception 'CLIENTE_INACTIVO' using errcode = 'check_violation'; end if;
  if p_conversation is not null and not (public._cc_puede_ver_conv(p_conversation)
       and exists (select 1 from public.cc_conversations c where c.id = p_conversation and (c.customer_id = p_customer or (c.profile_id is not null and c.profile_id = cu.profile_id)))) then
    raise exception 'CONVERSACION_AJENA: la conversación no es de este cliente' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 or jsonb_array_length(p_lineas) > 60 then raise exception 'LINEAS_INVALIDAS' using errcode = 'check_violation'; end if;
  v_list := (select p.price_list_id from public.profiles p where p.id = cu.profile_id);
  v_vq := public._qty_volumen(p_lineas);   -- MAYOREO-REGLAS
  for l in select * from jsonb_array_elements(p_lineas) loop
    q := (l ->> 'qty')::int;
    if q is null or q < 1 or q > 999 then raise exception 'LINEAS_INVALIDAS: cantidad' using errcode = 'check_violation'; end if;
    select id, name, sku, price, active, sellable into pr from public.products where id = (l ->> 'product_id')::uuid;
    if not found or not coalesce(pr.active, false) or pr.sellable is false or pr.price is null then raise exception 'PRODUCTO_NO_DISPONIBLE: %', coalesce(pr.name, l ->> 'product_id') using errcode = 'check_violation'; end if;
    up := public.precio_de(pr.id, v_list, q, coalesce((v_vq ->> pr.id::text)::int, q));
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('product_id', pr.id, 'nombre', pr.name, 'sku', pr.sku, 'qty', q, 'unit_price', up, 'precio_lista', pr.price, 'subtotal', round(up * q, 2)));
    v_sub := v_sub + round(up * q, 2);
  end loop;
  insert into public.cotizaciones (customer_id, conversation_id, seller_profile_id, vigente_hasta, lineas, subtotal, total, notas, created_by)
  values (p_customer, p_conversation, coalesce(public._cc_vendedor_de_cliente(p_customer), case when public.auth_role() = 'pos' then auth.uid() end),
          now() + interval '7 days', v_lineas, v_sub, v_sub, nullif(btrim(coalesce(p_notas, '')), ''), auth.uid())
  returning * into r;
  return to_jsonb(r);
end;
$function$;

create or replace function public._cc_precio_vol(p_profile uuid, p_product uuid, p_qty integer, p_qty_vol integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ctx jsonb; v_list uuid; v_qty int := least(greatest(coalesce(p_qty, 1), 1), 999); v_unit numeric; v_base numeric; prod record; v_normal numeric; v_promo jsonb; v_promo_unit numeric;
begin
  ctx := public.cc_ia_contexto_actor(p_profile);
  if not (ctx ->> 'puede_precio')::boolean then
    return jsonb_build_object('autorizado', false, 'motivo', 'PRICE_REQUIRES_VERIFICATION');
  end if;
  select p.id, p.name, p.sellable into prod from public.products p where p.id = p_product and p.active and (p.show_portal or p.show_landing);
  if prod.id is null then return jsonb_build_object('autorizado', false, 'motivo', 'PRODUCTO_NO_DISPONIBLE'); end if;
  if not prod.sellable then return jsonb_build_object('autorizado', false, 'motivo', 'PRODUCTO_NO_VENDIBLE', 'nombre', prod.name); end if;
  select price_list_id into v_list from public.profiles where id = p_profile;
  v_unit := public.precio_de(p_product, v_list, v_qty, greatest(v_qty, coalesce(p_qty_vol, v_qty)));
  v_base := public.precio_de(p_product, v_list, 1);
  if v_unit is null then return jsonb_build_object('autorizado', false, 'motivo', 'SIN_PRECIO', 'nombre', prod.name); end if;
  select coalesce((select pp.price from public.product_prices pp where pp.product_id = p_product and pp.list_id = v_list), (select pr.price from public.products pr where pr.id = p_product)) into v_normal;
  v_promo := public._promo_info(p_product, v_list);
  v_promo_unit := public._promo_precio(p_product, v_list, v_qty);
  return jsonb_build_object('autorizado', true, 'product_id', prod.id, 'nombre', prod.name, 'cantidad', v_qty, 'precio_unitario', v_unit, 'total', round(v_unit * v_qty, 2), 'moneda', 'MXN',
    'por_volumen', v_unit < v_base,
    'lista', (select l.name from public.price_lists l where l.id = v_list),
    'escalas', (select coalesce(jsonb_agg(jsonb_build_object('desde', pv.min_quantity, 'precio', pv.price) order by pv.min_quantity), '[]'::jsonb) from public.product_volume_prices pv where pv.product_id = p_product and pv.active),
    'precio_normal', v_normal,
    'en_promocion', v_promo is not null and v_promo_unit is not null and v_unit = v_promo_unit and v_unit < coalesce(v_normal, v_unit + 1),
    'promocion', v_promo);
end;
$function$;

create or replace function public.cc_ia_precio(p_profile uuid, p_product uuid, p_qty integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select public._cc_precio_vol(p_profile, p_product, p_qty, null); $function$;

create or replace function public._cc_chk_lineas(p_cart uuid, p_profile uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare v_vq jsonb := public._qty_volumen_carrito(p_cart); it record; pr jsonb; disp jsonb; lineas jsonb := '[]'::jsonb; problemas jsonb := '[]'::jsonb; total numeric := 0; huella text := ''; n int := 0;
begin
  for it in select i.product_id, i.quantity, p.name, p.active, p.sellable, p.show_portal, p.show_landing
              from public.cc_cart_items i join public.products p on p.id = i.product_id where i.cart_id = p_cart order by i.product_id loop
    n := n + 1;
    if not it.active or not it.sellable or not (it.show_portal or it.show_landing) then problemas := problemas || jsonb_build_object('product_id', it.product_id, 'problema', 'NO_VENDIBLE'); continue; end if;
    if it.quantity < 1 or it.quantity > 999 then problemas := problemas || jsonb_build_object('product_id', it.product_id, 'problema', 'CANTIDAD_INVALIDA'); continue; end if;
    pr := public._cc_precio_vol(p_profile, it.product_id, it.quantity, (v_vq ->> it.product_id::text)::int);
    if not coalesce((pr ->> 'autorizado')::boolean, false) then problemas := problemas || jsonb_build_object('product_id', it.product_id, 'problema', coalesce(pr ->> 'motivo', 'SIN_PRECIO')); continue; end if;
    disp := public.cc_ia_disponibilidad(p_profile, it.product_id);
    if coalesce(disp ->> 'estado', '') <> 'disponible' then problemas := problemas || jsonb_build_object('product_id', it.product_id, 'problema', 'SIN_DISPONIBILIDAD'); end if;   -- D-CC6-04: bloquea todo
    lineas := lineas || jsonb_build_object('product_id', it.product_id, 'qty', it.quantity, 'nombre', it.name, 'precio_unitario', (pr ->> 'precio_unitario')::numeric, 'subtotal', (pr ->> 'total')::numeric);
    total := total + (pr ->> 'total')::numeric;
    huella := huella || it.product_id::text || ':' || it.quantity || ':' || (pr ->> 'precio_unitario') || ';';
  end loop;
  if n = 0 then problemas := problemas || '"CARRITO_VACIO"'::jsonb; end if;
  return jsonb_build_object('ok', jsonb_array_length(problemas) = 0, 'lineas', lineas, 'total', round(total, 2), 'fingerprint', md5(huella), 'problemas', problemas, 'n_items', n);
end;
$function$;

create or replace function public.cc_carrito_proyeccion(p_cart uuid, p_lector uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_vq jsonb := public._qty_volumen_carrito(p_cart); c record; ctx jsonb; aud text; it record; items jsonb := '[]'::jsonb; pr jsonb; disp jsonb; total numeric := 0; completo boolean := true; n int := 0; q int := 0; visible boolean; precio jsonb;
begin
  select * into c from public.cc_carts where id = p_cart;
  if not found then return null; end if;
  ctx := public.cc_ia_contexto_actor(p_lector);
  aud := ctx ->> 'audiencia';
  for it in select i.product_id, i.quantity, p.name, p.odoo_reference, p.image_url, p.active, p.sellable, p.show_landing, p.show_portal
              from public.cc_cart_items i join public.products p on p.id = i.product_id where i.cart_id = p_cart order by i.created_at loop
    n := n + 1; q := q + it.quantity;
    visible := it.active and (case when aud = 'public' then it.show_landing else (it.show_portal or it.show_landing) end);
    if (ctx ->> 'puede_precio')::boolean then
      pr := public._cc_precio_vol(p_lector, it.product_id, it.quantity, (v_vq ->> it.product_id::text)::int);
      if (pr ->> 'autorizado')::boolean then
        precio := jsonb_build_object('estado', 'autorizado', 'unitario', (pr ->> 'precio_unitario')::numeric, 'subtotal', (pr ->> 'total')::numeric, 'por_volumen', (pr ->> 'por_volumen')::boolean, 'moneda', 'MXN');
        total := total + (pr ->> 'total')::numeric;
      else
        precio := jsonb_build_object('estado', 'sin_precio', 'motivo', pr ->> 'motivo'); completo := false;
      end if;
    else
      precio := jsonb_build_object('estado', 'requiere_verificacion'); completo := false;
    end if;
    if (ctx ->> 'puede_stock')::boolean then
      disp := public.cc_ia_disponibilidad(p_lector, it.product_id);
    else
      disp := jsonb_build_object('estado', 'requiere_verificacion');
    end if;
    items := items || jsonb_build_object('product_id', it.product_id, 'nombre', it.name, 'presentacion', it.odoo_reference, 'imagen_url', it.image_url, 'cantidad', it.quantity,
                                         'vendible', it.active and it.sellable, 'visible', visible,
                                         'disponibilidad', case when not (it.active and it.sellable) then 'no_vendible' else coalesce(disp ->> 'estado', disp ->> 'motivo', 'desconocida') end,
                                         'precio', precio);
  end loop;
  return jsonb_build_object('cart_id', c.id, 'estado', c.estado, 'rev', c.rev, 'dueno', case when c.profile_id is not null then 'profile' else 'visitor' end,
    'audiencia', aud, 'puede_precio', (ctx ->> 'puede_precio')::boolean, 'conversation_id', c.conversation_id,
    'items', items, 'n_items', n, 'cantidad_total', q,
    'total', case when n = 0 then jsonb_build_object('estado', 'vacio') when not (ctx ->> 'puede_precio')::boolean then jsonb_build_object('estado', 'requiere_verificacion')
                  when completo then jsonb_build_object('estado', 'completo', 'monto', round(total, 2), 'moneda', 'MXN') else jsonb_build_object('estado', 'parcial', 'moneda', 'MXN') end,
    'oferta_asesor', jsonb_build_object('estado', c.oferta_estado, 'siguiente_at', c.oferta_siguiente_at),
    'handoff', jsonb_build_object('estado', c.handoff_estado, 'at', c.handoff_at),
    'last_activity_at', c.last_activity_at);
end;
$function$;

-- ── 5 · Permisos ─────────────────────────────────────────────────────────────────────────────────────
alter function public._qty_volumen(jsonb) owner to postgres;
alter function public._qty_volumen_carrito(uuid) owner to postgres;
alter function public.precio_de(uuid, uuid, integer, integer) owner to postgres;
alter function public._cc_precio_vol(uuid, uuid, integer, integer) owner to postgres;
revoke all on function public._qty_volumen(jsonb), public._qty_volumen_carrito(uuid), public._cc_precio_vol(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public._qty_volumen(jsonb), public._qty_volumen_carrito(uuid), public._cc_precio_vol(uuid, uuid, integer, integer) to service_role;
revoke all on function public.precio_de(uuid, uuid, integer, integer) from public, anon;
grant execute on function public.precio_de(uuid, uuid, integer, integer) to authenticated, service_role;
