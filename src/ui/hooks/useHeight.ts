import { useCallback, useRef, useState } from 'react'

/**
 * A callback ref and the element's height in px, kept current as it resizes
 * and as it mounts or unmounts (0 while it is not mounted).
 */
export function useHeight<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [height, setHeight] = useState(0)
  const observer = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect()
    observer.current = null
    setHeight(el?.offsetHeight ?? 0)
    if (!el || typeof ResizeObserver === 'undefined') return
    observer.current = new ResizeObserver(() => setHeight(el.offsetHeight))
    observer.current.observe(el)
  }, [])
  return [ref, height]
}
