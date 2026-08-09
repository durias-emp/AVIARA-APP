// The screen that failed is the screen that fails, not the whole app.
//
// Every route in this app is a lazy import, so every route is a separate file
// the browser fetches the moment a pilot taps its button. When one of those
// fetches does not come back, React's lazy throws, and with nothing to catch it
// the throw walks all the way out and unmounts the tree: a white screen, no
// menu, no back button, nothing to tap. That is what "the app crashes" meant.
//
// The usual cause is not a bug in the screen at all. An installed PWA holds on
// to the page it was launched with, and that page names its chunks by content
// hash. Deploy again and those names change. The old page then asks for a file
// the new deploy does not have, and because the server answers unknown paths
// with index.html rather than a 404, the browser gets HTML where it expected
// JavaScript and gives up. Tapping Airports and Settings crashes; Home, already
// loaded, does not. Which is exactly the shape of it.
//
// So: catch it, say what happened in words a pilot can act on, and leave the
// two doors out that always work.

import { Component } from 'react'

export default class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { err: null }
  }

  static getDerivedStateFromError(err) {
    return { err }
  }

  componentDidUpdate(prev) {
    // Moving to another screen is a fresh attempt. Without this the boundary
    // would hold its error for the rest of the session and every later screen
    // would show the failure of the first one.
    if (this.state.err && prev.resetKey !== this.props.resetKey) {
      this.setState({ err: null })
    }
  }

  render() {
    const { err } = this.state
    if (!err) return this.props.children

    // A missing chunk reads differently from a genuine fault in the screen, and
    // the pilot can do something about the first one.
    const stale = /dynamically imported module|Importing a module script failed|Failed to fetch/i
      .test(String(err?.message ?? err))

    return (
      <div style={{
        minHeight: '60vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', textAlign: 'center',
        gap: 14, padding: '40px 28px',
      }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>
          {stale ? 'This screen did not load' : 'This screen ran into a problem'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, maxWidth: 320 }}>
          {stale
            ? 'It is usually an update that has landed while the app was open, so this part is no longer where the app left it. Reloading picks up the new version. Everything you have saved stays where it is.'
            : 'The rest of the app is fine. Go back and try again, or reload if it keeps happening.'}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '11px 20px', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: 'var(--text)', color: 'var(--bg)', fontFamily: 'inherit',
              fontSize: 14, fontWeight: 700,
            }}>
            Reload
          </button>
          <button
            onClick={() => { window.location.href = '/' }}
            style={{
              padding: '11px 20px', borderRadius: 12, border: '0.5px solid var(--border)',
              cursor: 'pointer', background: 'var(--bg-card-2)', color: 'var(--text)',
              fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
            }}>
            Go to the map
          </button>
        </div>

        {/* The actual message, small and last. Useless to most pilots and the
            only thing worth having when one sends a screenshot. */}
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 6, maxWidth: 320, wordBreak: 'break-word' }}>
          {String(err?.message ?? err).slice(0, 200)}
        </div>
      </div>
    )
  }
}
