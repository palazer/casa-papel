import { describe, expect, it } from 'vitest'
import { amountDisplay } from '@/features/grid/display'

describe('amountDisplay', () => {
  it('a balance or income below zero takes the expense tone; above zero it reads as money in', () => {
    expect(amountDisplay(-8000, 'in', 'EUR', 'en-IE', true)).toEqual({ text: '-€80.00', tone: 'out' })
    expect(amountDisplay(-8000, 'in', 'EUR', 'en-IE', false).tone).toBe('out')
    expect(amountDisplay(8000, 'in', 'EUR', 'en-IE', true)).toEqual({ text: '€80.00', tone: 'in' })
    expect(amountDisplay(0, 'in', 'EUR', 'en-IE', true).tone).toBe('in')
  })
  it('the plug keeps the amber draw and spending its sign preference', () => {
    expect(amountDisplay(-12000, 'net', 'EUR', 'en-IE', true)).toEqual({ text: '+€120.00', tone: 'draw' })
    expect(amountDisplay(21000, 'out', 'EUR', 'en-IE', true)).toEqual({ text: '-€210.00', tone: 'out' })
    expect(amountDisplay(21000, 'out', 'EUR', 'en-IE', false)).toEqual({ text: '€210.00', tone: 'neutral' })
  })
})
