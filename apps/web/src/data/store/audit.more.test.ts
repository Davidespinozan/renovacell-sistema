// Bitácora de auditoría (modo mock): logAudit agrega un registro append-only.
import { describe, it, expect } from 'vitest'
import { logAudit, getSnapshot } from './auditStore'

describe('auditStore', () => {
  it('logAudit registra una acción con su actor', () => {
    logAudit({ actor: 'QA', action: 'Prueba de auditoría', resource: 'REC-1', detail: 'x' })
    const e = getSnapshot().find((x) => x.action === 'Prueba de auditoría' && x.resource === 'REC-1')
    expect(e).toBeTruthy()
    expect(e?.actor).toBe('QA')
  })
  it('las entradas nuevas quedan al frente (más reciente primero)', () => {
    logAudit({ actor: 'QA', action: 'Acción reciente QA', resource: 'REC-2' })
    expect(getSnapshot()[0].action).toBe('Acción reciente QA')
  })
})
