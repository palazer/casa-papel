import { useLayoutEffect, useRef, useState } from 'react'

/**
 * How wide an element is on screen, kept up to date. A chart is drawn in real pixels at that width, so its text and
 * its 2 px lines are never stretched; before the first measurement it is 0 and the chart draws nothing.
 */
export function useWidth<T extends HTMLElement>(): { ref: React.RefObject<T | null>; width: number } {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const seen = new ResizeObserver(() => setWidth(el.clientWidth))
    seen.observe(el)
    return () => seen.disconnect()
  }, [])
  return { ref, width }
}
