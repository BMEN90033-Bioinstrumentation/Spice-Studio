// One small set of stroke icons (font glyphs like ⌂ ↶ ⧉ render at odd sizes and baselines). 24×24 grid, currentColor.
const P = {
  home: 'M4 10.5 12 4l8 6.5V20h-5.5v-6h-5v6H4z',
  play: 'M7 5v14l11-7z',
  stop: 'M7 7h10v10H7z',
  plus: 'M12 5v14M5 12h14',
  folder: 'M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z',
  file: 'M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-10zM14 3.5V8.5h5',
  book: 'M5 5.5A2 2 0 0 1 7 3.5h12v14H7a2 2 0 0 0-2 2zM5 19.5a2 2 0 0 0 2 2h12v-4',
  close: 'M6 6l12 12M18 6 6 18',
  left: 'M14.5 6 8.5 12l6 6',
  right: 'M9.5 6l6 6-6 6',
  up: 'M6 14.5 12 8.5l6 6',
  down: 'M6 9.5l6 6 6-6',
  popout: 'M14 4h6v6M20 4l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4',
  layers: 'M12 4 3 9l9 5 9-5zM3 14l9 5 9-5',
  chip: 'M7 6h10v12H7zM10 3v3M14 3v3M10 18v3M14 18v3M4 10h3M4 14h3M17 10h3M17 14h3',
  chart: 'M4 4v16h16M7 15l4-5 3 3 5-6',
  cursor: 'M6 4l12 7-5.2 1.3L10 18z',
  wire: 'M3 18h5V7h13',
  probe: 'M4 20l5-5M8 12l4 4 8-8-4-4z',
  rotate: 'M19 12a7 7 0 1 1-2.05-4.95M19 4v4h-4',
  mirror: 'M12 3v18M8 7 3 12l5 5zM16 7l5 5-5 5z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  undo: 'M8 5 4 9l4 4M4 9h11a5 5 0 0 1 0 10h-5'
} as const
export type IconName = keyof typeof P
const FILLED: Partial<Record<IconName, true>> = { play: true, stop: true }

export const Icon = ({ name, flip }: { name: IconName; flip?: boolean }) => (
  <svg className="i" viewBox="0 0 24 24" aria-hidden="true" fill={FILLED[name] ? 'currentColor' : 'none'} stroke="currentColor"
    strokeWidth={FILLED[name] ? 1 : 1.7} strokeLinecap="round" strokeLinejoin="round" transform={flip ? 'scale(-1 1)' : undefined}>
    <path d={P[name]} />
  </svg>
)
