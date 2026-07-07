// Lógica de mutación de los stores en modo MOCK (deterministas, sin red). Se
// asertan los ITEMS creados/afectados (no totales) porque el estado del módulo es
// singleton compartido entre tests.
import { describe, it, expect } from 'vitest'
import * as resources from './resourcesStore'
import * as calendar from './calendarStore'
import * as notifs from './notificationsStore'
import * as team from './teamStore'

describe('resourcesStore', () => {
  it('addRequest agrega una solicitud', () => {
    const r = resources.addRequest({ title: 'Arte X', description: 'd', requestedBy: 'Lucía' })
    expect(resources.getSnapshot().some((x) => x.id === r.id && x.status === 'solicitado')).toBe(true)
  })
  it('setStatus cambia el estatus', () => {
    const r = resources.addRequest({ title: 'Arte Y', description: 'd', requestedBy: 'Lucía' })
    resources.setStatus(r.id, 'en_proceso')
    expect(resources.getSnapshot().find((x) => x.id === r.id)?.status).toBe('en_proceso')
  })
  it('deliver adjunta la URL y marca entregado', () => {
    const r = resources.addRequest({ title: 'Arte Z', description: 'd', requestedBy: 'Lucía' })
    resources.deliver(r.id, 'http://x/asset.png')
    const got = resources.getSnapshot().find((x) => x.id === r.id)
    expect(got?.status).toBe('entregado')
    expect(got?.assetUrl).toBe('http://x/asset.png')
  })
})

describe('calendarStore', () => {
  it('addEntry agrega un compromiso', () => {
    const e = calendar.addEntry({ title: 'Entrega A', date: '2026-08-01', kind: 'entrega' })
    expect(calendar.getSnapshot().some((x) => x.id === e.id)).toBe(true)
  })
  it('toggleDone alterna listo/planeado', () => {
    const e = calendar.addEntry({ title: 'Entrega B', date: '2026-08-02', kind: 'produccion' })
    calendar.toggleDone(e.id)
    expect(calendar.getSnapshot().find((x) => x.id === e.id)?.status).toBe('listo')
    calendar.toggleDone(e.id)
    expect(calendar.getSnapshot().find((x) => x.id === e.id)?.status).toBe('planeado')
  })
  it('removeEntry lo elimina', () => {
    const e = calendar.addEntry({ title: 'Entrega C', date: '2026-08-03', kind: 'campana' })
    calendar.removeEntry(e.id)
    expect(calendar.getSnapshot().some((x) => x.id === e.id)).toBe(false)
  })
})

describe('notificationsStore', () => {
  it('notify agrega una notificación sin leer', () => {
    notifs.notify({ text: 'Aviso QA único 123', roles: ['admin'] })
    const n = notifs.getSnapshot().find((x) => x.text === 'Aviso QA único 123')
    expect(n).toBeTruthy()
    expect(n?.read).toBe(false)
  })
  it('markRead marca una como leída', () => {
    notifs.notify({ text: 'Aviso QA leer 456', roles: ['admin'] })
    const n = notifs.getSnapshot().find((x) => x.text === 'Aviso QA leer 456')!
    notifs.markRead(n.id)
    expect(notifs.getSnapshot().find((x) => x.id === n.id)?.read).toBe(true)
  })
  it('markAllRead marca todas las visibles', () => {
    notifs.notify({ text: 'Aviso QA todas 789', roles: ['admin'] })
    const ids = notifs.getSnapshot().map((x) => x.id)
    notifs.markAllRead(ids)
    expect(notifs.getSnapshot().every((x) => x.read)).toBe(true)
  })
})

describe('teamStore', () => {
  it('addUser agrega un staff nuevo (con contraseña)', async () => {
    const r = await team.addUser({ name: 'Nuevo Staff', role: 'warehouse', email: 'nuevo.staff@renovacell.mx', password: 'clave123' })
    expect(r.ok).toBe(true)
    expect(team.userByEmail('nuevo.staff@renovacell.mx')?.name).toBe('Nuevo Staff')
  })
  it('addUser rechaza contraseña corta', async () => {
    const r = await team.addUser({ name: 'Corta', role: 'pos', email: 'corta@renovacell.mx', password: '123' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/6 caracteres/)
  })
  it('addUser rechaza correo duplicado', async () => {
    await team.addUser({ name: 'Dup', role: 'pos', email: 'dup@renovacell.mx', password: 'clave123' })
    const r = await team.addUser({ name: 'Dup 2', role: 'pos', email: 'dup@renovacell.mx', password: 'clave123' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Ya existe/)
  })
  it('toggleCapability prende y apaga una responsabilidad', async () => {
    await team.addUser({ name: 'Cap User', role: 'warehouse', email: 'cap.user@renovacell.mx', password: 'clave123' })
    const id = team.userByEmail('cap.user@renovacell.mx')!.id
    team.toggleCapability(id, 'diseno')
    expect(team.getSnapshot().find((u) => u.id === id)?.capabilities).toContain('diseno')
    team.toggleCapability(id, 'diseno')
    expect(team.getSnapshot().find((u) => u.id === id)?.capabilities).not.toContain('diseno')
  })
  it('setActive suspende y reactiva el acceso', async () => {
    await team.addUser({ name: 'Susp User', role: 'pos', email: 'susp.user@renovacell.mx', password: 'clave123' })
    const id = team.userByEmail('susp.user@renovacell.mx')!.id
    team.setActive(id, false)
    expect(team.isActive('susp.user@renovacell.mx')).toBe(false)
    team.setActive(id, true)
    expect(team.isActive('susp.user@renovacell.mx')).toBe(true)
  })
  it('updateUser cambia nombre y rol', async () => {
    await team.addUser({ name: 'Editable', role: 'warehouse', email: 'edit@renovacell.mx', password: 'clave123' })
    const id = team.userByEmail('edit@renovacell.mx')!.id
    await team.updateUser(id, { name: 'Editado', role: 'pos' })
    const u = team.getSnapshot().find((x) => x.id === id)
    expect(u?.name).toBe('Editado')
    expect(u?.role).toBe('pos')
  })
  it('removeUser lo elimina de la lista', async () => {
    await team.addUser({ name: 'Borrable', role: 'pos', email: 'borrar@renovacell.mx', password: 'clave123' })
    const id = team.userByEmail('borrar@renovacell.mx')!.id
    await team.removeUser(id)
    expect(team.getSnapshot().some((x) => x.id === id)).toBe(false)
  })
})
