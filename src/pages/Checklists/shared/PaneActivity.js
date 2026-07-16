import { createContext, useContext, useEffect, useRef } from 'react'

// Lets an ExpandableCard report "I'm open" up to whichever pane it lives in,
// so that pane can tell the floating tab bar to get out of the way while
// the pilot is working inside an expanded card. Counts concurrently-open
// cards (rather than a single bool) so closing one of several open cards
// doesn't prematurely bring the bar back.
export const PaneActivityContext = createContext(null)

export function usePaneActivity(isOpen) {
  const ctx = useContext(PaneActivityContext)
  const idRef = useRef({})

  useEffect(() => {
    if (!ctx || !isOpen) return
    return ctx.register(idRef.current)
  }, [ctx, isOpen])
}
