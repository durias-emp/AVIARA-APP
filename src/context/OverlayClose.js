import { createContext, useContext } from 'react'

export const OverlayCloseContext = createContext(null)
export function useOverlayClose() { return useContext(OverlayCloseContext) }
