-- CATÁLOGO — modelo producto+variante (Opción A). ADITIVO. Idempotente. NO migra precios.
-- Variantes nuevas nacen sellable=false (price NULL → no ordenables hasta la fase de precios).
-- 4 padres visuales + AGU-FMC quedan sellable=false. 9 REVIEW excluidos.

-- 1) Esquema
alter table public.products add column if not exists family text;
alter table public.products add column if not exists parent_product_id uuid references public.products(id);
alter table public.products add column if not exists sellable boolean not null default true;
alter table public.products add column if not exists odoo_reference text;
alter table public.products add column if not exists odoo_identity_key text;
create unique index if not exists uq_products_odoo_identity on public.products(odoo_identity_key) where (odoo_identity_key is not null);
create index if not exists idx_products_parent on public.products(parent_product_id);
create index if not exists idx_products_family on public.products(family);
do $$ begin
  if not exists (select 1 from pg_constraint where conname='ck_products_not_self_parent') then
    alter table public.products add constraint ck_products_not_self_parent check (parent_product_id is null or parent_product_id <> id);
  end if;
end $$;

-- 2) Padres visuales (active=true, sellable=false, imagen preservada)
update public.products set sellable=false, family='Hidrolizados'   where sku='PEP-005';
update public.products set sellable=false, family='Implantes'      where sku='PEP-004';
update public.products set sellable=false, family='Ultrafiltrados' where sku='PEP-002';
update public.products set sellable=false, family='ELITE'          where sku='PEP-003';

-- 3) COSTOS DE PADRES eliminados (no vendibles; variantes llevan el costo).
--    PEP-004 3357.36 = DATA_ERROR_CONFIRMED (provenía de RADIESSE-LIDO). PEP-002 2833 = redundante en padre.
delete from public.product_costs where product_id in (select id from public.products where sku in ('PEP-002','PEP-003','PEP-004','PEP-005'));

-- 4) Products existentes aprobados (49) — no toca price ni image_url
update products set family='Aethoxylerol', odoo_reference='3% 5X2 ml Ampolletas', odoo_identity_key='od55d88fde' where sku='MED-003';
update products set family='Aethoxylerol', odoo_reference='0.5% 5X2 ml Ampolletas', odoo_identity_key='od751134f0' where sku='MED-001';
update products set family='Aethoxylerol', odoo_reference='1% 5X2 ml Ampolletas', odoo_identity_key='odf423c35c' where sku='MED-002';
update products set family='Botaone 100 UI', odoo_reference='100 UI', odoo_identity_key='od9ea054b8' where sku='TOX-011';
update products set family='Botox 100 UI', odoo_reference='100 UI', odoo_identity_key='odbd9b5cfc' where sku='TOX-001';
update products set family='CARBOX Cocarboxilasa', odoo_reference='50 ml 4% 40 mg/ml', odoo_identity_key='odb3570ca6' where sku='VIT-007';
update products set family='Magnesio 50 ml 20 mg/ml', odoo_reference='50 ml 20 mg/ml', odoo_identity_key='od5fc26f70' where sku='VIT-003';
update products set family='Dysport', odoo_reference='500 UI', odoo_identity_key='od81744829' where sku='TOX-003';
update products set family='Golden Placenta Mask', odoo_reference='35 ml', odoo_identity_key='od8817904f' where sku='SER-002';
update products set family='Golden Placenta Serum', odoo_reference='50 ml', odoo_identity_key='oda91c83ac' where sku='SER-001';
update products set family='HYDRA NEEDLE', odoo_reference=null, odoo_identity_key='od6566ac26' where sku='APA-002';
update products set family='HYDRA PEN H5', odoo_reference=null, odoo_identity_key='od5eb70fdc' where sku='APA-001';
update products set family='HArmonyCa', odoo_reference=null, odoo_identity_key='od3f381a3' where sku='REL-001';
update products set family='INNOTOX', odoo_reference='50 UI', odoo_identity_key='od8547d0f3' where sku='TOX-005';
update products set family='INNOTOX', odoo_reference='100 UI', odoo_identity_key='od24f4ab3f' where sku='TOX-004';
update products set family='Intimo Renovacell', odoo_reference='Vial 5 ml', odoo_identity_key='odb0c9202b' where sku='PEE-001';
update products set family='Linurase 100 UI', odoo_reference='100 UI', odoo_identity_key='od76da1093' where sku='TOX-006';
update products set family='Plumper', odoo_reference='7 gr', odoo_identity_key='oda239777b' where sku='SER-003';
update products set family='Liporase', odoo_reference='1500 UI', odoo_identity_key='odf81386c4' where sku='REL-010';
update products set family='Microaguja H24', odoo_reference=null, odoo_identity_key='od9ddaa1d1' where sku='APA-003';
update products set family='Microaguja H36', odoo_reference=null, odoo_identity_key='od9ddaa654' where sku='APA-004';
update products set family='Microaguja HR', odoo_reference='nano', odoo_identity_key='odfab0a6a9' where sku='APA-005';
update products set family='NABOTA', odoo_reference='200 UI', odoo_identity_key='odf0c5d926' where sku='TOX-008';
update products set family='NABOTA', odoo_reference='100 UI', odoo_identity_key='odee70b085' where sku='TOX-007';
update products set family='NAD+', odoo_reference='25 ml 100 mg/ml', odoo_identity_key='odb87cccf2' where sku='VIT-008';
update products set family='PE PLUS', odoo_reference='60 Capsulas', odoo_identity_key='od9168ba1c' where sku='VIT-009';
update products set family='Renocain+', odoo_reference='30 gr Unguento Anestesico', odoo_identity_key='od2d31032f' where sku='ANE-001';
update products set family='Revage R PDLA', odoo_reference='50 mg', odoo_identity_key='od61e868e6' where sku='REL-009';
update products set family='Revage V PLLA', odoo_reference='200 mg', odoo_identity_key='od4904def7' where sku='REL-008';
update products set family='SAXENDA', odoo_reference='6 mg/ml 3X3 PLUMA ML', odoo_identity_key='od7f0147be' where sku='MET-002';
update products set family='Selenio 20 ml 200 mcg/ml', odoo_reference='20 ml 200 mcg/ml', odoo_identity_key='od5db15b6d' where sku='VIT-006';
update products set family='STOPLIP 15 ml', odoo_reference='15 ml', odoo_identity_key='odb893962b' where sku='MET-001';
update products set family='SkinVive', odoo_reference=null, odoo_identity_key='odabd799ee' where sku='REL-002';
update products set family='Zinc 50 ml 20 mg/ml', odoo_reference='50 ml 20 mg/ml', odoo_identity_key='odca527409' where sku='VIT-002';
update products set family='TNM', odoo_reference='50 ml', odoo_identity_key='od2a6ebf6e' where sku='VIT-010';
update products set family='Ultrafiltrados', odoo_reference='GOLDEN PLACENTA 2.5 ml', odoo_identity_key='ode455815f' where sku='PEP-001';
update products set family='Vit B1 10 ml 100 mg/ml', odoo_reference='10 ml 100 mg/ml', odoo_identity_key='od8a9bd502' where sku='VIT-005';
update products set family='Vit B12 20 ml 1000 mcg/ml', odoo_reference='20 ml 1000 mcg/ml', odoo_identity_key='od96f78cd6' where sku='VIT-004';
update products set family='Vitamina C 20 ml 500 mg/ml', odoo_reference='20 ml 500 mg/ml', odoo_identity_key='od92ff1554' where sku='VIT-001';
update products set family='WEGOVY', odoo_reference='1.7 mg 4 dosis 2.27 mg', odoo_identity_key='odafdac162' where sku='MET-006';
update products set family='WEGOVY', odoo_reference='2.4 mg 4 dosis 3.2 mg', odoo_identity_key='odd98ba60a' where sku='MET-007';
update products set family='WEGOVY', odoo_reference='.25 mg 4 dosis .68 mg', odoo_identity_key='odf45810d4' where sku='MET-003';
update products set family='WEGOVY', odoo_reference='1 mg 4 dosis 1.34 mg', odoo_identity_key='od13e4fc88' where sku='MET-005';
update products set family='WEGOVY', odoo_reference='.5 mg 4 dosis 1.34 mg', odoo_identity_key='od4481b60c' where sku='MET-004';
update products set family='WONDERTOX', odoo_reference='200 UI', odoo_identity_key='od376f23db' where sku='TOX-010';
update products set family='WONDERTOX', odoo_reference='100 UI', odoo_identity_key='od3519fb3a' where sku='TOX-009';
update products set family='Xelaju', odoo_reference='60 ml', odoo_identity_key='odc3c0c5f3' where sku='REL-007';
update products set family='Xelaju', odoo_reference='200 mg', odoo_identity_key='odd3ba4446' where sku='REL-006';
update products set family='Xeomeen 100 UI', odoo_reference='100 UI', odoo_identity_key='odf58d6d41' where sku='TOX-002';

-- 5) Variantes nuevas (127; sellable=false; price NULL)
insert into products (sku,name,line,category,price,unit,active,sellable,family,odoo_reference,odoo_identity_key)
  select 'NEW-001','DYSPORT','prof','Toxinas',null,'Unidades',true,false,'Dysport','300 UI','od7cc9f6e7'
  where not exists (select 1 from products where sku='NEW-001');
insert into products (sku,name,line,category,price,unit,active,sellable,family,odoo_reference,odoo_identity_key)
  select 'NEW-002','EMLA','prof','Anestésicos',null,'Unidades',true,false,'EMLA','25/25 mg CRA 30 gr','od75fcedd4'
  where not exists (select 1 from products where sku='NEW-002');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-001','HIDROLIZADO COSMETICO vial 8 ml HUESO','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'HUESO','od6f8097e1'
  where not exists (select 1 from products where sku='HID-001');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-002','HIDROLIZADO COSMETICO vial 8 ml CEREBELO','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'CEREBELO','od432bf7fe'
  where not exists (select 1 from products where sku='HID-002');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-003','HIDROLIZADO COSMETICO vial 8 ml BAZO','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'BAZO','od492ed489'
  where not exists (select 1 from products where sku='HID-003');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-004','HIDROLIZADO COSMETICO vial 8 ml HIPOFISIS','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'HIPOFISIS','od1dca4e0b'
  where not exists (select 1 from products where sku='HID-004');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-005','HIDROLIZADO COSMETICO vial 8 ml PROSTATA','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'PROSTATA','od2540892b'
  where not exists (select 1 from products where sku='HID-005');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-006','HIDROLIZADO COSMETICO vial 8 ml NERVIO OPTICO','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'NERVIO OPTICO','odb661313e'
  where not exists (select 1 from products where sku='HID-006');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-007','HIDROLIZADO COSMETICO vial 8 ml RETINA','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'RETINA','od75cdb1a0'
  where not exists (select 1 from products where sku='HID-007');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-008','HIDROLIZADO COSMETICO vial 8 ml TIMO','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'TIMO','od4938d3b6'
  where not exists (select 1 from products where sku='HID-008');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-009','HIDROLIZADO COSMETICO vial 8 ml OIDO MEDIO','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'OIDO MEDIO','od3d3f8f56'
  where not exists (select 1 from products where sku='HID-009');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-010','HIDROLIZADO COSMETICO vial 8 ml TIMPANO','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'TIMPANO','odd251f795'
  where not exists (select 1 from products where sku='HID-010');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-011','HIDROLIZADO COSMETICO vial 8 ml ELASTINA','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'ELASTINA','odfe6df6e'
  where not exists (select 1 from products where sku='HID-011');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-012','HIDROLIZADO COSMETICO vial 8 ml TIROIDES','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'TIROIDES','od282cd480'
  where not exists (select 1 from products where sku='HID-012');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-013','HIDROLIZADO COSMETICO vial 8 ml PIEL EMBRIONARIA','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'PIEL EMBRIONARIA','od85aad010'
  where not exists (select 1 from products where sku='HID-013');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-014','HIDROLIZADO COSMETICO vial 8 ml MEDULA OSEA','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'MEDULA OSEA','odd4a811d'
  where not exists (select 1 from products where sku='HID-014');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-015','HIDROLIZADO COSMETICO vial 8 ml GANGLIO LINFATICO','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'GANGLIO LINFATICO','od7e6ba617'
  where not exists (select 1 from products where sku='HID-015');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-016','HIDROLIZADO COSMETICO vial 8 ml ESTOMAGO','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'ESTOMAGO','od56c4311c'
  where not exists (select 1 from products where sku='HID-016');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-017','HIDROLIZADO COSMETICO vial 8 ml OIDO INTERNO','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'OIDO INTERNO','od6d95a967'
  where not exists (select 1 from products where sku='HID-017');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-018','HIDROLIZADO COSMETICO vial 8 ml EMBRION TOTAL','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'EMBRION TOTAL','odc9ebf9ed'
  where not exists (select 1 from products where sku='HID-018');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-019','HIDROLIZADO COSMETICO vial 8 ml MEDULA ESPINAL','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'MEDULA ESPINAL','odc6ddb9e1'
  where not exists (select 1 from products where sku='HID-019');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-020','HIDROLIZADO COSMETICO vial 8 ml ARTERIA','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'ARTERIA','od3136cde5'
  where not exists (select 1 from products where sku='HID-020');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-021','HIDROLIZADO COSMETICO vial 8 ml VENA','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'VENA','od4939db87'
  where not exists (select 1 from products where sku='HID-021');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-022','HIDROLIZADO COSMETICO vial 8 ml COLAGENO','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'COLAGENO','od36adbfe5'
  where not exists (select 1 from products where sku='HID-022');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-023','HIDROLIZADO COSMETICO vial 8 ml PLACENTA','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'PLACENTA','od35915965'
  where not exists (select 1 from products where sku='HID-023');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-024','HIDROLIZADO COSMETICO vial 8 ml OJO TOTAL','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'OJO TOTAL','od35321809'
  where not exists (select 1 from products where sku='HID-024');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-025','HIDROLIZADO COSMETICO vial 8 ml CORDON UMBILICAL','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'CORDON UMBILICAL','odb51a2f74'
  where not exists (select 1 from products where sku='HID-025');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-026','HIDROLIZADO COSMETICO vial 8 ml PANCREAS','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'PANCREAS','od52ac58a'
  where not exists (select 1 from products where sku='HID-026');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-027','HIDROLIZADO COSMETICO vial 8 ml CORAZON','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'CORAZON','odc4058dd9'
  where not exists (select 1 from products where sku='HID-027');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-028','HIDROLIZADO COSMETICO vial 8 ml LIGAMENTO','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'LIGAMENTO','od1ac41c9d'
  where not exists (select 1 from products where sku='HID-028');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-029','HIDROLIZADO COSMETICO vial 8 ml MESENQUIMA','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'MESENQUIMA','odef916192'
  where not exists (select 1 from products where sku='HID-029');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-030','HIDROLIZADO COSMETICO vial 8 ml HIPOTALAMO','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'HIPOTALAMO','odf7278b2b'
  where not exists (select 1 from products where sku='HID-030');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-031','HIDROLIZADO COSMETICO vial 8 ml TESTICULO','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'TESTICULO','odd563d019'
  where not exists (select 1 from products where sku='HID-031');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-032','HIDROLIZADO COSMETICO vial 8 ml NERVIO AUDITIVO','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'NERVIO AUDITIVO','od4372c2b5'
  where not exists (select 1 from products where sku='HID-032');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-033','HIDROLIZADO COSMETICO vial 8 ml OVARIO','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'OVARIO','od6ff792cd'
  where not exists (select 1 from products where sku='HID-033');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-034','HIDROLIZADO COSMETICO vial 8 ml VEJIGA','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'VEJIGA','od7f1cd773'
  where not exists (select 1 from products where sku='HID-034');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-035','HIDROLIZADO COSMETICO vial 8 ml CARTILAGO','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'CARTILAGO','od1b235873'
  where not exists (select 1 from products where sku='HID-035');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-036','HIDROLIZADO COSMETICO vial 8 ml PULMON','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'PULMON','od72409698'
  where not exists (select 1 from products where sku='HID-036');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-037','HIDROLIZADO COSMETICO vial 8 ml DUODENO','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'DUODENO','od1ec9c08b'
  where not exists (select 1 from products where sku='HID-037');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-038','HIDROLIZADO COSMETICO vial 8 ml CORONARIAS','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'CORONARIAS','od68657c4e'
  where not exists (select 1 from products where sku='HID-038');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-039','HIDROLIZADO COSMETICO vial 8 ml RIÑON','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'RIÑON','od702f1e23'
  where not exists (select 1 from products where sku='HID-039');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-040','HIDROLIZADO COSMETICO vial 8 ml HIGADO','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'HIGADO','od5ebb3929'
  where not exists (select 1 from products where sku='HID-040');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-041','HIDROLIZADO COSMETICO vial 8 ml CORNEA','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'CORNEA','od53844095'
  where not exists (select 1 from products where sku='HID-041');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-042','HIDROLIZADO COSMETICO vial 8 ml CRISTALINO','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'CRISTALINO','odb96ef195'
  where not exists (select 1 from products where sku='HID-042');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-043','HIDROLIZADO COSMETICO vial 8 ml SUPRARRENAL','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'SUPRARRENAL','odfddcfe4c'
  where not exists (select 1 from products where sku='HID-043');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-044','HIDROLIZADO COSMETICO vial 8 ml COLON','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'COLON','od6f22f058'
  where not exists (select 1 from products where sku='HID-044');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-045','HIDROLIZADO COSMETICO vial 8 ml CEREBRO','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'CEREBRO','odacb3c35f'
  where not exists (select 1 from products where sku='HID-045');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'HID-046','HIDROLIZADO COSMETICO vial 8 ml MUSCULO ESTRIADO','prof','Péptidos',null,'Unidades',true,false,'Hidrolizados',(select id from products where sku='PEP-005'),'MUSCULO ESTRIADO','od704c2220'
  where not exists (select 1 from products where sku='HID-046');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-001','IMPLANTE COSMETICO 4.5 ML Cartilago','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Cartilago','oded1b5b99'
  where not exists (select 1 from products where sku='IMP-001');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-002','IMPLANTE COSMETICO 4.5 ML Placenta','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Placenta','odd628fcb'
  where not exists (select 1 from products where sku='IMP-002');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-003','IMPLANTE COSMETICO 4.5 ML ARTERIA','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'ARTERIA','odd2e7cf8b'
  where not exists (select 1 from products where sku='IMP-003');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-004','IMPLANTE COSMETICO 4.5 ML Tendon','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Tendon','od7799086b'
  where not exists (select 1 from products where sku='IMP-004');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-005','IMPLANTE COSMETICO 4.5 ML Pulmon','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Pulmon','od6f64fb7e'
  where not exists (select 1 from products where sku='IMP-005');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-006','IMPLANTE COSMETICO 4.5 ML Mesenquima','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Mesenquima','od89c978'
  where not exists (select 1 from products where sku='IMP-006');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-007','IMPLANTE COSMETICO 4.5 ML Piel','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Piel','od2810948d'
  where not exists (select 1 from products where sku='IMP-007');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-008','IMPLANTE COSMETICO 4.5 ML bazo','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'bazo','od2808c7ef'
  where not exists (select 1 from products where sku='IMP-008');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-009','IMPLANTE COSMETICO 4.5 ML Riñon','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Riñon','od2a477e49'
  where not exists (select 1 from products where sku='IMP-009');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-010','IMPLANTE COSMETICO 4.5 ML Ganglio','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Ganglio','od78b1f5a4'
  where not exists (select 1 from products where sku='IMP-010');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-011','IMPLANTE COSMETICO 4.5 ML Cristalino','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Cristalino','odca67597b'
  where not exists (select 1 from products where sku='IMP-011');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-012','IMPLANTE COSMETICO 4.5 ML Ojo','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Ojo','od5e4e0feb'
  where not exists (select 1 from products where sku='IMP-012');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-013','IMPLANTE COSMETICO 4.5 ML VENA','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'VENA','od2813ceed'
  where not exists (select 1 from products where sku='IMP-013');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-014','IMPLANTE COSMETICO 4.5 ML Colon','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Colon','od293b507e'
  where not exists (select 1 from products where sku='IMP-014');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-015','IMPLANTE COSMETICO 4.5 ML Hueso','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Hueso','od2998f807'
  where not exists (select 1 from products where sku='IMP-015');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-016','IMPLANTE COSMETICO 4.5 ML Estomago','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Estomago','od2e956782'
  where not exists (select 1 from products where sku='IMP-016');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-017','IMPLANTE COSMETICO 4.5 ML Cerebro','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Cerebro','od4e64c505'
  where not exists (select 1 from products where sku='IMP-017');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-018','IMPLANTE COSMETICO 4.5 ML Nervio optico','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Nervio optico','odfd525764'
  where not exists (select 1 from products where sku='IMP-018');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-019','IMPLANTE COSMETICO 4.5 ML Prostata','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Prostata','odfd11bf91'
  where not exists (select 1 from products where sku='IMP-019');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-020','IMPLANTE COSMETICO 4.5 ML Medula Espinal','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Medula Espinal','odebf3a4c7'
  where not exists (select 1 from products where sku='IMP-020');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-021','IMPLANTE COSMETICO 4.5 ML Ovario','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Ovario','od6d1bf7b3'
  where not exists (select 1 from products where sku='IMP-021');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-022','IMPLANTE COSMETICO 4.5 ML Hipotalamo','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Hipotalamo','od81ff311'
  where not exists (select 1 from products where sku='IMP-022');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-023','IMPLANTE COSMETICO 4.5 ML Testiculo','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Testiculo','oda75bd33f'
  where not exists (select 1 from products where sku='IMP-023');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-024','IMPLANTE COSMETICO 4.5 ML Musculo','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Musculo','od758efe6b'
  where not exists (select 1 from products where sku='IMP-024');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-025','IMPLANTE COSMETICO 4.5 ML Medula Osea','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Medula Osea','od3d4fe5c3'
  where not exists (select 1 from products where sku='IMP-025');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-026','IMPLANTE COSMETICO 4.5 ML Ligamento','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Ligamento','odecbc1fc3'
  where not exists (select 1 from products where sku='IMP-026');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-027','IMPLANTE COSMETICO 4.5 ML Vejiga','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Vejiga','od7c413c59'
  where not exists (select 1 from products where sku='IMP-027');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-028','IMPLANTE COSMETICO 4.5 ML Hipofisis','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Hipofisis','odefc25131'
  where not exists (select 1 from products where sku='IMP-028');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-029','IMPLANTE COSMETICO 4.5 ML Timo','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Timo','od2812c71c'
  where not exists (select 1 from products where sku='IMP-029');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-030','IMPLANTE COSMETICO 4.5 ML Tiroides','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Tiroides','odfffe0ae6'
  where not exists (select 1 from products where sku='IMP-030');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-031','IMPLANTE COSMETICO 4.5 ML Suprarrenal','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Suprarrenal','od2de262f2'
  where not exists (select 1 from products where sku='IMP-031');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-032','IMPLANTE COSMETICO 4.5 ML Elastina','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Elastina','ode7b815d4'
  where not exists (select 1 from products where sku='IMP-032');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-033','IMPLANTE COSMETICO 4.5 ML Embrion','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Embrion','odf9e839cf'
  where not exists (select 1 from products where sku='IMP-033');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-034','IMPLANTE COSMETICO 4.5 ML Corazon','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Corazon','od65b68f7f'
  where not exists (select 1 from products where sku='IMP-034');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-035','IMPLANTE COSMETICO 4.5 ML Colageno','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Colageno','ode7ef64b'
  where not exists (select 1 from products where sku='IMP-035');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-036','IMPLANTE COSMETICO 4.5 ML Cornea','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Cornea','od50a8a57b'
  where not exists (select 1 from products where sku='IMP-036');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-037','IMPLANTE COSMETICO 4.5 ML Cordon Umbilical','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Cordon Umbilical','od77566bda'
  where not exists (select 1 from products where sku='IMP-037');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-038','IMPLANTE COSMETICO 4.5 ML Pancreas','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Pancreas','oddcfbfbf0'
  where not exists (select 1 from products where sku='IMP-038');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-039','IMPLANTE COSMETICO 4.5 ML Higado','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Higado','od5bdf9e0f'
  where not exists (select 1 from products where sku='IMP-039');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'IMP-040','IMPLANTE COSMETICO 4.5 ML Retina','prof','Péptidos',null,'Unidades',true,false,'Implantes',(select id from products where sku='PEP-004'),'Retina','od72f21686'
  where not exists (select 1 from products where sku='IMP-040');
insert into products (sku,name,line,category,price,unit,active,sellable,family,odoo_reference,odoo_identity_key)
  select 'NEW-010','NABOTA','prof','Toxinas',null,'Unidades',true,false,'NABOTA','150 UI','odeecb2b0a'
  where not exists (select 1 from products where sku='NEW-010');
insert into products (sku,name,line,category,price,unit,active,sellable,family,odoo_reference,odoo_identity_key)
  select 'NEW-011','RADIESSE 1.5CC CLASICO','prof',null,null,'Unidades',true,false,'RADIESSE 1.5CC CLASICO',null,'odf733057b'
  where not exists (select 1 from products where sku='NEW-011');
insert into products (sku,name,line,category,price,unit,active,sellable,family,odoo_reference,odoo_identity_key)
  select 'NEW-012','RADIESSE-LIDO, FAC,1.5CC,CAN STRL INJ. IMPLANT','prof',null,null,'Unidades',true,false,'RADIESSE-LIDO, FAC,1.5CC,CAN STRL INJ. IMPLANT',null,'od5e62479c'
  where not exists (select 1 from products where sku='NEW-012');
insert into products (sku,name,line,category,price,unit,active,sellable,family,odoo_reference,odoo_identity_key)
  select 'NEW-014','STEMLASH','prof','Aparatología',null,'Unidades',true,false,'STEMLASH','3.65 ml','odc8415139'
  where not exists (select 1 from products where sku='NEW-014');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'ULT-001','ULTRAFILTRADO PROSTATA 2.5 ml','prof','Péptidos',null,'Caja/20 pzas',true,false,'Ultrafiltrados',(select id from products where sku='PEP-002'),'PROSTATA 2.5 ml','od4e47a58c'
  where not exists (select 1 from products where sku='ULT-001');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'ULT-002','ULTRAFILTRADO ACTIVUS 2.5 ml','prof','Péptidos',null,'Caja/20 pzas',true,false,'Ultrafiltrados',(select id from products where sku='PEP-002'),'ACTIVUS 2.5 ml','od55e95bbd'
  where not exists (select 1 from products where sku='ULT-002');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'ELI-001','ULTRAFILTRADO ELITE Hombre 5 ml 300 kDa','prof','Péptidos',null,'Caja/10 pzas',true,false,'ELITE',(select id from products where sku='PEP-003'),'ELITE Hombre 5 ml 300 kDa','od2ae46ddf'
  where not exists (select 1 from products where sku='ELI-001');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'ULT-003','ULTRAFILTRADO GOLDEN V 2.5 ml','prof','Péptidos',null,'Caja/20 pzas',true,false,'Ultrafiltrados',(select id from products where sku='PEP-002'),'GOLDEN V 2.5 ml','od9f50a9ad'
  where not exists (select 1 from products where sku='ULT-003');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'ULT-004','ULTRAFILTRADO IMMUNIS V 2.5 ml','prof','Péptidos',null,'Caja/20 pzas',true,false,'Ultrafiltrados',(select id from products where sku='PEP-002'),'IMMUNIS V 2.5 ml','od443f53f6'
  where not exists (select 1 from products where sku='ULT-004');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'ULT-005','ULTRAFILTRADO IMMUNIS 2.5 ml','prof','Péptidos',null,'Caja/20 pzas',true,false,'Ultrafiltrados',(select id from products where sku='PEP-002'),'IMMUNIS 2.5 ml','od9d28a420'
  where not exists (select 1 from products where sku='ULT-005');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'ULT-006','ULTRAFILTRADO Superadaptogenos 2.5 ml','prof','Péptidos',null,'Caja/20 pzas',true,false,'Ultrafiltrados',(select id from products where sku='PEP-002'),'Superadaptogenos 2.5 ml','odbc7ca402'
  where not exists (select 1 from products where sku='ULT-006');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'ULT-007','ULTRAFILTRADO SANUS 2.5 ml','prof','Péptidos',null,'Caja/20 pzas',true,false,'Ultrafiltrados',(select id from products where sku='PEP-002'),'SANUS 2.5 ml','odfe6ce8e8'
  where not exists (select 1 from products where sku='ULT-007');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'ELI-002','ULTRAFILTRADO ELITE MOBILIS 5 ml 300 kDa','prof','Péptidos',null,'Caja/10 pzas',true,false,'ELITE',(select id from products where sku='PEP-003'),'ELITE MOBILIS 5 ml 300 kDa','od23323531'
  where not exists (select 1 from products where sku='ELI-002');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'ELI-003','ULTRAFILTRADO ELITE Placenta 5 ml 300 kDa','prof','Péptidos',null,'Caja/10 pzas',true,false,'ELITE',(select id from products where sku='PEP-003'),'ELITE Placenta 5 ml 300 kDa','od16be95aa'
  where not exists (select 1 from products where sku='ELI-003');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'ELI-004','ULTRAFILTRADO ELITE Mujer 5 ml 300 kDa','prof','Péptidos',null,'Caja/10 pzas',true,false,'ELITE',(select id from products where sku='PEP-003'),'ELITE Mujer 5 ml 300 kDa','od5f5e4285'
  where not exists (select 1 from products where sku='ELI-004');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'ULT-008','ULTRAFILTRADO OPTIMUS 2.5 ml','prof','Péptidos',null,'Caja/20 pzas',true,false,'Ultrafiltrados',(select id from products where sku='PEP-002'),'OPTIMUS 2.5 ml','od76e0e3ef'
  where not exists (select 1 from products where sku='ULT-008');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'ULT-009','ULTRAFILTRADO SALUBRE 2.5 ml','prof','Péptidos',null,'Caja/20 pzas',true,false,'Ultrafiltrados',(select id from products where sku='PEP-002'),'SALUBRE 2.5 ml','od8a9c2c'
  where not exists (select 1 from products where sku='ULT-009');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'ULT-010','ULTRAFILTRADO VIVUS 2.5 ml','prof','Péptidos',null,'Caja/20 pzas',true,false,'Ultrafiltrados',(select id from products where sku='PEP-002'),'VIVUS 2.5 ml','oddc81341b'
  where not exists (select 1 from products where sku='ULT-010');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'ELI-005','ULTRAFILTRADO ELITE IMMUNIS 5 ml 300 kDa','prof','Péptidos',null,'Caja/10 pzas',true,false,'ELITE',(select id from products where sku='PEP-003'),'ELITE IMMUNIS 5 ml 300 kDa','odc6750a64'
  where not exists (select 1 from products where sku='ELI-005');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'ULT-011','ULTRAFILTRADO CEREBRI 2.5 ml','prof','Péptidos',null,'Caja/20 pzas',true,false,'Ultrafiltrados',(select id from products where sku='PEP-002'),'CEREBRI 2.5 ml','odaf357da'
  where not exists (select 1 from products where sku='ULT-011');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'ULT-012','ULTRAFILTRADO REV HOMBRE 2.5 ml','prof','Péptidos',null,'Caja/20 pzas',true,false,'Ultrafiltrados',(select id from products where sku='PEP-002'),'REV HOMBRE 2.5 ml','od741fde08'
  where not exists (select 1 from products where sku='ULT-012');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'ULT-013','ULTRAFILTRADO FT EXTRACTS 2.5 ml','prof','Péptidos',null,'Caja/20 pzas',true,false,'Ultrafiltrados',(select id from products where sku='PEP-002'),'FT EXTRACTS 2.5 ml','odf175f966'
  where not exists (select 1 from products where sku='ULT-013');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'ULT-014','ULTRAFILTRADO MOBILIS 2.5 ml','prof','Péptidos',null,'Caja/20 pzas',true,false,'Ultrafiltrados',(select id from products where sku='PEP-002'),'MOBILIS 2.5 ml','odc604f92d'
  where not exists (select 1 from products where sku='ULT-014');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'ULT-015','ULTRAFILTRADO MAGNUS 2.5 ml','prof','Péptidos',null,'Caja/20 pzas',true,false,'Ultrafiltrados',(select id from products where sku='PEP-002'),'MAGNUS 2.5 ml','od6f409749'
  where not exists (select 1 from products where sku='ULT-015');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'ULT-016','ULTRAFILTRADO REV MUJER 2.5 ml','prof','Péptidos',null,'Caja/20 pzas',true,false,'Ultrafiltrados',(select id from products where sku='PEP-002'),'REV MUJER 2.5 ml','odf21f42ee'
  where not exists (select 1 from products where sku='ULT-016');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'ULT-017','ULTRAFILTRADO SPEC (Riñon, Placenta, Timo, Mesenquima) 2.5 ml','prof','Péptidos',null,'Unidades',true,false,'Ultrafiltrados',(select id from products where sku='PEP-002'),'SPEC (Riñon, Placenta, Timo, Mesenquima) 2.5 ml','od4a01f0c5'
  where not exists (select 1 from products where sku='ULT-017');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'ELI-006','ULTRAFILTRADO ELITE Ojo 5 ml 300 kDa','prof','Péptidos',null,'Caja/10 pzas',true,false,'ELITE',(select id from products where sku='PEP-003'),'ELITE Ojo 5 ml 300 kDa','odc2a0050a'
  where not exists (select 1 from products where sku='ELI-006');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'ULT-018','ULTRAFILTRADO OJO 2.5 ml','prof','Péptidos',null,'Caja/20 pzas',true,false,'Ultrafiltrados',(select id from products where sku='PEP-002'),'OJO 2.5 ml','ode5092bc6'
  where not exists (select 1 from products where sku='ULT-018');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'ULT-019','Ultra Filtrados Renovacell','prof','Péptidos',null,'Unidades',true,false,'Ultrafiltrados',(select id from products where sku='PEP-002'),null,'od1a8d58dc'
  where not exists (select 1 from products where sku='ULT-019');
insert into products (sku,name,line,category,price,unit,active,sellable,family,odoo_reference,odoo_identity_key)
  select 'XEL-001','XELAJU DEEP','prof','Rellenos',null,'Unidades',true,false,'Xelaju','1 ml','odd0e44fd2'
  where not exists (select 1 from products where sku='XEL-001');
insert into products (sku,name,line,category,price,unit,active,sellable,family,odoo_reference,odoo_identity_key)
  select 'XEL-002','XELAJU FINE','prof','Rellenos',null,'Unidades',true,false,'Xelaju','1 ml','od607e936'
  where not exists (select 1 from products where sku='XEL-002');
insert into products (sku,name,line,category,price,unit,active,sellable,family,odoo_reference,odoo_identity_key)
  select 'XEL-003','XELAJU HYLO','prof','Rellenos',null,'Unidades',true,false,'Xelaju','2.5 ml','od46d838a6'
  where not exists (select 1 from products where sku='XEL-003');
insert into products (sku,name,line,category,price,unit,active,sellable,family,odoo_reference,odoo_identity_key)
  select 'XEL-004','XELAJU VOLUME','prof','Rellenos',null,'Unidades',true,false,'Xelaju','1 ml','odedd799cc'
  where not exists (select 1 from products where sku='XEL-004');

-- Familia visual "Agujas FMC" (padre no vendible) + variantes (sellable=false: price NULL)
insert into products (sku,name,line,category,price,unit,active,sellable,family)
  select 'AGU-FMC','Agujas FMC','prof','Aparatología',null,'Unidades',true,false,'Agujas FMC'
  where not exists (select 1 from products where sku='AGU-FMC');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'AGU-FMC-01','FMC 22G 50mm','prof','Aparatología',null,'Unidades',true,false,'Agujas FMC',(select id from products where sku='AGU-FMC'),null,'od24fc8c21'
  where not exists (select 1 from products where sku='AGU-FMC-01');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'AGU-FMC-02','FMC 22G 70mm','prof','Aparatología',null,'Unidades',true,false,'Agujas FMC',(select id from products where sku='AGU-FMC'),null,'od2520bd23'
  where not exists (select 1 from products where sku='AGU-FMC-02');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'AGU-FMC-03','FMC 25G 40mm','prof','Aparatología',null,'Unidades',true,false,'Agujas FMC',(select id from products where sku='AGU-FMC'),null,'ode9aff243'
  where not exists (select 1 from products where sku='AGU-FMC-03');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'AGU-FMC-04','FMC 25G 50mm','prof','Aparatología',null,'Unidades',true,false,'Agujas FMC',(select id from products where sku='AGU-FMC'),null,'ode9c20ac4'
  where not exists (select 1 from products where sku='AGU-FMC-04');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'AGU-FMC-05','FMC 27G 40mm','prof','Aparatología',null,'Unidades',true,false,'Agujas FMC',(select id from products where sku='AGU-FMC'),null,'odc2339c05'
  where not exists (select 1 from products where sku='AGU-FMC-05');
insert into products (sku,name,line,category,price,unit,active,sellable,family,parent_product_id,odoo_reference,odoo_identity_key)
  select 'AGU-FMC-06','FMC 27G 50mm','prof','Aparatología',null,'Unidades',true,false,'Agujas FMC',(select id from products where sku='AGU-FMC'),null,'odc245b486'
  where not exists (select 1 from products where sku='AGU-FMC-06');

-- 6) Costos por variante/producto (171 sentencias; costo Odoo>0; idempotente). RADIESSE-LIDO recibe su 3357.36 aquí.
insert into product_costs(product_id,unit_cost) select id, 1100 from products where sku='MED-003' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 550 from products where sku='MED-001' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 600 from products where sku='MED-002' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 282.46 from products where sku='TOX-011' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 4009.62 from products where sku='TOX-001' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 320.16 from products where sku='VIT-007' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 247 from products where sku='VIT-003' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 3638 from products where sku='NEW-001' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 4774 from products where sku='TOX-003' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 464.86 from products where sku='NEW-002' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 94.6 from products where sku='SER-002' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1115.58 from products where sku='SER-001' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-001' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-002' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 530.12 from products where sku='HID-003' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 530.12 from products where sku='HID-004' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 530.12 from products where sku='HID-005' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 530.12 from products where sku='HID-006' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-007' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 530.12 from products where sku='HID-008' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 530.12 from products where sku='HID-009' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 530.12 from products where sku='HID-010' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 530.12 from products where sku='HID-011' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-012' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-013' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-014' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 530.12 from products where sku='HID-015' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 530.12 from products where sku='HID-016' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-017' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-018' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-019' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-020' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-021' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-022' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-023' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 530.12 from products where sku='HID-024' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-025' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-026' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-027' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-028' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 530.12 from products where sku='HID-029' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-030' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-031' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-032' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-033' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-034' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-035' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 530.12 from products where sku='HID-036' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-037' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-038' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 530.12 from products where sku='HID-039' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 530.12 from products where sku='HID-040' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-041' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-042' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 530.12 from products where sku='HID-043' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-044' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 472.7 from products where sku='HID-045' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 530.12 from products where sku='HID-046' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 80.04 from products where sku='APA-002' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 999.92 from products where sku='APA-001' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 2451 from products where sku='REL-001' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1260.92 from products where sku='IMP-001' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1512.64 from products where sku='IMP-002' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1512.64 from products where sku='IMP-003' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1512.64 from products where sku='IMP-004' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1512.64 from products where sku='IMP-005' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1512.64 from products where sku='IMP-006' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1512.64 from products where sku='IMP-007' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1512.64 from products where sku='IMP-008' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1512.64 from products where sku='IMP-009' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1512.64 from products where sku='IMP-010' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1512.64 from products where sku='IMP-011' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1512.64 from products where sku='IMP-012' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1512.64 from products where sku='IMP-013' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1512.64 from products where sku='IMP-014' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1512.64 from products where sku='IMP-015' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1512.64 from products where sku='IMP-016' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1260.92 from products where sku='IMP-017' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1260.92 from products where sku='IMP-018' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1260.92 from products where sku='IMP-019' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1260.92 from products where sku='IMP-020' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1260.92 from products where sku='IMP-021' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1260.92 from products where sku='IMP-022' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1260.92 from products where sku='IMP-023' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1260.92 from products where sku='IMP-024' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1260.92 from products where sku='IMP-025' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1260.92 from products where sku='IMP-026' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1260.92 from products where sku='IMP-027' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1260.92 from products where sku='IMP-028' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1260.92 from products where sku='IMP-029' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1260.92 from products where sku='IMP-030' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1260.92 from products where sku='IMP-031' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1260.92 from products where sku='IMP-032' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1260.92 from products where sku='IMP-033' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1260.92 from products where sku='IMP-034' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1260.92 from products where sku='IMP-035' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1260.92 from products where sku='IMP-036' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1512.64 from products where sku='IMP-037' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1260.92 from products where sku='IMP-038' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1512.64 from products where sku='IMP-039' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1512.64 from products where sku='IMP-040' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 234.32 from products where sku='TOX-005' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 386 from products where sku='TOX-004' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 30.06 from products where sku='PEE-001' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1107.8 from products where sku='TOX-006' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 187.34 from products where sku='SER-003' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 37.12 from products where sku='REL-010' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 13.34 from products where sku='APA-003' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 13.92 from products where sku='APA-004' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 13.92 from products where sku='APA-005' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 620.6 from products where sku='TOX-008' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 517.36 from products where sku='NEW-010' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 508.66 from products where sku='TOX-007' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 399.04 from products where sku='VIT-008' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 348 from products where sku='VIT-009' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 3229.79 from products where sku='NEW-011' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 3357.36 from products where sku='NEW-012' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 490 from products where sku='ANE-001' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 792.5 from products where sku='REL-009' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 843.5 from products where sku='REL-008' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 4197 from products where sku='MET-002' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 102 from products where sku='VIT-006' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 669.63 from products where sku='NEW-014' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 446.6 from products where sku='MET-001' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 1388.84 from products where sku='REL-002' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 182 from products where sku='VIT-002' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 383.96 from products where sku='VIT-010' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 2833 from products where sku='ULT-001' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 2833 from products where sku='ULT-002' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 3229.4 from products where sku='ELI-001' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 2833 from products where sku='ULT-003' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 2833 from products where sku='ULT-004' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 2833 from products where sku='ULT-005' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 2833 from products where sku='ULT-006' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 2833 from products where sku='ULT-007' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 3229.4 from products where sku='ELI-004' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 2833 from products where sku='ULT-008' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 2833 from products where sku='ULT-009' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 2833 from products where sku='ULT-010' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 2833 from products where sku='ULT-011' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 2833 from products where sku='ULT-012' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 2833 from products where sku='ULT-013' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 2833 from products where sku='ULT-014' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 2833 from products where sku='ULT-015' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 2833 from products where sku='ULT-016' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 2833 from products where sku='PEP-001' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 4000.9 from products where sku='ULT-017' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 2833 from products where sku='ULT-018' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 143.84 from products where sku='VIT-005' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 200 from products where sku='VIT-004' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 151.96 from products where sku='VIT-001' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 6358.5 from products where sku='MET-006' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 7714.2 from products where sku='MET-007' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 3022.01 from products where sku='MET-003' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 4987.02 from products where sku='MET-005' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 3800 from products where sku='MET-004' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 454.72 from products where sku='TOX-010' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 344.52 from products where sku='TOX-009' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 214.02 from products where sku='XEL-001' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 207.06 from products where sku='XEL-002' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 951.2 from products where sku='REL-007' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 873 from products where sku='XEL-003' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 968.6 from products where sku='REL-006' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 207.06 from products where sku='XEL-004' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 2717 from products where sku='TOX-002' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 33.06 from products where sku='AGU-FMC-01' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 33.06 from products where sku='AGU-FMC-02' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 33.06 from products where sku='AGU-FMC-03' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 33.06 from products where sku='AGU-FMC-04' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 33.06 from products where sku='AGU-FMC-05' on conflict (product_id) do nothing;
insert into product_costs(product_id,unit_cost) select id, 33.06 from products where sku='AGU-FMC-06' on conflict (product_id) do nothing;

-- 7) SELF-TEST
do $$
declare v_par int; v_self int; v_orph int; v_badsell int;
begin
  select count(*) into v_par from public.products where sku in ('PEP-002','PEP-003','PEP-004','PEP-005','AGU-FMC') and sellable=true;
  if v_par>0 then raise exception 'padre quedó sellable=true'; end if;
  select count(*) into v_self from public.products where parent_product_id=id; if v_self>0 then raise exception 'self-parent'; end if;
  select count(*) into v_orph from public.products c where c.parent_product_id is not null and not exists (select 1 from public.products p where p.id=c.parent_product_id); if v_orph>0 then raise exception 'parent huerfano'; end if;
  -- sellable=true exige precio operativo (products.price o product_prices)
  select count(*) into v_badsell from public.products pr where pr.sellable=true and pr.price is null and not exists (select 1 from public.product_prices pp where pp.product_id=pr.id);
  if v_badsell>0 then raise exception 'hay % products sellable=true sin precio operativo', v_badsell; end if;
end $$;
