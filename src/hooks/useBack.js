import { useCallback, useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOverlayClose } from '../context/OverlayClose'
import { BackOverrideContext, useBackDepth } from '../context/BackOverride'

// Where back goes, decided once, for every control that means back.
//
// Four answers, asked for in the order a pilot would expect them:
//
//   1. a sub-view that has claimed back while it is up: an open checklist
//      card, an aircraft's detail inside the hangar, a chart over an airport.
//      Back belongs to the thing on top.
//   2. the host that lent this screen its room, through onBack. The planner
//      embedded in the map's drawer is the case: back is the map, not home.
//   3. an overlay's close, for a section shown over a screen rather than
//      routed to.
//   4. home, which is where a screen with nothing above it goes.
//
// This existed already, in two copies, and only the swipe gesture had the
// first step. So the swipe and the button in the same corner could disagree
// about where back was: swiping out of an open card closed the card, pressing
// the button beside it threw away the whole screen. They ask one function now.
export function useBack(onBack) {
  const navigate     = useNavigate()
  const closeOverlay = useOverlayClose()
  const backOverride = useContext(BackOverrideContext)
  const depth        = useBackDepth()

  const goBack = useCallback(() => {
    const override = backOverride?.peek?.()
    if (override)      { override();      return }
    if (onBack)        { onBack();        return }
    if (closeOverlay)  { closeOverlay();  return }
    navigate('/')
  }, [backOverride, onBack, closeOverlay, navigate])

  // Only the last of the four is home. The count is read rather than peeked
  // because this decides what is drawn, and a ref changing tells no one.
  return { goBack, goesHome: depth === 0 && !onBack && !closeOverlay }
}
