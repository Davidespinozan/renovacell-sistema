// W6-A1 · QUIÉN LLAMA — identidad y autoridad del llamante para las Edge Functions.
//
// Antes cada función resolvía el rol por su cuenta (`select role_id from profiles`) y
// ninguna miraba si la cuenta seguía activa: un empleado suspendido conservaba, desde
// una sesión viva, todo lo que su rol permitía en el servidor. Este módulo es la ÚNICA
// forma de resolver al llamante: sesión válida, perfil existente y cuenta activa.
//
// Sin dependencias de Deno: recibe los clientes ya construidos para poder probarse.

export interface Quien {
  uid: string
  email: string | null
  role: string            // '' si no hay perfil
  active: boolean
  full_name: string | null
  meta: Record<string, unknown>
}
export type Resuelto = { ok: true; quien: Quien } | { ok: false; status: number; body: { error: string; message?: string } }

export const CUENTA_SUSPENDIDA = 'CUENTA_SUSPENDIDA'

interface ClienteAuth { auth: { getUser: () => Promise<{ data: { user: { id: string; email?: string } | null } }> } }
interface ClienteAdmin {
  from: (t: string) => {
    select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }> } }
  }
}

/** Resuelve al llamante. 401 sin sesión; 403 CUENTA_SUSPENDIDA si está suspendido. */
export async function resolverQuien(caller: ClienteAuth, admin: ClienteAdmin): Promise<Resuelto> {
  const { data: who } = await caller.auth.getUser()
  if (!who?.user) return { ok: false, status: 401, body: { error: 'No autenticado.' } }
  const { data: p, error } = await admin.from('profiles').select('role_id, active, full_name, meta, email').eq('id', who.user.id).maybeSingle()
  // Falla cerrado: si el perfil no se pudo leer, no se asume ningún rol.
  if (error) return { ok: false, status: 500, body: { error: 'No se pudo verificar la cuenta.' } }
  const active = p ? p.active !== false : true
  if (p && !active) {
    return { ok: false, status: 403, body: { error: CUENTA_SUSPENDIDA, message: 'Tu acceso fue suspendido por Dirección.' } }
  }
  return {
    ok: true,
    quien: {
      uid: who.user.id,
      email: (p?.email as string | null | undefined) ?? who.user.email ?? null,
      role: (p?.role_id as string | null | undefined) ?? '',
      active,
      full_name: (p?.full_name as string | null | undefined) ?? null,
      meta: ((p?.meta ?? {}) as Record<string, unknown>),
    },
  }
}

/** ¿El rol del llamante está en la lista? (vacío = sin perfil = nunca). */
export const tieneRol = (q: Quien, roles: readonly string[]): boolean => q.role !== '' && roles.includes(q.role)
