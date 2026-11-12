// Schematic colour themes (Settings › Appearance › Schematic colours): the schematic colours of the KiCad themes at
// https://github.com/cosmopotamian/KiCAD_Themes, one string per theme in KEYS order. Pure: prefs.ts validates against it.
const KEYS = ['background', 'grid', 'component_outline', 'component_body', 'reference', 'value', 'wire', 'junction', 'bus', 'note', 'no_connect', 'erc_error'] as const
const RAW: Record<string, { name: string; dark: boolean; c: string }> = {
  altium_light: { name: 'Altium Designer Light', dark: false, c: '#ffffff #b4b4b0 #0000ff #ffffb0 #000080 #000080 #000080 #000080 #000080 #000080 #ff0000 #ff0000' },
  altium_midnight_blue: { name: 'Altium Midnight Blue', dark: true, c: '#10141e #444f6e #00a8dc #2a3450 #a0d2f0 #a0d2f0 #d2b950 #50d278 #3c82dc #82aadc #dc5050 #dc3c3c' },
  altium_soft_slate: { name: 'Altium Soft Slate', dark: true, c: '#1e222a #576278 #c8cdd7 #384050 #5ac8e6 #5ac8e6 #6ed78c #6ed78c #648ce6 #82afe6 #dc646e #dc5050' },
  cadence_soft_ember: { name: 'Cadence Soft Ember', dark: true, c: '#1c1a1a #5a5353 #d76464 #463f3f #dca550 #dca550 #78cd91 #78cd91 #d273dc #d2d0c8 #d76464 #d74646' },
  cadence_steel_noir: { name: 'Cadence Steel Noir', dark: true, c: '#0e1014 #424b64 #c8c88c #313a50 #50b4dc #50b4dc #6ec88c #6ec88c #5078d2 #5096c8 #d25050 #d23c3c' },
  cosmo_deep_jade: { name: 'Cosmo Deep Jade', dark: true, c: '#121216 #505364 #dcbe50 #3b3f50 #64c8a0 #64c8a0 #78d264 #78d264 #64a0e6 #64a0e6 #dc6464 #dc4646' },
  cosmo_gold: { name: 'Cosmo Gold', dark: true, c: '#000000 #4b4b4b #d7821e #282000 #ffda00 #ffda00 #ffda00 #ffda00 #00bedc #fcfcfc #ff2828 #ff2828' },
  cosmo_soft_gold: { name: 'Cosmo Soft Gold', dark: true, c: '#1c1e1c #5d645d #d7c864 #404640 #5ac8af #5ac8af #82c873 #82c873 #739be1 #d2d2cd #d76464 #d75555' },
  designspark_light: { name: 'DesignSpark PCB Light', dark: false, c: '#ffffff #b4b4b4 #000000 #fcfcfc #c0000f #c0000f #804000 #000000 #0000a0 #0000c0 #000000 #ff0000' },
  eagle_light: { name: 'Eagle Light', dark: false, c: '#ffffff #b4b4b4 #d43d3d #fcfcfc #a2a2a2 #a2a2a2 #3dbc91 #3dbc91 #38abdf #3dbc91 #d43d3d #ff0000' },
  eagle_soft_amber: { name: 'Eagle Soft Amber', dark: true, c: '#201e1c #645f56 #a0d7aa #46433d #dcc355 #dcc355 #dcc355 #a0d7aa #6e9bdc #d7d2c8 #d76973 #d75555' },
  fusion_slate_amber: { name: 'Fusion Slate Amber', dark: true, c: '#1c1e22 #535964 #b4bec8 #404650 #82bee6 #82bee6 #d2b95a #64d282 #508cc8 #78aad2 #d26464 #d24646' },
  gruvbox_warm_dark: { name: 'Gruvbox Warm Dark', dark: true, c: '#1d2021 #645b56 #fb4934 #32302f #8ec07c #8ec07c #b8bb26 #b8bb26 #83a598 #83a598 #83a598 #fb4934' },
  monokai_vivid: { name: 'Monokai Vivid', dark: true, c: '#141411 #504f44 #f92672 #46443b #66d9ef #66d9ef #a6e22e #a6e22e #66d9ef #fd971f #66d9ef #f92672' },
  multisim_light: { name: 'NI Multisim Light', dark: false, c: '#ffffff #d2d2d2 #0000ff #fcfcfc #000000 #000000 #ff0000 #ff0000 #c00000 #000000 #000000 #ff0000' },
  nord_arctic: { name: 'Nord Arctic', dark: true, c: '#1d2129 #4c566a #bf616a #2e3440 #88c0d0 #88c0d0 #a3be8c #a3be8c #5e81ac #88c0d0 #5e81ac #bf616a' },
  orcad_light: { name: 'OrCAD Light', dark: false, c: '#ffffff #b4b4b4 #cc7f05 #fcfcfc #000000 #000000 #4100ff #ff0000 #0000ff #000000 #7f3f00 #ff0000' },
  pads_dark_navy: { name: 'PADS Dark Navy', dark: true, c: '#0f121e #3b4364 #dcdc64 #343d64 #00c3c3 #00c3c3 #5ad26e #5ad26e #646ed2 #64a0dc #d25a78 #d23c5a' },
  pads_light: { name: 'PADS Light', dark: false, c: '#ffffff #b4b4b4 #048282 #fcfcfc #000080 #4ec8c8 #678de8 #2058dd #008080 #000000 #ff0000 #ff0000' },
  pads_soft_twilight: { name: 'PADS Soft Twilight', dark: true, c: '#1a1c26 #4e556e #4bcdd7 #343a50 #dcd26e #dcd26e #dcd26e #dcd26e #7378dc #d2d2dc #d75064 #d75064' },
  rose_pine_moon: { name: 'Ros\u00e9 Pine Moon', dark: true, c: '#191724 #6e6a86 #eb6f92 #26233a #9ccfd8 #9ccfd8 #31748f #31748f #9ccfd8 #9ccfd8 #9ccfd8 #eb6f92' },
  tokyo_night: { name: 'Tokyo Night', dark: true, c: '#1a1b26 #565f89 #f7768e #24283b #73daca #73daca #9ece6a #9ece6a #7dcfff #7dcfff #7dcfff #f7768e' },
}

export const SCH_DEFAULT = 'default' // the app's own colours, following Settings › Theme
export type SchColors = Record<(typeof KEYS)[number], string>
const colors = (c: string) => Object.fromEntries(c.split(' ').map((v, i) => [KEYS[i], v])) as SchColors
export const SCH_THEMES = Object.entries(RAW).map(([id, t]) => ({ id, name: t.name, dark: t.dark, c: colors(t.c) }))
export const SCH_THEME_IDS = [SCH_DEFAULT, ...Object.keys(RAW)]

// The canvas' CSS variables for a theme ('' for the default). KiCad themes have no selection / probe colours, so those
// take style.css' dark or light set by the theme's background, whatever the app theme is.
// ponytail: those two sets are copied from style.css; fold them into one place if they ever change
const DARK = '--hl:#6aa9ff;--hl-bg:rgba(106,169,255,.13);--sel:#f0b35a;--probe:#f5d061'
const LIGHT = '--hl:#2563eb;--hl-bg:rgba(37,99,235,.1);--sel:#c2410c;--probe:#a16207'
export function schThemeCss(id: string): string {
  const t = RAW[id]
  if (!t) return ''
  const c = colors(t.c)
  const tag = `color-mix(in srgb,${c.background},${c.reference}` // OP tags and directive cards: a step off the canvas
  return `.sch>svg,.sch>.sch-hint{--bg:${c.background};--line-strong:${c.grid};--sym:${c.component_outline};--sym-body:${c.component_body};` +
    `--text:${c.reference};--dim:${c.value};--wire:${c.wire};--jn:${c.junction};--bus:${c.bus};--note:${c.note};--nc:${c.no_connect};--err:${c.erc_error};` +
    `--s1:${tag} 8%);--s2:${tag} 14%);${t.dark ? DARK : LIGHT}}.sch>svg{background:var(--bg)}.sch>.sch-hint{color:var(--dim)}`
}
