-- ============================================================================
-- MAYOREO · segundo escalón de precio por volumen (hoja «PRECIOS MAYOREO - OCTUBRE 2026»).
-- Regla del dueño: el escalón que ya existe en product_volume_prices es MEDIO MAYOREO y no se toca;
-- esta hoja es el MAYOREO: un segundo escalón (cantidad mínima → precio) por producto y por cada
-- variante (Hidrolizados, Implantes, Ultrafiltrados, ELITE). Botox 100 y Botaone ya los cargó el dueño.
-- Fuera de esta carga (unidad distinta o sin producto): Cánulas FMC, Liporase e Íntimo (la hoja
-- cotiza por caja, el sistema vende por pieza), Nabota 150 y Lafhalix (no están en el catálogo),
-- Linurase (su medio mayoreo ya empieza en 10 piezas, igual que el mayoreo de la hoja).
-- Idempotente. Solo inserta/ajusta escalones nuevos; guardas abortan ante cualquier discrepancia.
-- ============================================================================
do $mig$
declare n int;
begin
  create temp table _my(product_id uuid, min_quantity int, price numeric, discount_percent numeric) on commit drop;
  insert into _my(product_id, min_quantity, price, discount_percent) values
    ('e2ce81ee-ebdb-4d29-8fbb-696c8b942d4e'::uuid, 10, 18000.0, 28.0),
    ('3b8a1d0d-dc84-4d86-95ea-1ee0eb17636b'::uuid, 10, 18000.0, 28.0),
    ('4e42ea74-ca5e-4042-bd9a-a7404a2bef3c'::uuid, 10, 18000.0, 28.0),
    ('36c2e2fe-efc8-422a-b01b-f28e9ef35bcd'::uuid, 10, 18000.0, 28.0),
    ('2d453484-2b65-41c0-b93f-49e1d0f25850'::uuid, 10, 18000.0, 28.0),
    ('04d4360f-27be-4866-8982-4970123cc9bb'::uuid, 10, 18000.0, 28.0),
    ('01f337ab-4cae-4516-a186-dc8d8284271f'::uuid, 10, 18000.0, 28.0),
    ('58e5d59d-95f1-430f-a0e5-f42d81251c01'::uuid, 10, 9000.0, 40.0),
    ('03b839c2-b094-40e6-85a5-b289e6b501cb'::uuid, 10, 9000.0, 40.0),
    ('17a980dd-47bb-4f1d-8045-eda7dd6951cd'::uuid, 10, 9000.0, 40.0),
    ('74c3b72e-f938-413e-8479-45e0075c2c26'::uuid, 10, 9000.0, 40.0),
    ('60ed8e0b-634b-4260-9ee0-9c9b63e98987'::uuid, 10, 9000.0, 40.0),
    ('df88b7f0-c12a-4bc3-9982-d58f323ed348'::uuid, 10, 9000.0, 40.0),
    ('2688abc2-293a-474d-8646-23a1a5c9bc07'::uuid, 10, 9000.0, 40.0),
    ('a3986e55-eeb1-426a-ab2b-9a295be3820f'::uuid, 10, 9000.0, 40.0),
    ('4323f6b6-71b1-46a8-aa0c-39aaaa8553e4'::uuid, 10, 9000.0, 40.0),
    ('ecf4b7e5-b63b-4f71-9126-e95a2876c206'::uuid, 10, 9000.0, 40.0),
    ('76cc56cb-6567-4d53-8330-99ece52bef7d'::uuid, 10, 9000.0, 40.0),
    ('b09dfd5d-31e0-44c8-946a-45f7e991280c'::uuid, 10, 9000.0, 40.0),
    ('e1f9a301-ae40-4ea5-bc40-21c63394160e'::uuid, 10, 9000.0, 40.0),
    ('f9b2695b-74cd-4a98-81ee-4321092c8d62'::uuid, 10, 9000.0, 40.0),
    ('1c961bee-0345-4dbf-8d48-e5c9f7842a27'::uuid, 10, 9000.0, 40.0),
    ('f08bc3f5-6456-4ca3-b3cf-6e68e4934e47'::uuid, 10, 9000.0, 40.0),
    ('e2ece653-9734-4486-96cd-7c1ac126beb1'::uuid, 10, 9000.0, 40.0),
    ('1b965a38-6512-488e-9d8b-716840cfa192'::uuid, 10, 9000.0, 40.0),
    ('c66df1cf-a529-40a6-bad2-17aa56e19719'::uuid, 10, 9000.0, 40.0),
    ('8663e890-ea63-42ea-aca2-e699c83b165a'::uuid, 10, 9000.0, 40.0),
    ('b922370f-c4eb-415c-aa64-c49072edeacf'::uuid, 10, 9000.0, 40.0),
    ('3f53991d-4070-46f0-b721-16988308b0d5'::uuid, 20, 1800.0, 25.0),
    ('c816fa68-6269-437b-8947-482643cad516'::uuid, 20, 1800.0, 25.0),
    ('9cf3e8cf-dc4f-473f-9055-603aac4ff595'::uuid, 20, 1800.0, 25.0),
    ('f51b9f60-886f-4916-99e7-e85ead847bcb'::uuid, 20, 1800.0, 25.0),
    ('6f9d3c3e-d57b-4e3f-ac57-63ae2002b953'::uuid, 20, 1800.0, 25.0),
    ('ffdf4a85-6ce4-41a5-95d0-bac036806db4'::uuid, 20, 1800.0, 25.0),
    ('37bb528b-e793-4e45-8a3b-e07a4f81c2d0'::uuid, 20, 1800.0, 25.0),
    ('aba7f11b-1dd5-4e9c-b6a0-8fe23da38bdc'::uuid, 20, 1800.0, 25.0),
    ('1109fa3b-405a-4c0d-97e2-a126d8d80542'::uuid, 20, 1800.0, 25.0),
    ('4415b7be-c5a9-4b9e-bfda-9b399a7a1686'::uuid, 20, 1800.0, 25.0),
    ('0eb73911-aac3-41f3-bcc1-715d9db13968'::uuid, 20, 1800.0, 25.0),
    ('ec483bbe-2b4e-4da8-8355-d28d994df9c1'::uuid, 20, 1800.0, 25.0),
    ('17fd4361-537d-4fb1-9f72-afaae86f62a0'::uuid, 20, 1800.0, 25.0),
    ('2ffad776-1f74-45e4-ad85-18f85e0683df'::uuid, 20, 1800.0, 25.0),
    ('9744ed0d-a4b1-44a9-81ee-b064362f6bc8'::uuid, 20, 1800.0, 25.0),
    ('54ce127b-ce48-47a0-a4dd-022769375170'::uuid, 20, 1800.0, 25.0),
    ('a1ae62d6-cc54-4739-b44c-7a9cf85874ff'::uuid, 20, 1800.0, 25.0),
    ('69044226-b5c8-422f-9ad3-95f006384c77'::uuid, 20, 1800.0, 25.0),
    ('efe74557-c485-4f16-8eff-eeafc9b16a6d'::uuid, 20, 1800.0, 25.0),
    ('5e0acc26-1092-4bbe-a20b-93f6f09dd1fb'::uuid, 20, 1800.0, 25.0),
    ('4d5df95c-c3a4-4f7f-a057-0bc238191da5'::uuid, 20, 1800.0, 25.0),
    ('2cea1445-61eb-46fb-9363-203b79c6830d'::uuid, 20, 1800.0, 25.0),
    ('7cc605b9-759e-4ba7-85fc-9bb4e8b9acc7'::uuid, 20, 1800.0, 25.0),
    ('94700e24-e152-4350-b548-db8413fb8db3'::uuid, 20, 1800.0, 25.0),
    ('66c7464c-e412-44f4-b3b6-dd3819acc92e'::uuid, 20, 1800.0, 25.0),
    ('0207fef1-44da-49bd-b2ed-8312f4438966'::uuid, 20, 1800.0, 25.0),
    ('04e06ca5-5b0f-4267-9af2-64068fa72365'::uuid, 20, 1800.0, 25.0),
    ('b3337744-8597-4bf4-ad87-d8dfdf7d1274'::uuid, 20, 1800.0, 25.0),
    ('41608051-5699-4642-b6c6-33ff9c1fee88'::uuid, 20, 1800.0, 25.0),
    ('1cd85116-5c60-481c-b0cf-a3571108b9dc'::uuid, 20, 1800.0, 25.0),
    ('796386c2-5878-4324-9f8e-9a3d0bc7ae58'::uuid, 20, 1800.0, 25.0),
    ('166b81f0-4151-4605-8c85-04e97e48edf9'::uuid, 20, 1800.0, 25.0),
    ('7b930a8c-2847-430e-a8b0-fa9591c4c549'::uuid, 20, 1800.0, 25.0),
    ('a1a91e38-7a33-4ff3-9957-eeb08e758e39'::uuid, 20, 1800.0, 25.0),
    ('76a9f366-f9bb-453c-b5e4-faa57953801d'::uuid, 20, 1800.0, 25.0),
    ('6e953acf-1596-42e6-8571-35688400c612'::uuid, 20, 1800.0, 25.0),
    ('6265b38d-30e5-4976-8e88-bce3ddd3c6dc'::uuid, 20, 1800.0, 25.0),
    ('22e46646-c7f7-4a70-b1e6-2632795c05ca'::uuid, 20, 1800.0, 25.0),
    ('f3fe9078-889d-4910-a43a-94239e162f6c'::uuid, 20, 1800.0, 25.0),
    ('d9890a86-8fca-467c-9b8a-eb4545ca4823'::uuid, 20, 1800.0, 25.0),
    ('ee561e0e-3fb2-439e-8637-4f8ffd0cd0b3'::uuid, 20, 1800.0, 25.0),
    ('d2689b12-4586-43af-b1ab-c84d060d7070'::uuid, 20, 750.0, 25.0),
    ('18c1aa28-d233-4e91-b840-ed874b312b9a'::uuid, 20, 750.0, 25.0),
    ('4c723990-7a79-4b58-bc0b-91ff39cbec23'::uuid, 20, 750.0, 25.0),
    ('a894ed6b-6e33-4419-b62b-5dd00215e5df'::uuid, 20, 750.0, 25.0),
    ('3043a620-5274-44ed-ab25-a0d60b56d706'::uuid, 20, 750.0, 25.0),
    ('eae8a07e-4051-44c9-ac89-263bf941c635'::uuid, 20, 750.0, 25.0),
    ('faaa7f43-6784-4f30-bfd7-1fd7570489b9'::uuid, 20, 750.0, 25.0),
    ('86e85877-31be-405c-a31f-205aef1112dc'::uuid, 20, 750.0, 25.0),
    ('d5383ab3-e57d-403b-80f2-ca593367245c'::uuid, 20, 750.0, 25.0),
    ('37897db4-9fc0-4935-b18d-64e131c3f9dc'::uuid, 20, 750.0, 25.0),
    ('fc50e014-1a96-498f-b8d5-f6a172c7777d'::uuid, 20, 750.0, 25.0),
    ('547558e6-7955-4f5e-8246-cff4bdf3a7fb'::uuid, 20, 750.0, 25.0),
    ('e2cbb1c3-fd5f-4eb0-b544-91455d1a94a5'::uuid, 20, 750.0, 25.0),
    ('6416e3e3-f60e-4929-8c48-791bfe27ba40'::uuid, 20, 750.0, 25.0),
    ('8d1f067e-2309-4358-ac92-7ec7bd7ef535'::uuid, 20, 750.0, 25.0),
    ('1f6b0805-11b2-4695-802f-f8f4001f258b'::uuid, 20, 750.0, 25.0),
    ('9e0db293-38bc-4131-bbf6-8e789b8d0734'::uuid, 20, 750.0, 25.0),
    ('8e0cdfce-c90c-41c4-b33a-7ba245bdce58'::uuid, 20, 750.0, 25.0),
    ('3144dd17-2fc6-40d4-9962-6acac489c941'::uuid, 20, 750.0, 25.0),
    ('04d5e143-aa49-4257-ab69-db9a35fdfc82'::uuid, 20, 750.0, 25.0),
    ('36b12f02-704d-4c36-865f-b4a98d7133ce'::uuid, 20, 750.0, 25.0),
    ('c45bfac0-940d-4cb0-99d3-6957f3c774d7'::uuid, 20, 750.0, 25.0),
    ('57a14e21-92bf-4666-bbb5-badcbbc386b7'::uuid, 20, 750.0, 25.0),
    ('30adf787-c7d7-46cd-a7a4-3b1e4d90f938'::uuid, 20, 750.0, 25.0),
    ('7e338736-0ce2-4070-a1b0-92f8507c9101'::uuid, 20, 750.0, 25.0),
    ('de183c46-5240-4664-bba1-10576167bae3'::uuid, 20, 750.0, 25.0),
    ('a3fa587f-8d5f-405b-a7eb-33bfef03b8fe'::uuid, 20, 750.0, 25.0),
    ('eef9ee73-9bd3-47e0-846f-317bb83a299a'::uuid, 20, 750.0, 25.0),
    ('f99c03a1-a02e-48c1-acbb-65594a6cae6a'::uuid, 20, 750.0, 25.0),
    ('1bb9ca5f-4c87-447a-b177-121ee9a29103'::uuid, 20, 750.0, 25.0),
    ('3024a702-9dfb-4c00-937e-58d9ce96f261'::uuid, 20, 750.0, 25.0),
    ('e89185ff-3a08-4b67-952c-8325fee48c61'::uuid, 20, 750.0, 25.0),
    ('dd2eba06-f449-4764-b4cc-0c3273c86acf'::uuid, 20, 750.0, 25.0),
    ('b8be3e8f-f3b2-4254-9c37-2426a868c09f'::uuid, 20, 750.0, 25.0),
    ('b1b706cb-6994-4baf-ba57-e840148153a3'::uuid, 20, 750.0, 25.0),
    ('3794a6e8-84d8-45c6-89cd-f552902dcfa2'::uuid, 20, 750.0, 25.0),
    ('34541e8a-469d-4bb3-973e-408565a338f2'::uuid, 20, 750.0, 25.0),
    ('cc8704b9-44f4-403a-90ce-1e658960b9cd'::uuid, 20, 750.0, 25.0),
    ('c49654b3-517b-4976-8d82-1d685664e932'::uuid, 20, 750.0, 25.0),
    ('2eac6877-1a42-4f27-b49e-699a4b3c814a'::uuid, 20, 750.0, 25.0),
    ('e2102321-c25d-4bac-9677-8b589ef3d7eb'::uuid, 20, 750.0, 25.0),
    ('52518557-0343-45c1-b875-3b8795ea99d0'::uuid, 20, 750.0, 25.0),
    ('b7536cdf-d53e-48d7-b756-50a7be950e24'::uuid, 20, 750.0, 25.0),
    ('bbabaff6-17ad-4715-a567-a6bfa0d7b02a'::uuid, 20, 750.0, 25.0),
    ('9f6ba8cc-4904-4095-9182-a00136ceb1c0'::uuid, 20, 750.0, 25.0),
    ('69bd4cfd-fc39-49b1-8758-46689076140c'::uuid, 20, 750.0, 25.0),
    ('26286a27-ace6-4748-ae50-4b7be02a5ed3'::uuid, 20, 750.0, 25.0),
    ('562ded89-c089-4daa-9d0a-1609c4ef5d23'::uuid, 10, 5600.0, 6.67),
    ('a2c6548c-a147-42e6-91bf-2ce5a6504d59'::uuid, 10, 5600.0, 6.67),
    ('3a033bfd-b930-470a-adfc-66daa545dca7'::uuid, 10, 3100.0, 11.43),
    ('5886daac-c49d-45ed-88ce-4f041087a951'::uuid, 50, 1100.0, 35.29),
    ('5ae20ea5-a0f4-42ed-a0e4-2ecf4eff9b65'::uuid, 50, 800.0, 38.46),
    ('17a43a49-8740-4599-93e5-1e57d1ffe2ca'::uuid, 50, 750.0, 42.31),
    ('73ad079f-d986-4326-b7ee-c727611a880f'::uuid, 50, 400.0, 50.0),
    ('10425136-a7d9-4dd4-b0e3-96f555c5b281'::uuid, 50, 550.0, 38.89),
    ('38b60970-76d9-4fe0-8919-6e5c5536a0c1'::uuid, 50, 800.0, 50.0),
    ('75840f69-ad51-4ec3-9c3b-4cb55ceac6b8'::uuid, 10, 7000.0, 12.5),
    ('5fc74cbf-167e-4e54-ac68-d430a915fb13'::uuid, 10, 3500.0, 22.22),
    ('e845a3bb-5d42-467a-923a-0998752d47c3'::uuid, 20, 1500.0, 25.0),
    ('e19f09e2-cae1-448f-8b1a-2b1f17d231ef'::uuid, 20, 1250.0, 16.67),
    ('a42d3957-21a1-4510-80ee-8c169a26563a'::uuid, 20, 1600.0, 38.46),
    ('f5e81e86-212e-4a40-ab08-868c2be840fd'::uuid, 20, 450.0, 55.0),
    ('c0110398-bab1-4636-9134-b02eb6a632b4'::uuid, 20, 1250.0, 37.5),
    ('e1f342ee-d5a3-4dec-980c-9909ca0f7316'::uuid, 20, 1200.0, 40.0),
    ('c610f58a-a406-4568-b652-70cf9cf09b19'::uuid, 20, 1350.0, 32.5),
    ('90b59637-02a8-402e-afe0-d6100e72f9e0'::uuid, 10, 3700.0, 15.91),
    ('feee98bb-6a30-4e6b-98f4-50bc38a93157'::uuid, 20, 1700.0, 29.17),
    ('3bbc195a-e623-4330-89e5-60885e3022c7'::uuid, 50, 200.0, 42.86),
    ('79fc0c64-decd-4275-a836-2f6da3e59624'::uuid, 50, 240.0, 31.43),
    ('4be3454f-e044-464d-b8ae-a0280fd21598'::uuid, 10, 1300.0, 23.53),
    ('12759c19-4649-49d7-a660-bfed483969ad'::uuid, 50, 600.0, 22.78),
    ('a729386b-bd45-4c65-a6e8-87337531507f'::uuid, 20, 549.0, 10.0),
    ('5903120c-62a4-46cb-ba9b-2073e52848c2'::uuid, 50, 800.0, 38.46),
    ('e1b65d0b-bb7a-4799-9326-3d85ed9bb1fa'::uuid, 20, 400.0, 20.0),
    ('56c24be2-fcdc-4fa5-8cde-e88e40238598'::uuid, 20, 360.0, 20.0),
    ('e0fa6b83-877a-445a-b142-b1f08b3734eb'::uuid, 50, 300.0, 40.0),
    ('d67db7b5-7686-4585-8080-d4460482e935'::uuid, 30, 220.0, 26.67),
    ('97a8cfc9-870d-4310-9876-dc0ca600bf15'::uuid, 20, 200.0, 31.03),
    ('1b500652-6c6f-478c-af54-203db86a9b3e'::uuid, 50, 190.0, 24.0),
    ('4e6ca313-75b8-41c6-aebe-9236dd758450'::uuid, 50, 500.0, 33.33),
    ('743d5d6d-ba92-4102-bcc3-171e961df997'::uuid, 50, 485.0, 30.71),
    ('5d06d155-da32-4494-9cc9-a4cefa654596'::uuid, 10, 1400.0, 22.22),
    ('310abfad-054c-40af-a542-3a439bf47131'::uuid, 50, 110.0, 15.38),
    ('cf5d09a6-0193-4a83-b0d2-188603daad3e'::uuid, 50, 30.0, 40.0),
    ('48450218-8b33-47d4-acc8-ab7bedc0373c'::uuid, 50, 30.0, 40.0),
    ('81d8d807-4925-466c-bbc2-dbc921923532'::uuid, 50, 30.0, 40.0),
    ('866328fd-6c97-43a1-98a0-5a1fccfe7a91'::uuid, 10, 3800.0, 15.56);

  select count(*) into n from _my;
  if n <> 156 then raise exception 'MAYOREO: se esperaban 156 escalones, hay %', n; end if;
  select count(*) into n from _my m left join public.products p on p.id = m.product_id where p.id is null;
  if n > 0 then raise exception 'MAYOREO: % productos no existen', n; end if;
  -- el mayoreo debe ser más barato que el precio normal
  select count(*) into n from _my m join public.products p on p.id = m.product_id where m.price >= p.price;
  if n > 0 then raise exception 'MAYOREO: % precios no son menores al precio normal', n; end if;
  -- y más barato que el medio mayoreo vigente (a menor cantidad)
  select count(*) into n from _my m join public.product_volume_prices v on v.product_id = m.product_id and v.active
    and v.min_quantity < m.min_quantity and v.price <= m.price;
  if n > 0 then raise exception 'MAYOREO: % precios no mejoran el medio mayoreo', n; end if;
  -- no pisa un escalón existente distinto (la misma cantidad sólo si ya es este mismo mayoreo)
  select count(*) into n from _my m join public.product_volume_prices v on v.product_id = m.product_id
    and v.min_quantity >= m.min_quantity and not (v.min_quantity = m.min_quantity and v.price = m.price);
  if n > 0 then raise exception 'MAYOREO: % productos ya tienen un escalón igual o mayor', n; end if;

  insert into public.product_volume_prices (product_id, min_quantity, price, discount_percent, active)
    select product_id, min_quantity, price, discount_percent, true from _my
  on conflict (product_id, min_quantity) do update
    set price = excluded.price, discount_percent = excluded.discount_percent, active = true, updated_at = now();
  raise notice 'MAYOREO: % escalones cargados', 156;
end $mig$;
