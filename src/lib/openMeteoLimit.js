// Telling a transient Open-Meteo failure from an exhausted one.
//
// The free tier answers 429 for two very different things, and the status code
// alone cannot separate them:
//
//   * a burst limit, cleared in a second or two — worth retrying
//   * the daily allowance, which does not come back until tomorrow — retrying
//     is pure delay, and on a route card that delay is paid before anything
//     renders
//
// Only the response body distinguishes them, so this reads it.
//
//     {"error":true,"reason":"Daily API request limit exceeded. Please try again tomorrow."}
//
// Matched loosely on purpose: the wording is not a documented contract, and a
// missed match costs two needless retries, while a false positive would skip a
// retry that might have worked. Erring toward "transient" is the safer side.

const DAILY = /daily .*limit (exceeded|reached)/i

// Reads the body of a failed response and reports whether the daily allowance
// is gone. Consumes the body, so call it only on a response you are discarding.
// Never throws: if the body is unreadable, the failure is treated as transient.
export async function isDailyLimit(res) {
  if (res.status !== 429) return false
  try {
    return DAILY.test(await res.text())
  } catch {
    return false
  }
}

// Thrown so a retry loop can see why it must not retry.
export class DailyLimitError extends Error {
  constructor() {
    super('open-meteo daily limit')
    this.name = 'DailyLimitError'
    this.dailyLimit = true
  }
}

export const isDailyLimitError = e => e?.dailyLimit === true
