import { useCallback, useRef } from 'react'
import { BackOverrideContext } from './BackOverride'

export default function BackOverrideProvider({ children }) {
  const stack = useRef([])

  const push = useCallback(fn => {
    stack.current.push(fn)
    return () => { stack.current = stack.current.filter(f => f !== fn) }
  }, [])

  const peek = useCallback(() => stack.current[stack.current.length - 1] ?? null, [])

  return (
    <BackOverrideContext.Provider value={{ push, peek }}>
      {children}
    </BackOverrideContext.Provider>
  )
}
