// The guardrail on the drawer's stops.
//
// The four stops mean something: 25 is what is true at a glance, 50 is the one
// task the pilot is in the middle of, 80 is a menu of next actions, and 100 is
// a list long enough to need its own scroll. That is the system, and it only
// stays a system if every piece of content picks one of the four rather than
// landing wherever the vertical order happens to put it.
//
// Nothing in the drawer was assigned to a stop. The tools grid appeared at 80
// purely because of how much sat above it, so adding one row anywhere higher
// quietly redefined what 80 meant, with nothing in the code to notice. This is
// what notices.
//
// It moves nothing. A block declares the stop it belongs to by attaching this
// hook's ref to an element it already has, and when the drawer settles at that
// stop the block is measured: if it does not fit, the console says so, with the
// stop it actually needs and by how many pixels it missed. In production the
// hook returns undefined refs and never measures anything.
//
// Deliberately one-sided. A block that turns out to be readable EARLIER than it
// claims is not a bug: a tall phone simply fits more at 50 than a short one
// does, and warning about it would train everyone to ignore the warnings. Only
// "you said this belongs at 80 and it does not fit at 80" is a fault.
//
// READ THIS BEFORE BELIEVING A FIGURE FROM THE DESKTOP PREVIEW PANE.
//
// While that pane is hidden, document.hidden is true and the browser suspends
// the whole rendering pipeline: CSS transitions freeze, requestAnimationFrame
// never runs, and ResizeObserver never delivers. Measured with a probe element
// grown from 10px to 200px behind a hidden pane: the size changed, the observer
// fired zero times.
//
// That matters here twice over. The drawer sizes its photograph from heights it
// measures with a ResizeObserver, so behind a hidden pane those heights are
// whatever they were at the last visible moment and a block can be measured
// carrying the layout of a stop it has already left. And the re-check below is
// itself observer-driven, so behind a hidden pane only the first pass runs.
// The first pass is real; a figure that changes depending on which stop you
// arrived from is the pane, and belongs on a phone before it is believed.

import { useCallback, useEffect, useRef } from 'react'
import { stopCovering, visibleHeight } from '../lib/sheet'

// Rounding slack. Stops are fractions of the viewport rounded to whole pixels
// and the blocks that fill to a stop are computed from the same rounded
// numbers, so a block can land a pixel over the line while being exactly right.
const SLACK = 2

// What has already been said, at module scope rather than in a ref.
//
// StrictMode mounts, unmounts and mounts again in development, and a fresh ref
// on the second mount meant every line was printed twice. A hot reload did the
// same. The key carries the outcome, so a block that starts failing still gets
// heard even though its passing line was said earlier.
const said = new Set()

export default function useStopAudit({ sheetRef, vh, snap, enabled, skip = false }) {
  // label -> element, label -> stop, and label -> the ref callback itself.
  // Maps in refs rather than state: these change during commit and nothing
  // renders from them.
  const els = useRef(new Map())
  const stops = useRef(new Map())
  const callbacks = useRef(new Map())

  // declare(stop, label) -> a ref callback for an element the block already
  // has. Returns undefined in production, which React accepts as "no ref" and
  // costs nothing.
  //
  // The callback is cached per label and never rebuilt, which matters: a fresh
  // ref function every render makes React detach and reattach on every render,
  // and one of the elements this is composed onto carries a ResizeObserver
  // that would then be torn down and rebuilt just as often.
  const declare = useCallback((stop, label) => {
    if (!enabled) return undefined
    stops.current.set(label, stop)
    let cb = callbacks.current.get(label)
    if (!cb) {
      cb = (node) => {
        if (node) els.current.set(label, node)
        else els.current.delete(label)
      }
      callbacks.current.set(label, cb)
    }
    return cb
  }, [enabled])

  useEffect(() => {
    if (!enabled || skip || !vh || !snap) return
    const sheet = sheetRef.current
    if (!sheet) return

    // Measured straight from the effect, with no requestAnimationFrame in
    // front of it. Two reasons, and the second one cost an afternoon once
    // already: getBoundingClientRect flushes any pending layout itself, so
    // there is nothing to wait for; and rAF does not run at all in a hidden
    // tab, which is exactly the state the desktop preview pane is in, so an
    // audit built on it reported nothing and looked like an audit that passed.
    //
    // Waiting for the 380ms slide is not needed either. Every block is a child
    // of the sheet, so subtracting the sheet's own top cancels the transform
    // and leaves the block's offset within the sheet, mid-flight or settled.
    const audit = () => {
      const room = visibleHeight(vh, snap)
      let sheetTop
      try { sheetTop = sheet.getBoundingClientRect().top } catch { return }

      for (const [label, el] of els.current) {
        const stop = stops.current.get(label)
        // Each block is asked about its own stop and no other. "Does the tools
        // grid fit at 80" is measured with the drawer actually at 80, in the
        // layout it actually has there, rather than extrapolated from another.
        if (stop !== snap) continue
        // 100 is the stop that scrolls. A block that lives there is meant to
        // run past the bottom of the screen, so there is nothing to fail.
        if (stop === 100) continue
        if (!el.isConnected) continue

        const bottom = Math.round(el.getBoundingClientRect().bottom - sheetTop)
        const fits = bottom <= room + SLACK
        // Keyed by viewport height too: the same block can fit on one screen
        // and not another, and both are worth hearing once.
        const key = `${label}@${stop}/${vh}/${fits}`
        if (said.has(key)) continue
        said.add(key)

        if (fits) {
          console.info(
            `[stops] ${label}: declares ${stop}, fits at ${stop} (${bottom} of ${room}px)`,
          )
        } else {
          const needs = stopCovering(vh, bottom)
          console.warn(
            `[stops] ${label} declares ${stop} but does not fit there: ` +
            `${bottom}px of content in ${room}px of drawer, over by ${bottom - room}. ` +
            (needs
              ? `It needs stop ${needs}. Either move it there or take ${bottom - room}px out of what sits above it.`
              : 'No stop contains it, so it is a list and belongs at 100.'),
          )
        }
      }
    }

    // Only ever on a settled layout, never on the way to one.
    //
    // A change of stop reaches its final size in more than one step. Several
    // of the drawer's heights are measured rather than declared, the
    // photograph's cap among them, so React renders with the new stop, a
    // ResizeObserver reports the new header height, and it renders again.
    // Measuring the first of those reports a layout that never reaches the
    // screen: arriving at 50 from 80 briefly carried 80's photograph, and the
    // audit called it a 117px overflow that no pilot would ever have seen.
    //
    // So every trigger restarts a short quiet timer and only silence runs the
    // audit. The delay is longer than a couple of frames and shorter than
    // anyone waits for a console line.
    let timer = null
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(audit, 140)
    }
    schedule()

    if (typeof ResizeObserver === 'undefined') {
      return () => clearTimeout(timer)
    }
    const ro = new ResizeObserver(schedule)
    ro.observe(sheet)
    for (const el of els.current.values()) {
      if (el.isConnected) ro.observe(el)
    }
    return () => { clearTimeout(timer); ro.disconnect() }
  }, [enabled, skip, vh, snap, sheetRef])

  return declare
}
