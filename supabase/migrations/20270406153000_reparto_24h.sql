-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- REPARTO 24 H (14–15 nov 2026, dueño: "tiene que durar 24 horas, el vendedor debe tener 24 horas para responder").
-- El reloj del reparto cuenta MINUTOS HÁBILES (horario L–S 10–18 = 8 h por día): 480 hábiles = hasta la misma hora del
-- siguiente día hábil (≈ 24 h reales, sin contar noches ni domingo). Antes: 5 min (asesoría sin vendedor) y 240 min
-- (verificación sin responsable).
--   · reparto_min        5   → 480   asesoría sin vendedor: tiempo antes de pasar al siguiente vendedor
--   · verif_reparto_min  240 → 480   verificación de doctor sin responsable: igual
--   · solicitud_expira_min 1440 → 4320 (minutos REALES): la solicitud sin atender ya no se cierra antes de que el vendedor
--     tenga su día completo (una del sábado en la tarde se cerraba el domingo).
-- Solo datos de configuración; Dirección lo puede volver a ajustar en Equipo → Cartera y horario.
-- Reversa: update public.cc_atencion_config set reparto_min = 5, verif_reparto_min = 240, solicitud_expira_min = 1440 where id = 1;
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
update public.cc_atencion_config
   set reparto_min = 480, verif_reparto_min = 480, solicitud_expira_min = 4320, updated_at = now()
 where id = 1;

do $post$ begin
  if not exists (select 1 from public.cc_atencion_config where id = 1 and reparto_min = 480 and verif_reparto_min = 480 and solicitud_expira_min = 4320) then
    raise exception 'REPARTO-24H: no quedó aplicada'; end if;
end $post$;
