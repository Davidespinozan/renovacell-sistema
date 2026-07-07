// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { screen, cleanup } from '@testing-library/react'
import { renderWithRole } from '../../test/utils'
import { Despacho } from './Despacho'
import { Seguimiento } from './Seguimiento'

beforeEach(cleanup)

describe('<Despacho>', () => {
  it('muestra el despacho de cargas a chofer', () => {
    renderWithRole(<Despacho />)
    expect(screen.getByText('Despacho')).toBeInTheDocument()
  })
})

describe('<Seguimiento>', () => {
  it('muestra el seguimiento de envíos', () => {
    renderWithRole(<Seguimiento />)
    expect(screen.getByText('Seguimiento de envíos')).toBeInTheDocument()
  })
})
