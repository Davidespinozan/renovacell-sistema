#!/usr/bin/env bash
# Genera las llaves de los AVISOS PUSH (VAPID) y las guarda como secretos de Supabase SIN mostrar la llave privada.
# Úsalo una sola vez: cambiar las llaves obliga a que cada dispositivo vuelva a "Activar avisos".
set -euo pipefail
ENV_FILE="$(mktemp)"; trap 'rm -f "$ENV_FILE"' EXIT
node -e "
const c = require('crypto'); const e = c.createECDH('prime256v1'); e.generateKeys();
const k = e.getPrivateKey(); const priv = Buffer.concat([Buffer.alloc(32 - k.length), k]);
const b = (x) => x.toString('base64url');
process.stdout.write('VAPID_PUBLIC_KEY=' + b(e.getPublicKey()) + '\nVAPID_PRIVATE_KEY=' + b(priv) + '\nVAPID_SUBJECT=' + (process.argv[1] || 'mailto:contacto@renovacell.mx') + '\n');
" "${1:-mailto:contacto@renovacell.mx}" > "$ENV_FILE"
supabase secrets set --env-file "$ENV_FILE"
echo "Llaves de avisos guardadas en Supabase (la privada no se mostró)."
