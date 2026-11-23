// VERIFICARME EN EL CHAT · tarjeta dentro de la conversación: quien entró por el enlace crea su cuenta sin salir.
// Nombre, correo y celular ya están en su prerregistro; aquí da su cédula, su domicilio de entrega (opcional, igual que
// en la landing) y una contraseña. SIN-INE (23 nov 2026): ya no se piden fotos de la INE.
// La cuenta queda PENDIENTE: la aprueba una persona (su vendedor o Dirección) en esta misma conversación.
import React, { useEffect, useState } from 'react'
import { hasSupabase, supabase } from '../../lib/supabase'
import { adoptarVisitante, misDatos as leerPorDefecto, verificarme as enviarPorDefecto, type MisDatos } from '../../data/ops/visitante'

async function entrarPorDefecto(email: string, password: string): Promise<boolean> {
  if (!hasSupabase) return false
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return false
  await adoptarVisitante()           // la conversación del enlace pasa a su cuenta (mismo dispositivo)
  window.location.reload()           // el chat se vuelve a abrir ya con su cuenta
  return true
}

export function TarjetaVerificarme({ onCerrar, leer = leerPorDefecto, enviar = enviarPorDefecto, entrar = entrarPorDefecto }: {
  onCerrar: () => void; leer?: typeof leerPorDefecto; enviar?: typeof enviarPorDefecto; entrar?: (e: string, p: string) => Promise<boolean>
}) {
  const [datos, setDatos] = useState<MisDatos | null>(null)
  const [cedula, setCedula] = useState('')
  const [pass, setPass] = useState(''); const [pass2, setPass2] = useState('')
  const [dom, setDom] = useState({ line1: '', colonia: '', cp: '', city: '', state: '' })
  const campoDom = (k: keyof typeof dom) => (e: React.ChangeEvent<HTMLInputElement>) => { setDom((x) => ({ ...x, [k]: e.target.value })); setError(null) }
  const [error, setError] = useState<{ texto: string; cuenta?: boolean } | null>(null); const [enviando, setEnviando] = useState(false); const [lista, setLista] = useState(false)
  useEffect(() => { void leer().then((d) => { if (d) { setDatos(d); setCedula((c) => c || d.cedula || '') } }) }, [leer])
  const crear = async (e: React.FormEvent) => {
    e.preventDefault()
    if (enviando) return
    if (!/^[0-9]{5,12}$/.test(cedula.replace(/\s+/g, ''))) { setError({ texto: 'Escribe solo los números de tu cédula profesional.' }); return }
    if (dom.cp.trim() && !/^[0-9]{5}$/.test(dom.cp.trim())) { setError({ texto: 'El código postal debe tener 5 dígitos.' }); return }
    if (pass.length < 8) { setError({ texto: 'La contraseña debe tener al menos 8 caracteres.' }); return }
    if (pass !== pass2) { setError({ texto: 'Las contraseñas no coinciden.' }); return }
    setEnviando(true); setError(null)
    const r = await enviar({ cedula: cedula.replace(/\s+/g, ''), password: pass, domicilio: { ...dom, cp: dom.cp.trim() } })
    if (!r.ok) { setEnviando(false); setError({ texto: r.mensaje, cuenta: r.codigo === 'correo_con_cuenta' }); return }
    setLista(true)
    if (!(await entrar(r.email, pass))) setEnviando(false)
  }
  if (lista) return <div className="rc-pre-tarjeta rc-pre-enhilo" role="status" data-testid="verificarme-lista"><b>¡Listo! Tu cuenta quedó creada.</b><p>Revisaremos tu cédula aquí mismo; te avisaremos en esta conversación. Entrando con tu cuenta…</p></div>
  return (
    <form className="rc-pre-tarjeta rc-pre-enhilo" onSubmit={crear} noValidate data-testid="verificarme">
      <h1>Verificar mi cuenta</h1>
      <p>{datos ? <>Tu cuenta: <b>{datos.nombre}</b> · {datos.email} · {datos.telefono}. </> : null}Solo nos falta tu cédula y una contraseña.</p>
      <div className="rc-campo"><label htmlFor="vm-cedula">Cédula profesional</label><input id="vm-cedula" value={cedula} onChange={(e) => { setCedula(e.target.value); setError(null) }} inputMode="numeric" maxLength={20} placeholder="Solo números" /></div>
      <fieldset className="rc-campo rc-domicilio"><legend className="rc-campo-titulo">Domicilio de entrega <span className="rc-opcional">(opcional · para tus envíos)</span></legend>
        <input aria-label="Calle y número" value={dom.line1} onChange={campoDom('line1')} placeholder="Calle y número" maxLength={160} autoComplete="address-line1" />
        <div className="rc-domicilio-fila">
          <input aria-label="Colonia" value={dom.colonia} onChange={campoDom('colonia')} placeholder="Colonia" maxLength={80} />
          <input aria-label="Código postal" value={dom.cp} onChange={campoDom('cp')} placeholder="C.P." inputMode="numeric" maxLength={5} autoComplete="postal-code" data-testid="vm-cp" />
        </div>
        <div className="rc-domicilio-fila">
          <input aria-label="Ciudad" value={dom.city} onChange={campoDom('city')} placeholder="Ciudad" maxLength={80} autoComplete="address-level2" />
          <input aria-label="Estado" value={dom.state} onChange={campoDom('state')} placeholder="Estado" maxLength={80} autoComplete="address-level1" />
        </div>
      </fieldset>
      <div className="rc-campo"><label htmlFor="vm-pass">Contraseña</label><input id="vm-pass" type="password" autoComplete="new-password" value={pass} onChange={(e) => { setPass(e.target.value); setError(null) }} placeholder="Mínimo 8 caracteres" maxLength={72} /></div>
      <div className="rc-campo"><label htmlFor="vm-pass2">Repite la contraseña</label><input id="vm-pass2" type="password" autoComplete="new-password" value={pass2} onChange={(e) => { setPass2(e.target.value); setError(null) }} maxLength={72} /></div>
      {error && <div role="alert" className="rc-error rc-error--inline">{error.texto}{error.cuenta && <> <a href="/sistema">Iniciar sesión</a></>}</div>}
      <button type="submit" className="rc-pre-enviar" disabled={enviando} data-testid="vm-crear">{enviando ? 'Creando tu cuenta…' : 'Crear mi cuenta y enviar a revisión'}</button>
      <p className="rc-pre-nota"><button type="button" className="rc-link" onClick={onCerrar}>Ahora no</button></p>
    </form>
  )
}
