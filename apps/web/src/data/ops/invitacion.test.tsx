// @vitest-environment jsdom
// INVITACIONES · enlace con el secreto en el fragmento, validación, errores, correo, WhatsApp, y las dos pantallas:
// el botón de la ficha (personal) y la página donde el cliente crea su cuenta.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { enlaceInvitacion, validarAceptacion, mapearErrorInvitacion } from '../../../../../supabase/functions/_shared/invitacion'
import { correoInvitacion } from '../../../../../supabase/functions/_shared/plantillas'
import { LIMITES } from '../../../../../supabase/functions/_shared/limite'
import edge from '../../../../../supabase/functions/invitacion/index.ts?raw'
import mig from '../../../../../supabase/migrations/20261206120000_invitaciones_clientes.sql?raw'
import netlify from '../../../../../netlify.toml?raw'
import invHtml from '../../../invitacion.html?raw'
import { crearInvitacion, whatsappInvitacion } from './invitacion'
import { InvitarCliente } from '../../app/InvitarCliente'
import { Invitacion } from '../../screens/Invitacion'

afterEach(cleanup)
const T = 'A'.repeat(43)

describe('INVITACIONES · lógica del servidor', () => {
  it('el secreto va en el fragmento (#), nunca en la ruta ni en la consulta', () => {
    expect(enlaceInvitacion(T)).toBe(`https://sistema.renovacell.mx/invitacion#${T}`)
    expect(enlaceInvitacion(T, 'http://localhost:5173/')).toBe(`http://localhost:5173/invitacion#${T}`)
  })
  it('valida correo, contraseña (8 a 72) y aviso de privacidad', () => {
    expect(validarAceptacion({ email: ' A@B.MX ', password: '12345678', consent: true })).toEqual({ ok: true, email: 'a@b.mx', password: '12345678' })
    expect(validarAceptacion({ email: 'a@', password: '12345678', consent: true })).toMatchObject({ ok: false, campo: 'email' })
    expect(validarAceptacion({ email: 'a@b.mx', password: 'corta', consent: true })).toMatchObject({ ok: false, campo: 'password' })
    expect(validarAceptacion({ email: 'a@b.mx', password: '12345678', consent: 'si' })).toMatchObject({ ok: false, campo: 'consentimiento' })
  })
  it('errores de la base → mensajes para la persona, sin detalles internos', () => {
    expect(mapearErrorInvitacion('INVITACION_EXPIRADA').body.message).toMatch(/venció/)
    expect(mapearErrorInvitacion('YA_TIENE_CUENTA: x').body.error).toBe('ya_tiene_cuenta')
    expect(mapearErrorInvitacion('NO_AUTORIZADO: x').status).toBe(403)
    expect(mapearErrorInvitacion('duplicate key value').body.message).not.toMatch(/duplicate/)
  })
  it('el correo lleva el nombre escapado y el enlace', () => {
    const c = correoInvitacion('Dra. <b>Ruiz</b>', 'https://x/invitacion#t')
    expect(c.html).not.toMatch(/<b>Ruiz/); expect(c.texto).toMatch(/https:\/\/x\/invitacion#t/); expect(c.asunto).toBe('Tu cuenta en Renovacell')
  })
  it('la función: crear usa el JWT del que invita (la base decide), y aceptar borra la cuenta si la base rechaza', () => {
    expect(edge).toMatch(/caller\.rpc\('cliente_invitacion_crear'/)
    expect(edge).toMatch(/if \(eLigar\) \{\s*\n\s*await admin\.auth\.admin\.deleteUser\(uid\)/)
    expect(edge.indexOf("admin.rpc('cliente_invitacion_ver'")).toBeLessThan(edge.indexOf('admin.auth.admin.createUser'))
    expect(LIMITES.invitacion_aceptar.limite).toBeLessThanOrEqual(10)
  })
  it('en la base: solo se guarda la huella, sin políticas, y aceptar es solo del servidor', () => {
    expect(mig).toMatch(/token_hash   text not null unique/); expect(mig).not.toMatch(/create policy/i)
    expect(mig).toMatch(/grant execute on function public\.cliente_invitacion_aceptar\(text, uuid\) to service_role;/)
    expect(mig).toMatch(/if not public\._cc_es_service\(\) then raise exception 'NO_AUTORIZADO'/)
  })
  it('la página tiene su propio título del negocio y su regla en Netlify', () => {
    expect(invHtml).toMatch(/<title>Renovacell · Crea tu cuenta<\/title>/); expect(invHtml).not.toMatch(/sistema operativo/i)
    expect(netlify).toMatch(/from = "\/invitacion"\s*\n\s*to = "\/invitacion\.html"/)
  })
})

describe('INVITACIONES · cliente', () => {
  it('crear manda solo el cliente y si va por correo', async () => {
    const invocar = vi.fn().mockResolvedValue({ data: { enlace: 'e', expira_at: 'x', nombre: 'N', email: null, telefono: null, correo: 'no_pedido' }, error: null })
    await crearInvitacion('C1', { correo: true }, invocar)
    expect(invocar).toHaveBeenCalledWith('invitacion', { body: { action: 'crear', customer_id: 'C1', correo: true, email: null } })
  })
  it('WhatsApp: con celular de 10 dígitos abre el chat de esa persona; sin él, eliges a quién', () => {
    expect(whatsappInvitacion('Ana', 'https://e', '669 111 2222')).toMatch(/^https:\/\/wa\.me\/526691112222\?text=/)
    expect(whatsappInvitacion('Ana', 'https://e', null)).toMatch(/^https:\/\/wa\.me\/\?text=/)
    expect(decodeURIComponent(whatsappInvitacion('Ana', 'https://e', null))).toMatch(/Hola Ana.*https:\/\/e$/)
  })
})

describe('INVITACIONES · pantallas', () => {
  it('ficha: genera la invitación y ofrece WhatsApp, copiar y correo; avisa si el correo no está configurado', async () => {
    const crear = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { enlace: 'https://s/invitacion#t1', expira_at: 'x', nombre: 'Dra. Ruiz', email: 'r@x.mx', telefono: '6691112222', correo: 'no_pedido' } })
      .mockResolvedValueOnce({ ok: true, data: { enlace: 'https://s/invitacion#t2', expira_at: 'x', nombre: 'Dra. Ruiz', email: 'r@x.mx', telefono: '6691112222', correo: 'no_configurado' } })
    render(<InvitarCliente customerId="C1" crear={crear} />)
    fireEvent.click(screen.getByTestId('btn-invitar'))
    await screen.findByTestId('invitacion-lista')
    expect((screen.getByTestId('invitar-whatsapp') as HTMLAnchorElement).href).toMatch(/wa\.me\/526691112222/)
    fireEvent.click(screen.getByTestId('invitar-correo'))
    await waitFor(() => expect(screen.getByTestId('invitar-aviso').textContent).toMatch(/no está configurado/))
    expect(crear.mock.calls[1]).toEqual(['C1', { correo: true }])
  })
  it('página: con invitación válida crea la cuenta y entra; valida contraseñas y aviso antes de enviar', async () => {
    const ver = vi.fn().mockResolvedValue({ ok: true, data: { estado: 'valida', nombre: 'Dra. Ruiz', email: 'r@x.mx' } })
    const aceptar = vi.fn().mockResolvedValue({ ok: true, data: { ok: true, email: 'r@x.mx' } })
    const iniciar = vi.fn().mockResolvedValue(false)
    render(<Invitacion token={T} ver={ver} aceptar={aceptar} iniciar={iniciar} />)
    await screen.findByTestId('invitacion-form')
    expect(screen.getByText(/Hola, Dra\. Ruiz/)).toBeTruthy(); expect((screen.getByLabelText('Correo') as HTMLInputElement).value).toBe('r@x.mx')
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: '12345678' } })
    fireEvent.change(screen.getByLabelText('Repite la contraseña'), { target: { value: '1234567x' } })
    fireEvent.click(screen.getByTestId('inv-crear'))
    expect(screen.getByRole('alert').textContent).toMatch(/no coinciden/)
    fireEvent.change(screen.getByLabelText('Repite la contraseña'), { target: { value: '12345678' } })
    fireEvent.click(screen.getByTestId('inv-crear'))
    expect(screen.getByRole('alert').textContent).toMatch(/Aviso de privacidad/); expect(aceptar).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('inv-acepta')); fireEvent.click(screen.getByTestId('inv-crear'))
    await screen.findByTestId('invitacion-lista')
    expect(aceptar).toHaveBeenCalledWith(T, 'r@x.mx', '12345678'); expect(iniciar).toHaveBeenCalledWith('r@x.mx', '12345678')
  })
  it('página: invitación vencida o usada lo explica y ofrece iniciar sesión', async () => {
    render(<Invitacion token={T} ver={async () => ({ ok: true, data: { estado: 'expirada', message: 'Esta invitación venció.' } })} />)
    expect((await screen.findByTestId('invitacion-invalida')).textContent).toMatch(/venció/)
    cleanup()
    render(<Invitacion token="" />)
    expect((await screen.findByTestId('invitacion-invalida')).textContent).toMatch(/incompleto/)
  })
})
