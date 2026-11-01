# 7. Projects and hierarchy

[Guide index](README.md) · Previous: [Sweeps and Monte Carlo](06-sweeps.md) · Next: [Component libraries](08-libraries.md)

## What is in a project

A project is a folder:

```
My amplifier/
  My amplifier.nsproj   project file: name, top sheet, imported libraries, run settings
  main.nsch             one file per sheet
  filter.nsch
  libs/                 library files imported into this project
```

All of them are plain JSON or SPICE text, so they work well with Git. To share a project, share the whole folder.

You can also work without a project: **Open file** (⇧⌘O) on the Home page opens a single `.nsch` schematic or a `.cir` netlist. The header then has **Schematic** / **Netlist** buttons and an **Open** button, and **Save As** (⇧⌘S) is available.

## Sheets

The **Sheets** panel on the left (⌘1) lists the project's sheets and a **Hand-written netlist** for typing SPICE directly.

- Click a sheet to open it in a tab. Close a tab with **×**; its changes stay until you save or discard them.
- **＋** adds a sheet: type a name and press Enter.
- **✎** renames a sheet. Blocks that use it follow the new name.
- **⤒** makes a sheet the **top sheet**.
- **×** deletes a sheet (after a confirmation). The top sheet can't be deleted.

The **top sheet** (marked `TOP`) is the circuit that runs. **▶ Run** always simulates the top sheet, even when another sheet is on screen, and probing only works on the top sheet. The other sheets are used through blocks.

## Ports

A sheet becomes a reusable subcircuit when it has **ports**. A port is like a net label that also becomes a pin of the block.

1. Open the sheet you want to reuse, for example a filter.
2. Press **H** (or **Place › Sheet Port**) and click on each net that should be a pin, at a pin end or wire end.
3. Name each port in the inspector (**Port name**): `in`, `out`, `vcc`…

Rules:

- Each port must be on its own net. Two ports on one net, or a port on ground, is an error.
- Port names can't contain spaces or `= ( ) , { } " '`.
- Analysis directives on a sub-sheet are ignored (with a warning); only the top sheet's analyses run. Other directives, such as `.param` and `.model`, stay with the sheet.
- Ports on the top sheet just act as net labels (with a warning).

## Blocks

1. Open the sheet where you want to use the subcircuit.
2. Open the Parts panel (⌘2). Your other sheets are listed under **Sheets** at the bottom, with their port names.
3. Click the sheet and click on the canvas. A block appears: a box with one pin per port, the first half of the ports on the left and the rest on the right.
4. Wire the block's pins like any other part.

Each block is named X1, X2… and its value shows the sheet name. In the netlist, the sheet becomes a `.subckt` (written once, however many blocks use it) and each block becomes an `X` line.

[examples/Hier-Filter](examples/Hier-Filter/) has two copies of `filter.nsch` (a 1 kΩ / 100 nF RC section) in cascade:

![Two filter blocks on the main sheet; X1 is selected](images/07-hier-main.png)

The AC plot shows the single-pole roll-off at `mid` and the steeper two-pole roll-off at `out`.

## Descending into a block

To see or edit the sheet behind a block, either:

- double-click the block, or
- select it and click **Open sheet** in the inspector.

The sheet opens in a new tab, with a breadcrumb trail above the canvas (**main › filter**). Click **‹** or a name in the trail to go back up.

![Inside filter.nsch: ports in and out, with the trail main › filter](images/07-descend.png)

Edits inside the sheet change every block that uses it. Results and probing stay with the top sheet: switch back to it to probe (the status bar reminds you if you try from a sub-sheet).

## Updating a block after its ports change

When you add, remove or rename a port on a sheet, the blocks that use the sheet must change shape. This happens by itself when you leave the sheet (switch tabs or close it) and when you save. The block gets the new set of pins and the sheets it is on are marked as changed.

Check the wiring of those blocks afterwards. The pins move to new positions and the existing wires stay where they were, so they may no longer touch the pins: look for the red unconnected-pin squares and rewire.

![After adding port p1 to filter.nsch, both blocks have three pins and their wires are no longer connected](images/07-ports-changed.png)

If a block's sheet was changed some other way (for example edited outside the app), the inspector shows **Ports changed: …** and an **Update pins** button. A block whose pins don't match its sheet's ports stops the netlist with an error that says to update the block.

A sheet can't contain itself, directly or through other sheets. The netlister reports such loops as `Hierarchy cycle: …`.

Next: [Component libraries](08-libraries.md).
