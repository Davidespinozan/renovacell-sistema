// Hook de solicitudes de recurso. Mock; con Supabase = tabla resource_requests.
import { useSyncExternalStore } from 'react'
import { subscribe, getSnapshot, addRequest, setStatus, type ResourceRequest, type ResourceStatus } from '../store/resourcesStore'

export function useResources() {
  const data = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { data, addRequest, setStatus }
}

export type { ResourceRequest, ResourceStatus }
