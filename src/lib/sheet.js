// The drawer's ladder: where a bottom sheet is allowed to stop, and what a
// gesture means once the finger leaves the glass.
//
// A sheet that can rest anywhere a finger happens to release it reads as
// broken, because nothing tells the pilot where it was supposed to land and
// every drag looks like an accident. So there is a small fixed set of resting
// positions and the sheet always returns to one of them. Google and Android
// call these snap points; Apple's UISheetPresentationController calls them
// detents, after the click-stops on a dial. Google Maps, Apple Maps and Uber
// all work this way.
//
// This module is the whole system as arithmetic. It holds no state, touches no
// DOM and imports nothing, so a sheet anywhere in the app can obey the same
// ladder as the map home's drawer without inheriting the map home's drawer.
// The numbers were the map home's private business until now, which is how the
// app ended up with four other sheets at 86vh, 86vh, 94dvh and 92dvh: four
// heights, no stops, and no way to notice they had drifted.

// Where a sheet can rest, named by how much of the screen it covers.
//
//    0   off the screen entirely
//   25   where it opens, and where it comes back to
//   50   half and half: the flight plan, drawn across the map it needs
//   80   tools and the recent flights
//  100   a screen of its own, for reading the logbook rather than glancing
//
// The number is the name. One vocabulary for the code and for talking about
// it, so "the plan sits at 50" needs no translating in either direction.
//
// The resting stop is 25 and was 30. At 30 the drawer stood 244px tall around
// 146px of contents, so a third of it was empty and the map was paying for the
// gap. 25 leaves about the safe-area inset and a little air, which is as tight
// as a fixed fraction can be cut without the hint line landing under the home
// indicator on the phone, where the inset is real and the desktop's is zero.
//
// Fractions of the viewport, not pixels, for two reasons. A stop then means
// the same thing on every screen; and a stop is a position rather than a
// measurement of whatever happens to be inside it. The resting stop used to be
// 178px of measured contents plus two correction constants for the pieces that
// came and went, which is three numbers describing one height and three places
// to be wrong.
//
// Four is the ceiling, not a coincidence. Material's own guidance is blunt
// about it: past three or four meaningful positions a pilot stops being able
// to predict where a drag will land, which is the exact feeling the ladder
// exists to remove. A fifth stop is a conversation, not an edit.
// Three, not four. Closed with the dock on the bottom, the app page at 40 with
// the map still showing above it, and full screen.
//
// 14 rather than 25 for the closed stop: it holds the dock and its labels and
// not one pixel more. At 25 the sheet sat a quarter of the way up the screen
// with nothing in the space, which reads as a drawer that failed to close
// rather than as a dock resting on the bottom.
// The fourth rung sat at 80 and was the one nobody could name: it showed the
// same list as full screen with less of it, so a drag that landed there read as
// having missed rather than as having arrived. The guidance quoted above cuts
// both ways, and three predictable stops beat four where one is noise.
export const SHEET_STOPS = [14, 40, 100]

// Off the screen. Deliberately NOT a rung: no drag can reach it, because a
// sheet that can be dragged out of existence is a sheet a pilot loses. It is
// reached by the button that hides the panel and left by the same button,
// which is why the caller remembers which rung it was on.
export const SHEET_HIDDEN = 0

// Where the sheet commits to full whatever the gesture was. Above the 80 stop
// rather than below it, or every drag that reached 80 would be taken as a drag
// for 100 and the stop would be unreachable by hand.
export const SHEET_FULL_TRIGGER = 90

// The sheet's top corners at rest. They round in as it rises (see radiusFor),
// so a collapsed sheet reads as a piece of chrome sitting over the map and a
// raised one reads as a screen of its own.
export const SHEET_RADIUS = 22

// How far a finger must travel before a sheet treats it as a drag rather than
// a tap. Below this the buttons in the header keep their taps.
export const DRAG_SLOP = 6

// What counts as a flick: fast, and further than the slop by enough to be
// meant. Under this the gesture is read by where it ended instead.
const FLICK_MS = 260
const FLICK_PX = 24

// Distance from the top of the screen to the top of the sheet, for a stop.
// Stops are how much is covered and this is where the edge lands, so the two
// are complements: 100 is at the top of the screen, 0 is below the bottom.
export const stopY = (vh, stop) => Math.round(vh * (1 - stop / 100))

// A fast, short gesture decides on its own, regardless of how far it got: a
// short sharp pull up should open the sheet even from the very bottom.
export function isFlick(ms, dist) {
  return ms < FLICK_MS && Math.abs(dist) > FLICK_PX
}

// Past the trigger the sheet commits to full whatever the gesture was.
// Dragging that far is unambiguous, and snapping back from there would feel
// like the sheet fighting the hand.
export function isFullPull(vh, y) {
  return y <= stopY(vh, SHEET_FULL_TRIGGER)
}

// A flick moves one rung in the direction of travel, so a hard pull from 25
// does not skip the two useful stops in the middle on its way to 100.
export function flickTarget(current, up, stops = SHEET_STOPS) {
  // A current position that is not on the ladder, which the hidden state is,
  // counts as the bottom rung rather than as an error.
  const at = Math.max(0, stops.indexOf(current))
  return stops[Math.min(stops.length - 1, Math.max(0, at + (up ? 1 : -1)))]
}

// A slow, deliberate drag goes to whichever rung is physically closest to
// where the finger let go. Never somewhere in between, and never wherever the
// thumb happened to stop.
export function nearestStop(vh, y, stops = SHEET_STOPS) {
  return stops.reduce((best, s) =>
    Math.abs(y - stopY(vh, s)) < Math.abs(y - stopY(vh, best)) ? s : best)
}

// How much of the sheet is on the screen at a stop. The complement of stopY,
// and the number a block has to fit inside to be readable there.
export const visibleHeight = (vh, stop) => vh - stopY(vh, stop)

// The smallest rung that puts a block on the screen, or null if no rung does.
//
// bottomPx is the block's bottom edge measured from the TOP OF THE SHEET, not
// from the top of the screen: a stop is a height of sheet, so what decides
// whether a block is readable there is how far down the sheet it sits, not
// where the sheet happens to be while it slides.
//
// null is a real answer and not a failure. A block that no rung can contain is
// a list, and a list belongs at 100 where the sheet finally scrolls.
export function stopCovering(vh, bottomPx, stops = SHEET_STOPS) {
  return stops.find(s => bottomPx <= visibleHeight(vh, s)) ?? null
}

// The top corners, for wherever the sheet is right now.
//
// Full at rest and square by the time it reaches 80, which is where the sheet
// stops being chrome over the map and starts being a screen. Driven by the
// live y rather than by the stop, so it tracks a finger mid-drag rather than
// stepping at the end of one.
export function radiusFor(vh, y, radius = SHEET_RADIUS) {
  return Math.round(radius * Math.min(1, y / Math.max(1, stopY(vh, 80))))
}
