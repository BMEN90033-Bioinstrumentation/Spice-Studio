// Where Radix portals (dialog, select, menu, tooltip) mount. The pop-out windows (layout/PopOut.tsx) render into another
// document, so they provide their own root here; the main window falls back to document.body (undefined).
import { createContext, useContext } from 'react'

export const PortalContainer = createContext<HTMLElement | undefined>(undefined)
export const usePortalContainer = () => useContext(PortalContainer)
