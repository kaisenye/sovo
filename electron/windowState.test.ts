import { describe, expect, it } from 'vitest'
import { defaultBounds, restoreState } from './windowState.js'

const laptop = { x: 0, y: 25, width: 1512, height: 920 }
const monitor = { x: 1512, y: 0, width: 2560, height: 1415 }

describe('restoreState', () => {
  it('opens at the default size the first time', () => {
    expect(restoreState(null, [laptop], laptop)).toEqual({ ...defaultBounds(laptop), maximized: false, fullScreen: false })
    expect(defaultBounds(laptop)).toEqual({ x: 378, y: 163, width: 756, height: 644 })
  })

  it('reopens where it was closed, maximised state included', () => {
    const saved = { x: 1600, y: 40, width: 2000, height: 1300, maximized: true, fullScreen: false }
    expect(restoreState(saved, [laptop, monitor], laptop)).toEqual(saved)
  })

  it('falls back when the monitor it was on is gone', () => {
    const saved = { x: 1600, y: 40, width: 2000, height: 1300, maximized: false, fullScreen: false }
    expect(restoreState(saved, [laptop], laptop)).toEqual({ ...defaultBounds(laptop), maximized: false, fullScreen: false })
  })

  it('pulls a window hanging off an edge back onto its display and fits it', () => {
    const saved = { x: 300, y: 25, width: 1800, height: 1200, maximized: false, fullScreen: false }
    expect(restoreState(saved, [laptop], laptop)).toEqual({ x: 0, y: 25, width: 1512, height: 920, maximized: false, fullScreen: false })
  })

  it('ignores a broken file', () => {
    expect(restoreState({ x: 'a' }, [laptop], laptop).width).toBe(756)
  })
})
