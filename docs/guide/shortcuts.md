# Keyboard shortcuts

[Guide index](README.md)

<!-- Sources: the menu (src/main/menu.ts), the registered commands (useCommands in main.tsx, Help.tsx, layout/Panel.tsx) and the canvas key handler (schematic/Schematic.tsx). -->

This page lists the default shortcuts. You can change most of them in **Settings › Keyboard shortcuts** ([chapter 1](01-getting-started.md#settings)), which is also what **Help › Keyboard Shortcuts** (⌘/) opens.

On Windows and Linux, use **Ctrl** for **⌘**. Rotate and mirror use **Ctrl** on every platform.

## Anywhere

These work even while typing in a text field.

| Keys | Action |
|---|---|
| ⌘N | New project |
| ⌘O | Open project |
| ⇧⌘O | Open file (`.nsch` or `.cir`) |
| ⌘S | Save (all sheets in a project) |
| ⇧⌘S | Save As (single files and netlists; projects save in place) |
| ⌘↵ | Run |
| ⌘. | Stop the running simulation |
| ⌘P | Print the schematic (File › Print Schematic…) |
| ⌘1 | Show or hide the Sheets panel |
| ⌘2 | Show or hide the Parts panel |
| ⌘3 | Show or hide the results panel |
| ⌘/ | Keyboard shortcuts |
| ⌘, | Settings (Preferences on Windows) |

## Schematic canvas

These work when the canvas is active and no text field has focus.

| Keys | Action |
|---|---|
| R, C, L | Place resistor, capacitor, inductor |
| V, I | Place voltage source, current source |
| D, Q, M | Place diode, NPN transistor, NMOS transistor |
| G, N, H | Place ground, net label, sheet port |
| S | Place a SPICE directive |
| T | Place a text note |
| W | Wire tool |
| B | Bus tool |
| / (while drawing a wire or bus) | Flip the corner |
| / | Open the Parts panel and search |
| Shift+L | Show or hide the Parts panel |
| P | Probe tool |
| Alt+click | Probe a net (voltage) or a part (current) from the Select tool |
| Alt+drag net to net | Probe the difference between two nets |
| A | Simulation setup (analysis dialog) |
| Esc | Cancel the wire, leave the current tool, then clear the selection |
| Ctrl+R | Rotate the selection or the part being placed |
| Ctrl+E | Mirror the selection or the part being placed |
| ⌘Z | Undo |
| ⇧⌘Z, ⌘Y | Redo |
| ⌘X, ⌘C, ⌘V | Cut, copy, paste |
| ⌘D | Duplicate |
| ⌘A | Select all |
| ⌘F | Find a part (R2, D14) or a net label on any sheet |
| Delete, ⌫ | Delete the selection |
| + (or =), − | Zoom in, zoom out |
| F | Fit the drawing to the window |
| Space+drag, middle-drag, scroll | Pan |
| Pinch, Ctrl+scroll | Zoom |
| Shift+click | Add to or remove from the selection |
| Double-click a part, directive or note | Open its properties popup |
| Enter on the selection | Open its properties popup (also for blocks) |
| Right-click | Context menu: properties, clipboard, rotate, mirror, align, distribute |
| Double-click a block | Open its sheet |

## Parts panel search

These work while the search box in the Parts panel has focus.

| Keys | Action |
|---|---|
| ↵ | Place the first match |
| ↓, ↑ | Move through the list |
| Esc | Clear the search |

## Plots

These work on a plot in the results panel.

| Keys | Action |
|---|---|
| A | Place cursor A at the mouse |
| B | Place cursor B at the mouse |
| Drag a cursor line | Move that cursor |
| Right-click | Menu: place or remove a cursor, reset the zoom |
| Drag on the plot | Zoom |
| Double-click | Reset the zoom |
| ↵ in **＋ expression** | Add the expression |

## Dialogs

These work in the Simulation setup, waveform, import and other dialogs.

| Keys | Action |
|---|---|
| ⌘↵ | Apply (or Import) |
| Esc | Cancel and close |
| Tab, ⇧Tab | Move between fields |

Back to the [guide index](README.md).
