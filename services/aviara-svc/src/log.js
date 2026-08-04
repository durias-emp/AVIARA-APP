// Logging, kept to what a host's log viewer renders usefully: one line, a
// timestamp, a level. No dependency, because a logging library is not a
// problem this service has.

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19)

export const log = {
  info: (...a) => console.log(`${stamp()}  ${a.join(' ')}`),
  warn: (...a) => console.warn(`${stamp()}  WARN  ${a.join(' ')}`),
  error: (...a) => console.error(`${stamp()}  ERROR ${a.join(' ')}`),
}
