// VERIFICARME EN EL CHAT · tarjeta dentro de la conversación: quien entró por el enlace crea su cuenta sin salir.
// Nombre, correo y celular ya están en su prerregistro; aquí solo da su cédula, las fotos del INE y una contraseña.
// La cuenta queda PENDIENTE: la aprueba una persona (su vendedor o Dirección) en esta misma conversación.
import React, { useEffect, useState } from 'react'
import { hasSupabase, supabase } from '../../lib/supabase'
import { adoptarVisitante, misDatos as leerPorDefecto, verificarme as enviarPorDefecto, type MisDatos } from '../../data/ops/visitante'
import { reducirFoto } from '../../data/ops/verificacion'

async function entrarPorDefecto(email: string, password: string): Promise<boolean> {
  if (!hasSupabase) return false
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return false
  await adoptarVisitante()           // la conversación del enlace pasa a su cuenta (mismo dispositivo)
  window.location.reload()           // el chat se vuelve a abrir ya con su cuenta
  return true
}

export function TarjetaVerificarme({ onCerrar, leer = leerPorDefecto, enviar = enviarPorDefecto, entrar = entrarPorDefecto, reducir = reducirFoto }: {
  onCerrar: () => void; leer?: typeof leerPorDefecto; enviar?: typeof enviarPorDefecto; entrar?: (e: string, p: string) => Promise<boolean>; reducir?: (f: File) => Promise<string | null>
}) {
  const [datos, setDatos] = useState<MisDatos | null>(null)
  const [cedula, setCedula] = useState(''); const [frente, setFrente] = useState<string | null>(null); const [reverso, setReverso] = useState<string | null>(null)
  const [pass, setPass] = useState(''); const [pass2, setPass2] = useState('')
  const [error, setError] = useState<{ texto: string; cuenta?: boolean } | null>(null); const [enviando, setEnviando] = useState(false); const [lista, setLista] = useState(false)
  useEffect(() => { void leer().then((d) => { if (d) { setDatos(d); setCedula((c) => c || d.cedula || '') } }) }, [leer])
  const foto = (set: (s: string | null) => void) => async (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) { set(await reducir(f)); setError(null) } }
  const crear = async (e: React.FormEvent) => {
    e.preventDefault()
    if (enviando) return
    if (!/^[0-9]{5,12}$/.test(cedula.replace(/\s+/g, ''))) { setError({ texto: 'Escribe solo los números de tu cédula profesional.' }); return }
    if (!frente || !reverso) { setError({ texto: 'Sube las fotos del frente y del reverso de tu INE.' }); return }
    if (pass.length < 8) { setError({ texto: 'La contraseña debe tener al menos 8 caracteres.' }); return }
    if (pass !== pass2) { setError({ texto: 'Las contraseñas no coinciden.' }); return }
    setEnviando(true); setError(null)
    const r = await enviar({ cedula: cedula.replace(/\s+/g, ''), password: pass, ineFront: frente, ineBack: reverso })
    if (!r.ok) { setEnviando(false); setError({ texto: r.mensaje, cuenta: r.codigo === 'correo_con_cuenta' }); return }
    setLista(true)
    if (!(await entrar(r.email, pass))) setEnviando(false)
  }
  if (lista) return <div className="rc-pre-tarjeta rc-pre-enhilo" role="status" data-testid="verificarme-lista"><b>¡Listo! Tu cuenta quedó creada.</b><p>Revisaremos tu cédula e identificación aquí mismo; te avisaremos en esta conversación. Entrando con tu cuenta…</p></div>
  return (
    <form className="rc-pre-tarjeta rc-pre-enhilo" onSubmit={crear} noValidate data-testid="verificarme">
      <h1>Verificar mi cuenta</h1>
      <p>{datos ? <>Tu cuenta: <b>{datos.nombre}</b> · {datos.email} · {datos.telefono}. </> : null}Solo nos falta tu cédula, tu INE y una contraseña.</p>
      <div className="rc-campo"><label htmlFor="vm-cedula">Cédula profesional</label><input id="vm-cedula" value={cedula} onChange={(e) => { setCedula(e.target.value); setError(null) }} inputMode="numeric" maxLength={20} placeholder="Solo números" /></div>
      <div className="rc-campo"><label htmlFor="vm-frente">INE · frente</label><input id="vm-frente" type="file" accept="image/*" capture="environment" onChange={foto(setFrente)} data-testid="vm-frente" /></div>
      {frente && <img src={frente} alt="INE frente" style={{ width: 150, borderRadius: 8, border: '1px solid var(--line)' }} />}
      <div className="rc-campo"><label htmlFor="vm-reverso">INE · reverso</label><input id="vm-reverso" type="file" accept="image/*" capture="environment" onChange={foto(setReverso)} data-testid="vm-reverso" /></div>
      {reverso && <img src={reverso} alt="INE reverso" style={{ width: 150, borderRadius: 8, border: '1px solid var(--line)' }} />}
      <div className="rc-campo"><label htmlFor="vm-pass">Contraseña</label><input id="vm-pass" type="password" autoComplete="new-password" value={pass} onChange={(e) => { setPass(e.target.value); setError(null) }} placeholder="Mínimo 8 caracteres" maxLength={72} /></div>
      <div className="rc-campo"><label htmlFor="vm-pass2">Repite la contraseña</label><input id="vm-pass2" type="password" autoComplete="new-password" value={pass2} onChange={(e) => { setPass2(e.target.value); setError(null) }} maxLength={72} /></div>
      {error && <div role="alert" className="rc-error rc-error--inline">{error.texto}{error.cuenta && <> <a href="/sistema">Iniciar sesión</a></>}</div>}
      <button type="submit" className="rc-pre-enviar" disabled={enviando} data-testid="vm-crear">{enviando ? 'Creando tu cuenta…' : 'Crear mi cuenta y enviar a revisión'}</button>
      <p className="rc-pre-nota"><button type="button" className="rc-link" onClick={onCerrar}>Ahora no</button></p>
    </form>
  )
}
