import { useState } from 'react'
import { useActiveAircraft } from '../../context/ActiveAircraft'
import { useBackOverride } from '../../context/BackOverride'
import Aircraft from './Aircraft'
import { HangarEmptyState, HangarListView } from './HangarList'
import AddAircraftWizard from './AddAircraftWizard'
import ConfirmModal from '../../components/ConfirmModal'
import { restoreAircraft, clearAllDeletedAircraft, createAircraft } from '../../lib/aircraft'
import { parseAircraftImport } from '../../lib/aircraftShare'

// Owns the Hangar's list/detail/add-aircraft routing. Aircraft.jsx itself is
// just the detail view for one aircraft id — this is what decides which of
// list / detail / wizard is on screen, using the active-aircraft context to
// know how many aircraft exist and which one is selected.
//
// initialOpenId opens straight into one aircraft's detail rather than the
// list. The map home's banner uses it: a pilot who taps their own aircraft
// means "show me this aircraft", not "show me the shelf it sits on". Going
// back from there still lands on the list, so the rest of the hangar stays
// one tap away rather than being hidden.
export default function Hangar({ initialOpenId = null }) {
  const { aircraftList, aircraftId, deletedList, setActiveAircraftId, refreshAircraftList, refreshDeletedList } = useActiveAircraft()
  const [openId, setOpenId] = useState(initialOpenId)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [importError, setImportError] = useState(null)

  useBackOverride(
    openId ? () => setOpenId(null)
      : wizardOpen ? () => setWizardOpen(false)
      : null
  )

  async function handleWizardDone(row) {
    await refreshAircraftList()
    await setActiveAircraftId(row.id)
    setWizardOpen(false)
    setOpenId(row.id)
  }

  // Fires once Aircraft.jsx has soft-deleted its own row — refresh both
  // lists (deleting the active aircraft may change which one is active)
  // and step back out of the now-gone detail view.
  async function handleAircraftDeleted() {
    await refreshAircraftList()
    await refreshDeletedList()
    setOpenId(null)
  }

  async function handleRestore(id) {
    await restoreAircraft(id)
    await refreshAircraftList()
    await refreshDeletedList()
  }

  // Reads back a file produced by another aircraft's "Share Aircraft
  // Profile" and creates it here as a brand-new, independent aircraft —
  // the receiving half of that sharing flow.
  async function handleImport(file) {
    setImportError(null)
    try {
      const text = await file.text()
      const data = parseAircraftImport(text)
      const row = await createAircraft(data)
      await refreshAircraftList()
      await setActiveAircraftId(row.id)
      setOpenId(row.id)
    } catch (e) {
      setImportError(e.message || 'Could not import that file.')
    }
  }

  async function handleClearAll() {
    setClearing(true)
    await clearAllDeletedAircraft()
    await refreshDeletedList()
    setClearing(false)
    setClearConfirmOpen(false)
  }

  if (aircraftList === undefined) return null // still loading

  if (openId) {
    return (
      <Aircraft
        aircraftId={openId}
        onBack={() => setOpenId(null)}
        onDeleted={handleAircraftDeleted}
        onHangar={() => setOpenId(null)}
      />
    )
  }

  if (wizardOpen) {
    return <AddAircraftWizard onCancel={() => setWizardOpen(false)} onDone={handleWizardDone} />
  }

  if (aircraftList.length === 0 && !deletedList?.length) {
    return <HangarEmptyState onAdd={() => setWizardOpen(true)} onImport={handleImport} importError={importError} />
  }

  return (
    <>
      <HangarListView
        aircraftList={aircraftList}
        activeId={aircraftId}
        onSelect={id => { setActiveAircraftId(id); setOpenId(id) }}
        onAdd={() => setWizardOpen(true)}
        deletedList={deletedList}
        onRestore={handleRestore}
        onClearDeleted={() => setClearConfirmOpen(true)}
        onImport={handleImport}
        importError={importError}
      />
      {clearConfirmOpen && (
        <ConfirmModal
          title="Clear Recently Deleted?"
          message="These aircraft will be permanently removed right now instead of waiting out the week. This can't be undone."
          confirmLabel="Clear"
          danger
          busy={clearing}
          onCancel={() => setClearConfirmOpen(false)}
          onConfirm={handleClearAll}
        />
      )}
    </>
  )
}
