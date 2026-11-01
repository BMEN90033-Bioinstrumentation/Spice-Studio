// Tooltip in one line: <Tip label="Rotate (R)"><Button …/></Tip>. Replaces title= so tooltips match the theme.
import type { ReactElement, ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function Tip({ label, side, children }: { label?: ReactNode; side?: 'top' | 'right' | 'bottom' | 'left'; children: ReactElement }) {
  if (!label) return children
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  )
}
