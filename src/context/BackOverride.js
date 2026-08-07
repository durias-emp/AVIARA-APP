import { createContext, useContext, useEffect } from 'react'

// Lets an inline sub-view that isn't its own route or overlay (e.g. a
// Reference topic swapped in via local state, or an open checklist card)
// claim "back" while it's the active view, so back steps out of it rather
// than off the screen it lives on.
// Stack-based so nested/sequential claims restore the right handler.
//
// Two contexts on purpose, and they must stay two.
//
// This one carries the API and its value is created once and never changes.
// useBackOverride re-runs its effect whenever the context value changes, so a
// value that changed each time something claimed back would make every
// registered handler pop and re-push in response to any other handler landing:
// a loop, and a stack whose order no longer means what it says.
export const BackOverrideContext = createContext(null)

// How many claims are currently on the stack, as state rather than as a ref.
// The stack itself is a ref, which is right for reading at the moment of a
// press and useless for drawing: a button cannot know its glyph should change
// if nothing re-renders it. This is the part that re-renders, so nothing that
// only takes a handler subscribes to it.
export const BackDepthContext = createContext(0)

export function useBackOverride(handler) {
  const ctx = useContext(BackOverrideContext)
  useEffect(() => {
    if (!ctx || !handler) return
    return ctx.push(handler)
  }, [ctx, handler])
}

export function useBackDepth() {
  return useContext(BackDepthContext)
}
