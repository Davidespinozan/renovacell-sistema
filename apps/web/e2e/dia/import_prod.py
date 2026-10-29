import json, subprocess, sys
ORDER = "price_lists products product_volume_prices product_fiscal company_settings company_bank_accounts entrega_config entrega_horarios empaques cc_atencion_config cc_horario_config cc_horario_semanal cc_claim_rules pagos_config fiscal_series landing_content cc_company_knowledge cc_knowledge_config promociones promocion_lineas".split()
sql = ["set session_replication_role = replica;"]
for t in ORDER:
    rows = json.load(open(f"prod/{t}.json"))[0]["coalesce"]
    data = json.dumps(rows).replace("$J$", "")
    sql.append(f"""do $d$ declare cols text; begin
  select string_agg(quote_ident(attname), ',' order by attnum) into cols from pg_attribute
   where attrelid = 'public.{t}'::regclass and attnum > 0 and not attisdropped and attgenerated = '' and attidentity <> 'a';
  execute 'delete from public.{t}';
  execute format('insert into public.{t} (%s) overriding system value select %s from json_populate_recordset(null::public.{t}, $1)', cols, cols) using $J${data}$J$::json;
end $d$;""")
sql.append("set session_replication_role = origin;")
open("import_prod.sql","w").write("\n".join(sql))
