import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export type Zoom = 'fit' | number

interface Props {
  bytes: Uint8Array
  zoom: Zoom
  /** The scale shown, so the header can say 125%. */
  onScale: (scale: number) => void
  onMeta: (meta: string) => void
  onError: (error: string) => void
}

/** Room around a page in fit mode; fit stops at a comfortable reading width. */
const GUTTER = 48
const MAX_FIT = 1.5
const MAX_PAGE_PX = 900

interface Size {
  w: number
  h: number
}

/**
 * The whole PDF, one canvas per page. Pages paint as they near the viewport,
 * at the screen's pixel density, with pdf.js's text layer on top so text can
 * be selected and copied. Untrusted bytes are parsed in pdf.js's worker.
 */
export function PdfView({ bytes, zoom, onScale, onMeta, onError }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [sizes, setSizes] = useState<Size[]>([])
  const [width, setWidth] = useState(0)

  useEffect(() => {
    let cancelled = false
    // pdf.js transfers the buffer to its worker; keep the cached copy intact.
    const task = pdfjs.getDocument({ data: bytes.slice() })
    task.promise.then(
      async (d) => {
        if (cancelled) return
        const first = (await d.getPage(1)).getViewport({ scale: 1 })
        // Every page sized like the first until its own size is read.
        setSizes(Array.from({ length: d.numPages }, () => ({ w: first.width, h: first.height })))
        setDoc(d)
        const all: Size[] = []
        for (let n = 1; n <= d.numPages; n++) {
          const vp = (await d.getPage(n)).getViewport({ scale: 1 })
          if (cancelled) return
          all.push({ w: vp.width, h: vp.height })
        }
        setSizes(all)
      },
      (e: Error) => !cancelled && onError('Could not open this PDF: ' + e.message)
    )
    return () => {
      cancelled = true
      void task.destroy()
    }
  }, [bytes, onError])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const widest = sizes.reduce((m, s) => Math.max(m, s.w), 0)
  const scale =
    zoom === 'fit'
      ? widest && width
        ? Math.min(MAX_FIT, (width - GUTTER) / widest, MAX_PAGE_PX / widest)
        : 1
      : zoom
  useEffect(() => onScale(scale), [scale, onScale])

  // Which page sits at the middle of the view.
  const [page, setPage] = useState(1)
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !sizes.length) return
    const onScroll = (): void => {
      const mid = el.scrollTop + el.clientHeight / 3
      let y = 16
      let n = 1
      for (let i = 0; i < sizes.length; i++) {
        y += sizes[i].h * scale + 16
        if (y > mid) break
        n = i + 2
      }
      setPage(Math.min(n, sizes.length))
    }
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [sizes, scale])

  useEffect(() => {
    if (doc) onMeta(doc.numPages === 1 ? '1 page' : `Page ${page} of ${doc.numPages}`)
  }, [doc, page, onMeta])

  // A zoom keeps the same spot under the eye: scroll by the scale ratio.
  // Only for the user's zoom, not fit settling as the page size arrives.
  const lastScale = useRef(scale)
  const lastZoom = useRef(zoom)
  useLayoutEffect(() => {
    const el = scrollRef.current
    const prev = lastScale.current
    const zoomed = lastZoom.current !== zoom
    lastScale.current = scale
    lastZoom.current = zoom
    if (!el || prev === scale || !zoomed) return
    const r = scale / prev
    el.scrollTop = (el.scrollTop + el.clientHeight / 2) * r - el.clientHeight / 2
    el.scrollLeft = (el.scrollLeft + el.clientWidth / 2) * r - el.clientWidth / 2
  }, [scale, zoom])

  return (
    <div className="pdf-scroll" ref={scrollRef} tabIndex={-1} data-preview-scroll>
      {!doc && <div className="preview-note">Opening…</div>}
      {doc &&
        sizes.map((s, i) => (
          <PdfPage key={i} doc={doc} number={i + 1} size={s} scale={scale} root={scrollRef} />
        ))}
    </div>
  )
}

function PdfPage({
  doc,
  number,
  size,
  scale,
  root
}: {
  doc: PDFDocumentProxy
  number: number
  size: Size
  scale: number
  root: React.RefObject<HTMLDivElement | null>
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  const [painted, setPainted] = useState(false)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), {
      root: root.current,
      rootMargin: '1200px 0px'
    })
    io.observe(el)
    return () => io.disconnect()
  }, [root])

  useEffect(() => {
    if (!near) return
    let cancelled = false
    let task: ReturnType<PDFPageProxy['render']> | null = null
    let text: pdfjs.TextLayer | null = null
    // Waits a beat while zooming, so a held + doesn't queue a render per step.
    const t = setTimeout(async () => {
      try {
        const page = await doc.getPage(number)
        if (cancelled) return
        const vp = page.getViewport({ scale })
        const dpr = window.devicePixelRatio || 1
        const cv = canvasRef.current
        if (!cv) return
        // Paint off-screen and swap, so zooming never flashes a blank page.
        const next = document.createElement('canvas')
        next.width = Math.floor(vp.width * dpr)
        next.height = Math.floor(vp.height * dpr)
        task = page.render({
          canvas: next,
          viewport: vp,
          transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
          // 'print' skips pdf.js's requestAnimationFrame pump, which stalls
          // while the window is hidden or occluded.
          intent: 'print'
        })
        await task.promise
        if (cancelled) return
        cv.width = next.width
        cv.height = next.height
        cv.getContext('2d')?.drawImage(next, 0, 0)
        setPainted(true)
        const layer = textRef.current
        if (layer) {
          layer.replaceChildren()
          text = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport: vp })
          await text.render()
        }
      } catch (e) {
        if ((e as Error).name !== 'RenderingCancelledException') console.warn('pdf page', number, e)
      }
    }, painted ? 120 : 0)
    return () => {
      cancelled = true
      clearTimeout(t)
      task?.cancel()
      text?.cancel()
    }
    // painted only picks the debounce; it must not re-run the render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, scale, doc, number])

  const w = Math.floor(size.w * scale)
  const h = Math.floor(size.h * scale)
  return (
    <div
      ref={boxRef}
      className="pdf-page"
      data-painted={painted}
      style={{ width: w, height: h, ['--total-scale-factor' as string]: scale }}
    >
      <canvas ref={canvasRef} style={{ width: w, height: h }} />
      <div ref={textRef} className="textLayer" />
    </div>
  )
}
