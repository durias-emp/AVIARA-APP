import { supabase } from './supabase'
import { get, put, getAll, clearStore } from './db'

// The stores backed up to the cloud. `weather`/`airportDiagram` are
// excluded — disposable fetch caches, not pilot data worth restoring.
export const SYNCED_STORES = ['aircraft', 'currency', 'checklists', 'settings', 'flights', 'logbookEntries', 'uapReports',
  // The maintenance schedule and its compliance record: pilot data, backed up
  // like the rest of it. The compliance log merges cleanly across devices
  // because it is append-only with unique ids, so a restore only ever adds
  // rows it does not have.
  'maintenanceItems', 'complianceLog']

async function currentUserId() {
  const { data } = await supabase.auth.getSession()
  return data.session?.user?.id ?? null
}

// Best-effort, fire-and-forget: called after every local put() to one of
// the synced stores (see db.js) so the cloud backup stays current. Never
// throws: a failure (offline, not signed in yet) just leaves
// syncMeta.pendingPush true for a later retry via retryPendingPushes().
export async function pushToCloud(store) {
  if (!SYNCED_STORES.includes(store)) return
  try {
    const userId = await currentUserId()
    if (!userId) return
    const data = await getAll(store)
    const { error } = await supabase.from('backups').upsert({
      user_id: userId, store_name: store, data, updated_at: new Date().toISOString(),
    })
    if (error) throw error
    await put('syncMeta', { store, lastPushedAt: Date.now(), pendingPush: false })
  } catch {
    await put('syncMeta', { store, lastPushedAt: Date.now(), pendingPush: true }).catch(() => {})
  }
}

// Pulls each store's cloud backup into IndexedDB, per row: a cloud row is
// restored when this device has no row with the same key, and existing local
// rows always win. (The old store-level "skip if not empty" was fragile. 
// any incidental early write, like the profile email seed, marked a store
// non-empty and blocked the whole restore.) One domain tiebreak: a local
// pilot row that never completed onboarding is a stub and must not shadow a
// completed cloud profile. This is still "backup & restore" for one active
// device, not merge/conflict resolution.
export async function hydrateFromCloud() {
  const userId = await currentUserId()
  if (!userId) return

  const keyOf = (store, item) => (store === 'settings' ? item.key : item.id)

  for (const store of SYNCED_STORES) {
    try {
      const { data: row } = await supabase
        .from('backups')
        .select('data')
        .eq('user_id', userId)
        .eq('store_name', store)
        .maybeSingle()
      if (!row?.data?.length) continue

      const localRows = await getAll(store)
      const localByKey = new Map(localRows.map(r => [keyOf(store, r), r]))

      for (const item of row.data) {
        const k = keyOf(store, item)
        const local = localByKey.get(k)
        if (!local) {
          await put(store, item)
        } else if (store === 'settings' && k === 'pilot'
                   && !local.onboardingComplete && item.onboardingComplete) {
          await put(store, item)
        }
      }
    } catch {
      // Offline or no backup yet. Leave local state as-is.
    }
  }
}

// Pushes every synced store once, regardless of syncMeta state. Called
// right after hydrateFromCloud() on every sign-in: for a brand-new account
// this is a harmless push of empty/just-restored data; for a pre-existing
// installed user linking an account for the first time, this is what
// establishes their existing local data as the cloud backup immediately,
// instead of waiting for the next incidental write.
export async function pushAllToCloud() {
  for (const store of SYNCED_STORES) await pushToCloud(store)
}

// Retries any store that failed to push while offline. Call this on the
// browser's `online` event.
export async function retryPendingPushes() {
  for (const store of SYNCED_STORES) {
    const meta = await get('syncMeta', store)
    if (meta?.pendingPush) await pushToCloud(store)
  }
}

// Wipe all locally-stored pilot data. Called on sign-out so the device is
// left clean for the next account. Otherwise hydrateFromCloud (which only
// fills empty stores) would leave the previous pilot's data visible to
// whoever signs in next. Also clears syncMeta so the next sign-in triggers
// a fresh pull. Callers should push a final backup BEFORE this, while the
// session still exists.
export async function clearLocalData() {
  for (const store of [...SYNCED_STORES, 'syncMeta']) {
    await clearStore(store).catch(() => {})
  }
}
