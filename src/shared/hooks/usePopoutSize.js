// usePopoutSize.js
//
// Reports a size bucket for the CURRENT WINDOW (not viewport / media-query).
// Used by the character-sheet popout so its layout can adapt to the size
// of the popout window the user has dragged it to — independent of the
// main shell's responsive system.
//
// Returns { width, size } where `size` is one of:
//   'L'  — ≥ 1100 px  → 3-column dashboard
//   'M'  — 720..1099  → 2-column compact
//   'S'  — 480..719   → 1-column with section switcher
//   'XS' — < 480      → 1-column dense, switcher tabs are icons
//
// Live-updates on window resize.

import { useEffect, useState } from 'react'

export function bucketize(width) {
  if (width >= 1100) return 'L'
  if (width >= 720)  return 'M'
  if (width >= 480)  return 'S'
  return 'XS'
}

export default function usePopoutSize() {
  const [width, setWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1200
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    let raf = 0
    const onResize = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setWidth(window.innerWidth))
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
    }
  }, [])
  return { width, size: bucketize(width) }
}
