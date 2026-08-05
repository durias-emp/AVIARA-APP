import { createContext, useContext } from 'react'

// Who is showing the planner, and what they want told.
//
// The planner is opened two ways now: as its own screen at /checklists, and
// inside the map home's drawer. The drawer version has to know the moment a
// route is calculated, because that is when it settles back down over the map
// to show the line it just drew. Nothing between AltitudeItem and the host
// cares about that fact, and threading a callback down through
// ChecklistTabShell and StepPane would put a planner-specific prop on two
// components whose whole job is not to know what a section does.
//
// Absent provider means the standalone screen, where calculating a route is
// not an event anyone is waiting for. Every consumer must therefore treat a
// null context as "nobody is listening", not as a bug.
export const PlannerHostContext = createContext(null)

export function usePlannerHost() {
  return useContext(PlannerHostContext)
}
