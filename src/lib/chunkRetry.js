// One reload cures a chunk that will not load, and this is the one place that
// knows how.
//
// Everything this app loads on demand, screens and aeronautical data alike, is
// a separate file named after its own contents. The page that is open right now
// knows only the names from the build that served it, so shipping a new version
// replaces those files and the next thing the pilot taps asks for one that is
// gone. The server answers unknown paths with index.html, so the browser is
// handed a web page where it expected JavaScript and the import rejects.
//
// Reloading fixes it, because the reload fetches the new page and the new page
// knows the new names.
//
// Once per thing per session. A file missing for any other reason would
// otherwise reload for ever, and a reload loop is worse than a failure the
// caller can handle. The second attempt throws, and the caller decides.
//
// Never while offline: there the file is missing because it was never
// downloaded, and no amount of reloading will conjure it.
export function importWithRetry(name, loader) {
  return loader().catch(err => {
    const key = `aviara-chunk-retry:${name}`
    let retried = true
    try { retried = sessionStorage.getItem(key) != null } catch { /* private mode */ }
    if (!retried && navigator.onLine !== false) {
      try { sessionStorage.setItem(key, '1') } catch { /* nothing to do */ }
      window.location.reload()
      // Deliberately never settles: the reload is already on its way, and
      // resolving anything here would flash a state about to be thrown away.
      return new Promise(() => {})
    }
    throw err
  })
}
