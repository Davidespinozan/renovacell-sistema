-- W6-A3 · EXPERIMENTO (la corrección del dueño): ¿qué persiste cuando una función de cron
-- escribe un latido y después falla? Esto decide la arquitectura de la salud del cron.
--
-- pg_cron ejecuta el comando del job en UNA transacción. Dentro de plpgsql, un bloque
-- BEGIN … EXCEPTION es una subtransacción: lo que hace el bloque se revierte al fallar,
-- pero lo que se escribió ANTES del bloque y lo que escribe el MANEJADOR persisten si la
-- función termina sin relanzar. Si relanza, se pierde todo (incluido "ultimo_error").
begin;
create temp table latido_exp (k text primary key, v text) on commit drop;
create temp table trabajo_exp (x int) on commit drop;

-- A) UPDATE + RAISE en la misma función: el UPDATE se revierte.
create function pg_temp.escribe_y_lanza() returns void language plpgsql as $$
begin
  insert into latido_exp values ('ultimo_error', 'perdido');
  raise exception 'falla simulada';
end $$;
do $t$
begin
  begin
    perform pg_temp.escribe_y_lanza();
  exception when others then null;
  end;
  perform tests.eq((select count(*)::int from latido_exp where k = 'ultimo_error'), 0,
    'A) escribir ultimo_error y luego RAISE: el UPDATE NO persiste (revertido con la excepción)');
end $t$;

-- B) Patrón adoptado: escribir ANTES del bloque y en el MANEJADOR, sin relanzar.
create function pg_temp.trabajo_que_falla() returns int language plpgsql as $$
begin
  insert into trabajo_exp values (1);
  raise exception 'el trabajo falló a la mitad';
end $$;
create function pg_temp.corre_con_latido() returns text language plpgsql as $$
declare n int;
begin
  insert into latido_exp values ('inicio', 'si');
  begin
    n := pg_temp.trabajo_que_falla();
    insert into latido_exp values ('ultimo_ok', 'si');
  exception when others then
    insert into latido_exp values ('ultimo_error', left(sqlerrm, 200));
  end;
  return 'termino';
end $$;
do $t$
begin
  perform pg_temp.corre_con_latido();
  perform tests.eq((select v from latido_exp where k = 'ultimo_error'), 'el trabajo falló a la mitad',
    'B) el manejador SÍ persiste ultimo_error cuando la función no relanza');
  perform tests.eq((select count(*)::int from trabajo_exp), 0,
    'B) y el trabajo a medias se revierte por completo (subtransacción): nunca hay "mitad"');
  perform tests.ok(exists (select 1 from latido_exp where k = 'inicio'), 'B) lo escrito antes del bloque persiste');
  perform tests.ok(not exists (select 1 from latido_exp where k = 'ultimo_ok'), 'B) ultimo_ok NO se marca: el OK se escribe solo después del trabajo');
end $t$;

-- C) Si el propio latido falla en el manejador, la excepción sube: el job queda "failed"
--    en cron.job_run_details y NADA de la función persiste. Esa es la segunda fuente.
create function pg_temp.corre_latido_roto() returns text language plpgsql as $$
begin
  insert into latido_exp values ('inicio2', 'si');
  begin
    raise exception 'trabajo';
  exception when others then
    insert into latido_exp values ('inicio2', 'duplicado');   -- viola la PK: el latido falla
  end;
  return 'nunca';
end $$;
do $t$
declare v_msg text;
begin
  begin
    perform pg_temp.corre_latido_roto();
    v_msg := 'sin excepción';
  exception when others then v_msg := sqlerrm;
  end;
  perform tests.ok(v_msg like '%duplicate key%', 'C) un latido roto propaga la excepción (lo registra pg_cron)');
  perform tests.ok(not exists (select 1 from latido_exp where k = 'inicio2'), 'C) y entonces no persiste nada de esa corrida');
end $t$;
rollback;
