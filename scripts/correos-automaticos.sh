#!/usr/bin/env bash
# Activa el envío AUTOMÁTICO de los correos al cliente (migración 165): crea un secreto nuevo y lo guarda en los dos
# lados (Supabase Edge: CORREOS_CRON_SECRET · Vault de la base: comm_cron_secret) junto con la URL del proyecto.
# El secreto nunca se muestra. Volver a correrlo lo rota.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . supabase/.env.local; set +a
: "${SUPABASE_URL:?falta SUPABASE_URL en supabase/.env.local}"
SECRETO="$(node -e "process.stdout.write(require('crypto').randomBytes(36).toString('base64url'))")"
ENV_FILE="$(mktemp)"; trap 'rm -f "$ENV_FILE"' EXIT
printf 'CORREOS_CRON_SECRET=%s\n' "$SECRETO" > "$ENV_FILE"
supabase secrets set --env-file "$ENV_FILE"
PGPASSWORD="$SUPABASE_DB_PASSWORD" psql "$(cat supabase/.temp/pooler-url)" -v ON_ERROR_STOP=1 -q \
  -v secreto="$SECRETO" -v url="$SUPABASE_URL" <<'SQL'
select set_config('rc.secreto', :'secreto', false), set_config('rc.url', :'url', false) \g /dev/null
do $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'comm_cron_secret';
  if v_id is null then perform vault.create_secret(current_setting('rc.secreto'), 'comm_cron_secret', 'Correos automáticos: secreto de la tarea programada');
  else perform vault.update_secret(v_id, current_setting('rc.secreto')); end if;
  select id into v_id from vault.secrets where name = 'project_url';
  if v_id is null then perform vault.create_secret(current_setting('rc.url'), 'project_url', 'URL del proyecto para las tareas programadas');
  else perform vault.update_secret(v_id, current_setting('rc.url')); end if;
end $$;
SQL
echo "Envío automático de correos activado (el secreto no se mostró). Salen cada minuto."
