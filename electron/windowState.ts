/**
 * The main window opens where it was last closed: same size, position and
 * maximised / full-screen state. Kept in `window-state.json` under userData
 * (not SQLite: the window is made before anything else needs the database).
 */
import { readFileSync, writeFileSync } from 'fs'
import type { BrowserWindow } from 'electron'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowState extends Rect {
  maximized: boolean
  fullScreen: boolean
}

export const MIN_WIDTH = 720
export const MIN_HEIGHT = 480

/** Half the screen's width and 70% of its height, centred; never below the minimum or past the screen. */
export function defaultBounds(area: Rect): Rect {
  const width = Math.min(area.width, Math.max(MIN_WIDTH, Math.round(area.width * 0.5)))
  const height = Math.min(area.height, Math.max(MIN_HEIGHT, Math.round(area.height * 0.7)))
  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height
  }
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Where to open. The saved window is used when it is still mostly on a
 * connected display (a monitor unplugged since would strand it off-screen);
 * it is shrunk to fit that display's work area. Otherwise the default on the
 * primary display.
 */
export function restoreState(saved: unknown, workAreas: Rect[], primary: Rect): WindowState {
  const fallback = { ...defaultBounds(primary), maximized: false, fullScreen: false }
  const s = saved as Partial<WindowState> | null
  if (!s || ![s.x, s.y, s.width, s.height].every(isNum)) return fallback
  const rect = { x: s.x!, y: s.y!, width: s.width!, height: s.height! }
  let best: Rect | null = null
  let bestArea = 0
  for (const a of workAreas) {
    const o = overlap(rect, a)
    if (o > bestArea) {
      bestArea = o
      best = a
    }
  }
  // Less than a third visible: treat it as lost.
  if (!best || bestArea < (rect.width * rect.height) / 3) return fallback
  const width = Math.min(best.width, Math.max(MIN_WIDTH, rect.width))
  const height = Math.min(best.height, Math.max(MIN_HEIGHT, rect.height))
  const x = Math.min(Math.max(rect.x, best.x), best.x + best.width - width)
  const y = Math.min(Math.max(rect.y, best.y), best.y + best.height - height)
  return { x, y, width, height, maximized: !!s.maximized, fullScreen: !!s.fullScreen }
}

export function readWindowState(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** Saves the window's state as it moves, resizes and closes. */
export function trackWindowState(win: BrowserWindow, file: string): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const save = (): void => {
    if (win.isDestroyed()) return
    // Normal bounds: a maximised or full-screen window reopens there, and
    // un-maximising returns to the size it had before.
    const b = win.getNormalBounds()
    const state: WindowState = { ...b, maximized: win.isMaximized(), fullScreen: win.isFullScreen() }
    try {
      writeFileSync(file, JSON.stringify(state))
    } catch {
      /* a lost window position is not worth an error */
    }
  }
  const soon = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, 500)
  }
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const)
    win.on(ev as 'resize', soon)
  win.on('close', () => {
    if (timer) clearTimeout(timer)
    save()
  })
}
