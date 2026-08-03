// Sharing a post or a listing.
//
// Links are built from window.location.origin rather than a hardcoded
// domain, so a link shared from the sandbox points at the sandbox and one
// shared from production points at production. Hardcoding pqrh-app here
// would mean every link generated while testing sent people to the live
// site, which is exactly the sort of thing nobody notices until a buyer
// follows one.
//
// Two link shapes, and the difference matters:
//
//   /m/<id>  a listing. Public — listings are `using (true)` on select in
//            0002, so this opens for anyone, no account needed. That is the
//            entire point: an aircraft ad you cannot send to a buyer who
//            doesn't have the app is not much of an ad
//   /p/<id>  a post. Gated by can_view_posts like the post itself, so the
//            link is only as shareable as the post already was. A private
//            account's post link opens for their followers and nobody else

export const postUrl = id => `${window.location.origin}/p/${id}`
export const listingUrl = id => `${window.location.origin}/m/${id}`

// Result is one of 'shared' | 'copied' | 'cancelled' | 'failed', so the
// caller can say what actually happened instead of guessing.
//
// navigator.share is the right primitive on a phone — it opens the real OS
// share sheet, so the pilot can send to Messages, WhatsApp, AirDrop, or
// anything else they already use, and this app never has to know about any
// of them. It doesn't exist on most desktop browsers, hence the clipboard
// fallback.
export async function shareLink({ url, title, text }) {
  if (navigator.share) {
    try {
      await navigator.share({ url, title, text })
      return 'shared'
    } catch (err) {
      // The user dismissing the sheet throws AbortError. That is a choice,
      // not a failure, and must not fall through to copying something they
      // just decided not to share.
      if (err?.name === 'AbortError') return 'cancelled'
    }
  }
  return copyLink(url)
}

export async function copyLink(url) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url)
      return 'copied'
    }
  } catch { /* fall through to the manual path below */ }

  // execCommand('copy') is deprecated and still the only thing that works in
  // a non-secure context or an older iOS webview — worth keeping while this
  // runs as an installed PWA on whatever phone a pilot happens to own.
  try {
    const el = document.createElement('textarea')
    el.value = url
    el.setAttribute('readonly', '')
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(el)
    return ok ? 'copied' : 'failed'
  } catch {
    return 'failed'
  }
}
