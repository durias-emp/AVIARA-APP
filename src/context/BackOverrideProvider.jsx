import { useCallback, useMemo, useRef, useState } from 'react'
import { BackOverrideContext, BackDepthContext } from './BackOverride'

export default function BackOverrideProvider({ children }) {
  const stack = useRef([])
  // The same stack, counted, so the back control can draw itself. See the
  // note in BackOverride.js for why this is a second context rather than a
  // field on the first one.
  const [depth, setDepth] = useState(0)

  const push = useCallback(fn => {
    stack.current.push(fn)
    setDepth(stack.current.length)
    return () => {
      stack.current = stack.current.filter(f => f !== fn)
      setDepth(stack.current.length)
    }
  }, [])

  const peek = useCallback(() => stack.current[stack.current.length - 1] ?? null, [])

  // Created once. push and peek are both stable, so this object is too, and
  // subscribing to it costs a consumer nothing.
  const api = useMemo(() => ({ push, peek }), [push, peek])

  return (
    <BackOverrideContext.Provider value={api}>
      <BackDepthContext.Provider value={depth}>
        {children}
      </BackDepthContext.Provider>
    </BackOverrideContext.Provider>
  )
}
