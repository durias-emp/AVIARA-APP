// The source registry.
//
// Every NOTAM authority in the world publishes the same ICAO text format and
// almost none of them publish it the same way — some push, some poll, some
// want a key, some want a signed agreement. This is the seam that keeps that
// variety out of everything else: the ingest loop knows only about `poll` and
// `stream`, and adding a country means adding a file here.
//
// AVIARA's ambition is global with US emphasis, so this is deliberately not
// "the FAA, plus some others". No source is privileged in the code; they are
// ordered by how much of the world they cover, and the mirror stores which
// one a NOTAM came from.
//
// A source is:
//   id       stable string, also the `source` column value
//   name     what a pilot sees
//   mode     'poll' | 'stream'
//   covers   (icao) => boolean — which idents this authority issues for
//   fetch    poll sources:   async (idents) => RawNotam[]
//   subscribe stream sources: async (onBatch) => () => void   [unsubscribe]
//
// RawNotam is { notamId, raw, startsAt?, endsAt? } — the parser in
// src/lib/notamParse.js does the rest, and it is the same parser the app
// uses so the two can never disagree about what a NOTAM says.

import navcanada from './navcanada.js'
import faa from './faa.js'

export const SOURCES = [faa, navcanada]

export function sourceFor(icao) {
  const id = (icao || '').toUpperCase()
  return SOURCES.find(s => s.covers(id)) ?? null
}

export function sourceById(id) {
  return SOURCES.find(s => s.id === id) ?? null
}
