-- ============================================================================
-- W2-C · C4 — CIERRE DE AUTORIDAD.
--
--  · La custodia legacy (events / consignment_stock) queda INERTE: sin escritura,
--    sin comandos, solo lectura. NO se elimina aquí — el DROP es C6, después de que
--    el frontend nuevo esté publicado y verificado (orden confirmado por el dueño).
--  · event_sell se revoca: era el único comando que mutaba el contador JSON.
--  · La custodia viva solo se escribe por los comandos de C3.
--
-- Las definiciones previas quedan en supabase/rollback/w2c/00_w2_snapshot.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) event_sell: fuera. Incrementaba events.items->sold sin op_id, sin bitácora,
--    sin inventario y sin dinero. Su reemplazo es vender_pos con p_custody_id.
-- ---------------------------------------------------------------------------
revoke all on function public.event_sell(uuid, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Contadores legacy INERTES. Eran client-authoritative: cualquier autenticado
--    escribía `events` (poniéndose en members) y su propio `consignment_stock`
--    (assigned/sold/lots). Se quedan de SOLO LECTURA hasta el DROP de C6.
-- ---------------------------------------------------------------------------
drop policy if exists events_all on public.events;
drop policy if exists consignment_all on public.consignment_stock;

revoke insert, update, delete, truncate on public.events, public.consignment_stock from anon, authenticated;

create policy events_select_legacy on public.events
  for select to authenticated using (public.auth_role() = any (array['admin','warehouse','packing']));
create policy consignment_select_legacy on public.consignment_stock
  for select to authenticated using (public.auth_role() = any (array['admin','warehouse','packing']));

comment on table public.events is
  'LEGACY INERTE (W2-C · C4): contadores JSON escritos por el cliente. Sin escritura ni comandos. La custodia viva es custodies + custody_lines. Se elimina en C6 tras verificar el frontend nuevo.';
comment on table public.consignment_stock is
  'LEGACY INERTE (W2-C · C4): saldo por (vendedor, producto) escrito por el propio vendedor. Sin escritura ni comandos. Se elimina en C6.';

-- ---------------------------------------------------------------------------
-- 3) Guardas internas de W2-C: no ejecutables por clientes.
-- ---------------------------------------------------------------------------
revoke all on function public.custodies_guard(), public._w2c_perdida(uuid, text, uuid, int, text, text, uuid)
  from public, anon, authenticated;
