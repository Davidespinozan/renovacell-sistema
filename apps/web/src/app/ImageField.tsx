// Campo de IMAGEN reutilizable para el editor del sitio.
//
// Antes había que pegar la URL a mano (y conseguirla de algún lado). Ahora se
// sube el archivo desde la computadora y el sistema guarda la URL solo. Se
// conserva el campo de texto por si quieren pegar una URL externa.
import React, { useRef, useState } from 'react'
import { Upload, Trash2, Image as ImageIcon } from 'lucide-react'
import { uploadImage } from '../lib/uploads'

interface Props {
  label: string
  value: string
  onChange: (url: string) => void
  hint?: string
  // Carpeta dentro del bucket público, para tener orden: 'landing', 'catalog'…
  folder?: string
  // Proporción de la vista previa (por ejemplo '16 / 10' o '1 / 1').
  ratio?: string
}

export function ImageField({ label, value, onChange, hint, folder = 'landing', ratio = '16 / 10' }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const onFile = async (f: File | undefined) => {
    if (!f) return
    if (!f.type.startsWith('image/')) { setError('Ese archivo no es una imagen.'); return }
    // 6 MB: arriba de eso conviene optimizarla antes (una foto así carga lento).
    if (f.size > 6 * 1024 * 1024) { setError('La imagen pesa más de 6 MB. Comprímela antes de subirla.'); return }
    setBusy(true); setError(null)
    try {
      const url = await uploadImage(f, folder)
      onChange(url)
    } catch {
      setError('No se pudo subir la imagen. Intenta de nuevo.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = '' // permite volver a subir el mismo archivo
    }
  }

  return (
    <div style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginBottom: 6 }}>{label}</span>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {/* Vista previa (o marco vacío) */}
        <div style={{
          width: 132, flex: 'none', aspectRatio: ratio, borderRadius: 11, overflow: 'hidden',
          border: '1px solid var(--line)', background: 'var(--bone, #F1F5EE)', display: 'grid', placeItems: 'center',
        }}>
          {value
            ? <img src={value} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <ImageIcon size={20} style={{ color: 'var(--ink-3)', opacity: 0.6 }} />}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label className="btn ghost sm" style={{ cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}>
              <Upload size={14} /> {busy ? 'Subiendo…' : value ? 'Cambiar imagen' : 'Subir imagen'}
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} disabled={busy}
                onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
            {value && (
              <button className="btn ghost sm" type="button" style={{ color: 'var(--danger)' }} onClick={() => { onChange(''); setError(null) }}>
                <Trash2 size={13} /> Quitar
              </button>
            )}
          </div>

          {/* Alternativa: pegar una URL externa */}
          <input
            value={value}
            onChange={(e) => { onChange(e.target.value); setError(null) }}
            placeholder="…o pega aquí la dirección de una imagen"
            style={{
              width: '100%', marginTop: 8, padding: '8px 10px', border: '1px solid var(--line)',
              borderRadius: 9, fontFamily: 'monospace', fontSize: 12, outline: 'none', background: '#fff',
            }}
          />
          {error && <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>{error}</div>}
          {hint && !error && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }}>{hint}</div>}
        </div>
      </div>
    </div>
  )
}