import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import type { Zoom } from './PdfView'

interface Props {
  src: string
  zoom: Zoom
  onZoom: (zoom: Zoom) => void
  onScale: (scale: number) => void
  onMeta: (meta: string) => void
  onError: (error: string) => void
}

/**
 * Fits the stage by default; a click toggles actual size around the point
 * clicked, and +/- zoom from there. Rendered as <img>, so an SVG never runs
 * script or loads anything.
 */
export function ImageView({ src, zoom, onZoom, onScale, onMeta, onError }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const focus = useRef<{ x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pad = 32
  const fit = natural && box.w ? Math.min(1, (box.w - pad) / natural.w, (box.h - pad) / natural.h) : 1
  const scale = zoom === 'fit' ? fit : zoom
  useEffect(() => onScale(scale), [scale, onScale])

  // After a click-to-zoom, keep the clicked point under the pointer.
  useLayoutEffect(() => {
    const el = scrollRef.current
    const f = focus.current
    if (!el || !f || !natural) return
    focus.current = null
    el.scrollLeft = f.x * natural.w * scale - el.clientWidth / 2
    el.scrollTop = f.y * natural.h * scale - el.clientHeight / 2
  }, [scale, natural])

  const onClick = (e: MouseEvent<HTMLImageElement>): void => {
    const r = e.currentTarget.getBoundingClientRect()
    focus.current = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
    onZoom(zoom === 'fit' && fit < 1 ? 1 : 'fit')
  }

  return (
    <div className="image-scroll" ref={scrollRef} tabIndex={-1} data-preview-scroll>
      <img
        className="image-view"
        src={src}
        alt=""
        draggable={false}
        data-zoomable={fit < 1 || zoom !== 'fit'}
        data-zoomed={zoom !== 'fit'}
        style={natural ? { width: natural.w * scale, height: natural.h * scale } : undefined}
        onLoad={(e) => {
          const { naturalWidth: w, naturalHeight: h } = e.currentTarget
          setNatural({ w, h })
          onMeta(`${w} × ${h}`)
        }}
        onError={() => onError('This image could not be shown.')}
        onClick={onClick}
      />
    </div>
  )
}
