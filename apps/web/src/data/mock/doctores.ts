// Doctores MOCK (perfiles con role_id 'doctor'), con la forma de la tabla
// `profiles`. verified = gate del canal: solo verificados pueden ordenar.
// doctor-1 coincide con el doctor_id de los pedidos mock.
import type { Profile } from '../types'

export const MOCK_DOCTORS: Profile[] = [
  {
    id: 'doctor-1', email: 'laura.mendez@renova.mx', full_name: 'Dra. Laura Méndez',
    role_id: 'doctor', verified: true, organization: 'Clínica Renova Estética',
    meta: { specialty: 'Medicina estética' },
  },
  {
    id: 'doctor-2', email: 'mario.ruiz@dermamr.mx', full_name: 'Dr. Mario Ruiz',
    role_id: 'doctor', verified: false, organization: 'Dermatología MR',
    meta: { specialty: 'Dermatología', cedula: '7654321' },
  },
  {
    id: 'doctor-3', email: 'sofia.trevino@clinicasofi.mx', full_name: 'Dra. Sofía Treviño',
    role_id: 'doctor', verified: false, organization: 'Clínica Sofí',
    meta: { specialty: 'Antiedad', cedula: '9988776' },
  },
  {
    id: 'doctor-4', email: 'hugo.lara@wellnesslara.mx', full_name: 'Dr. Hugo Lara',
    role_id: 'doctor', verified: true, organization: 'Wellness Lara',
    meta: { specialty: 'Medicina regenerativa' },
  },
]
