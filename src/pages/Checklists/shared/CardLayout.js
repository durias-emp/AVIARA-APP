import { createContext, useContext } from 'react'

// How the cards in one step should lay themselves out.
//
// The decision belongs to the step, not to the card: whether cards share the
// pane's height depends on how many there are and whether one is open, and no
// card can see either of those. Passing it as a prop would mean threading it
// through every one of the dozen item components between StepPane and
// ExpandableCard, none of which have any business knowing about it.
//
//   stretch  nothing in this pane is open, so the collapsed cards divide the
//            height between them instead of stacking at the top of an
//            otherwise empty screen
//   solo     this step has exactly one card, so there is nothing to choose
//            between: it opens on arrival and has no collapsed state
export const CardLayoutContext = createContext({ stretch: false, solo: false })

export const useCardLayout = () => useContext(CardLayoutContext)
