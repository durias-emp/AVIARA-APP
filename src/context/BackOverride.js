import { createContext, useContext, useEffect } from 'react'

// Lets an inline sub-view that isn't its own route or overlay (e.g. a
// Reference topic swapped in via local state) claim the back gesture
// (swipe or the Shell chevron's fallback) while it's the active view.
// Stack-based so nested/sequential claims restore the right handler.
export const BackOverrideContext = createContext(null)

export function useBackOverride(handler) {
  const ctx = useContext(BackOverrideContext)
  useEffect(() => {
    if (!ctx || !handler) return
    return ctx.push(handler)
  }, [ctx, handler])
}
