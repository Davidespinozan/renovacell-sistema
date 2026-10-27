-- R4-C10 · APROBACIÓN del Manual de ventas autorizada por el dueño ("tú dime, yo confío en ti", 27 oct 2026). Una transacción.
-- Ajuste previo: devoluciones sin prometer "reposición o reembolso" (el ERP no respalda la política). Se exige 0 claims
-- prohibidos (misma regla que cc_empresa_aprobar) y se deja el evento de aprobación en la bitácora del conocimiento.
begin;
update public.cc_company_knowledge set contenido = replace(contenido, 'Un asesor lo revisa y te da solución: reposición o reembolso.', 'Un asesor lo revisa y te da solución.'), rev = rev + 1, updated_at = now()
 where tema = 'devoluciones' and titulo = 'Devoluciones y garantías' and estado = 'draft' and contenido like '%reposición o reembolso%';
do $a$
declare r record; n int := 0;
begin
  if exists (select 1 from public.cc_company_knowledge where estado = 'draft' and contenido ilike '%[COMPLETAR%') then raise exception 'ALTO: hay borradores con [COMPLETAR'; end if;
  if exists (select 1 from public.cc_company_knowledge k, jsonb_array_elements(public.cc_revisar_claims(k.titulo || ' ' || k.contenido)) x where k.estado = 'draft' and x ->> 'tipo' = 'prohibido') then raise exception 'ALTO: claim prohibido'; end if;
  for r in select id, version from public.cc_company_knowledge where estado = 'draft' order by tema loop
    update public.cc_company_knowledge set estado = 'approved', approved_at = now() where id = r.id;
    perform public._cc_evento_k('empresa', r.id, 'aprobar', r.version, jsonb_build_object('autorizado_por', 'dueño (vía Claude, R4-C10)'));
    n := n + 1;
  end loop;
  if n <> 9 then raise exception 'ALTO: se esperaban 9 borradores, hay %', n; end if;
end $a$;
select jsonb_agg(jsonb_build_object('tema', tema, 'estado', estado) order by tema) as manual from public.cc_company_knowledge;
commit;
