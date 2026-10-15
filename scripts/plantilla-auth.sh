#!/usr/bin/env bash
# Copia al portapapeles una plantilla de correo de Supabase Auth (para pegarla en Authentication → Emails → Templates).
# Uso: ./scripts/plantilla-auth.sh recovery|invite|email_change|confirmation
set -euo pipefail
cd "$(dirname "$0")/.."
F="supabase/templates/auth/${1:-}.html"
[ -f "$F" ] || { echo "Uso: $0 recovery | invite | email_change | confirmation"; exit 1; }
pbcopy < "$F"
case "$1" in
  recovery) A='Restablece tu contraseña de Renovacell';; invite) A='Te invitamos a Renovacell';;
  email_change) A='Confirma tu nuevo correo en Renovacell';; confirmation) A='Confirma tu cuenta de Renovacell';;
esac
echo "Copiada la plantilla '$1'. Asunto (Subject): $A"
