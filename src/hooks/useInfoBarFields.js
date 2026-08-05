import { useCallback, useEffect, useState } from 'react'
import { get, put } from '../lib/db'

const STORE = 'settings'
const KEY   = 'mapInfoBarFields'
export const MAX_FIELDS = 6

// The bar's starting set — matches what ForeFlight ships with by default,
// and what the "(already shown)" labels in the field picker refer to.
export const DEFAULT_FIELDS = ['gs', 'gpsAlt', 'track', 'distDest', 'eteDest']

export function useInfoBarFields() {
  const [fields, setFieldsState] = useState(DEFAULT_FIELDS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    get(STORE, KEY).then(saved => {
      if (Array.isArray(saved?.value) && saved.value.length) setFieldsState(saved.value)
      setLoaded(true)
    })
  }, [])

  const toggleField = useCallback((key) => {
    setFieldsState(prev => {
      const has = prev.includes(key)
      if (!has && key !== 'blank' && prev.filter(k => k !== 'blank').length >= MAX_FIELDS) return prev
      const next = has ? prev.filter(k => k !== key) : [...prev, key]
      put(STORE, { key: KEY, value: next }).catch(() => {})
      return next
    })
  }, [])

  return { fields, toggleField, loaded }
}
