-- IA EXAMEN COLA (20270303) · crear encola los casos; el cron los manda a la Edge con el secreto (de a 8, reintenta lo que
-- no regresa y al tercer intento lo registra como fallo); registrar saca de la cola y cierra la corrida; continuar y detener.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); v_doc uuid := tests.user('doctor'); v_corr uuid; n int; r jsonb;
begin
  perform tests.act_as_owner();
  insert into vault.decrypted_secrets (name, decrypted_secret) values ('project_url', 'http://127.0.0.1:54321'), ('comm_cron_secret', repeat('c', 40)) on conflict (name) do nothing;
  perform tests.act_as(v_admin);
  v_corr := public.ia_examen_crear('claude-opus-5-5', v_doc, 'low', array['P01', 'P02', 'C04']);
  perform tests.act_as_service();
  perform tests.ok((select count(*) from public.cc_ia_examen_cola where corrida_id = v_corr) = 3 and (select estado from public.cc_ia_examen_corridas where id = v_corr) = 'en_curso', '1 · crear encola sus casos');

  -- ══ 2 · el cron los manda con el secreto ══
  perform tests.act_as_owner();
  n := public.ia_examen_despachar();
  perform tests.eq(n, 3, '2 · manda los tres');
  perform tests.ok((select count(*) from net._llamadas where url like '%/functions/v1/ia-examen' and headers ? 'x-cron-secret' and (body ->> 'corrida_id')::uuid = v_corr) = 3, '2 · a la Edge del examen con el secreto del cron');
  perform tests.eq(public.ia_examen_despachar(), 0, '2 · en vuelo no se vuelven a mandar');

  -- ══ 3 · la Edge registra: sale de la cola; al terminar, la corrida queda terminada ══
  perform tests.act_as_service();
  perform public.ia_examen_registrar(v_corr, 'P01', '{"respuesta":"ok","estado":"respondio","puntaje":8,"aprobado":true}');
  perform tests.ok(not exists (select 1 from public.cc_ia_examen_cola where corrida_id = v_corr and caso_id = 'P01'), '3 · registrar saca de la cola');
  -- un caso que no regresa: tras 3 intentos se registra como fallo
  update public.cc_ia_examen_cola set tomado_at = now() - interval '5 minutes', intentos = 3 where corrida_id = v_corr and caso_id = 'P02';
  perform tests.act_as_owner(); perform public.ia_examen_despachar(); perform tests.act_as_service();
  perform tests.ok((select estado from public.cc_ia_examen_resultados where corrida_id = v_corr and caso_id = 'P02') = 'fallo', '3 · tres intentos sin regresar: fallo registrado');
  perform public.ia_examen_registrar(v_corr, 'C04', '{"respuesta":"ok","estado":"respondio","puntaje":9,"aprobado":true}');
  perform tests.ok((select estado from public.cc_ia_examen_corridas where id = v_corr) = 'terminada', '3 · sin pendientes: terminada');

  -- ══ 4 · continuar lo que no tiene respuesta; detener ══
  perform tests.act_as(v_admin);
  perform tests.eq(public.ia_examen_continuar(v_corr), 1, '4 · continuar vuelve a encolar el que falló');
  r := public.ia_examen_corridas() -> 0;
  perform tests.ok(r ->> 'estado' = 'en_curso' and (r ->> 'pendientes')::int = 1, '4 · resumen con estado y pendientes');
  perform public.ia_examen_detener(v_corr);
  r := public.ia_examen_corridas() -> 0;
  perform tests.ok(r ->> 'estado' = 'detenida' and (r ->> 'pendientes')::int = 0, '4 · detener vacía la cola');
  perform tests.ok(not has_function_privilege('authenticated', 'public.ia_examen_despachar()', 'EXECUTE'), '5 · el despachador es del servidor');
  perform tests.act_as_owner(); perform tests.ok(exists (select 1 from cron.job where jobname = 'renovacell-ia-examen' and active), '5 · cron activo');
end $t$;
rollback;
