// Buscador global indexado (prioridad Alta). Indexa entidades REALES de los
// stores y, respetando RBAC (Regla 4), acota QUÉ puede buscar cada rol y a qué
// pantalla enruta. Doctor: catálogo + SUS pedidos. Staff: según su puesto (sin
// exponer PII de clientes a operación). Mañana en Supabase = misma firma con
// queries server-side bajo RLS.
import { useCallback } from 'react'
import { useRole } from '../../auth/RoleContext'
import { getRole, getNav } from '../../app/roles'
import { useProducts } from './useProducts'
import { useAllOrders, useOrders } from './useOrders'
import { useDoctors } from './useDoctors'
import { useProspects } from './useProspects'
import { useShipments } from './useShipments'
import { useLots } from './useLots'
import { driverIdByEmail } from '../mock/shipments'
import { money, fmtDate } from '../../lib/format'

export interface SearchResult { id: string; type: string; label: string; sub: string; screen: string }

const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

export function useGlobalSearch() {
  const { role, user, capabilities } = useRole()
  const { data: products } = useProducts()
  const { data: allOrders } = useAllOrders()
  const { data: myOrders } = useOrders()
  const { data: doctors } = useDoctors()
  const { data: prospects } = useProspects()
  const { data: shipments } = useShipments()
  const { data: lots } = useLots()

  return useCallback((raw: string): SearchResult[] => {
    const q = norm(raw.trim())
    if (q.length < 2) return []
    const hit = (...vals: (string | null | undefined)[]) => vals.some((v) => v && norm(v).includes(q))
    const out: SearchResult[] = []
    const prodName = (id: string | null): string => products.find((p) => p.id === id)?.name ?? 'Producto'

    // "Ir a" \u2014 cualquier pantalla de la navegaci\u00f3n del rol se vuelve un comando
    // (paleta de comandos). Va primero: navegar es la acci\u00f3n m\u00e1s frecuente.
    const nav = getNav(getRole(role), undefined, capabilities)
    const screenHits: SearchResult[] = nav
      .filter((s) => hit(s.label))
      .slice(0, 4)
      .map((s) => ({ id: `nav-${s.key}`, type: 'Ir a', label: s.label, sub: '', screen: s.key }))

    if (role === 'doctor') {
      products.filter((p) => hit(p.name, p.category)).slice(0, 5)
        .forEach((p) => out.push({ id: p.id, type: 'Producto', label: p.name, sub: p.category ?? '', screen: 'catalogo' }))
      myOrders.filter((o) => hit(o.external_ref)).slice(0, 5)
        .forEach((o) => out.push({ id: o.id, type: 'Mi pedido', label: o.external_ref ?? o.id, sub: money(o.total), screen: 'pedidosdr' }))
      return [...screenHits, ...out]
    }

    if (role === 'warehouse') {
      products.filter((p) => hit(p.name, p.category)).slice(0, 5)
        .forEach((p) => out.push({ id: p.id, type: 'Producto', label: p.name, sub: p.category ?? '', screen: 'stock' }))
      // Lote por código (trazabilidad / dónde está / cuándo caduca).
      lots.filter((l) => hit(l.lot_code)).slice(0, 5)
        .forEach((l) => out.push({ id: l.id, type: 'Lote', label: l.lot_code ?? l.id, sub: `${prodName(l.product_id)} · caduca ${fmtDate(l.expiry_date ?? '')}`, screen: 'stock' }))
      allOrders.filter((o) => hit(o.external_ref)).slice(0, 5)
        .forEach((o) => out.push({ id: o.id, type: 'Pedido', label: o.external_ref ?? o.id, sub: money(o.total), screen: 'cola' }))
      return [...screenHits, ...out]
    }

    if (role === 'pos') {
      // Vendedor: busca en SU cartera (prospectos y clientes propios).
      const me = user?.email
      prospects.filter((p) => p.assigned_to === me && hit(p.name, p.email)).slice(0, 5)
        .forEach((p) => out.push({ id: p.id, type: 'Prospecto', label: p.name ?? '—', sub: p.source ?? '', screen: 'av_prosp' }))
      doctors.filter((d) => ((d.meta as Record<string, unknown>)?.owner as string) === me && hit(d.full_name, d.organization, d.email)).slice(0, 5)
        .forEach((d) => out.push({ id: d.id, type: 'Cliente', label: d.full_name ?? '—', sub: d.organization ?? '', screen: 'clientes' }))
      return [...screenHits, ...out]
    }

    if (role === 'driver') {
      // Solo los pedidos asignados a ESTE chofer (aislamiento, como MisEntregas).
      const myId = driverIdByEmail(user?.email ?? '')
      const mine = new Set(shipments.filter((s) => s.driver_id === myId).map((s) => s.order_id))
      allOrders.filter((o) => mine.has(o.id) && hit(o.external_ref)).slice(0, 8)
        .forEach((o) => out.push({ id: o.id, type: 'Entrega', label: o.external_ref ?? o.id, sub: money(o.total), screen: 'driver_home' }))
      return [...screenHits, ...out]
    }

    // admin: visión completa (pedidos, doctores, prospectos, productos, lotes)
    allOrders.filter((o) => hit(o.external_ref)).slice(0, 4)
      .forEach((o) => out.push({ id: o.id, type: 'Pedido', label: o.external_ref ?? o.id, sub: money(o.total), screen: 'av_ventas' }))
    doctors.filter((d) => hit(d.full_name, d.organization, d.email)).slice(0, 4)
      .forEach((d) => out.push({ id: d.id, type: 'Doctor', label: d.full_name ?? '—', sub: d.organization ?? '', screen: 'av_doc' }))
    prospects.filter((p) => hit(p.name, p.email)).slice(0, 4)
      .forEach((p) => out.push({ id: p.id, type: 'Prospecto', label: p.name ?? '—', sub: p.source ?? '', screen: 'av_prosp' }))
    products.filter((p) => hit(p.name, p.category)).slice(0, 3)
      .forEach((p) => out.push({ id: p.id, type: 'Producto', label: p.name, sub: p.category ?? '', screen: 'av_catalogo' }))
    lots.filter((l) => hit(l.lot_code)).slice(0, 3)
      .forEach((l) => out.push({ id: l.id, type: 'Lote', label: l.lot_code ?? l.id, sub: `${prodName(l.product_id)} · caduca ${fmtDate(l.expiry_date ?? '')}`, screen: 'av_traza' }))
    return [...screenHits, ...out]
  }, [role, user, capabilities, products, allOrders, myOrders, doctors, prospects, shipments, lots])
}
