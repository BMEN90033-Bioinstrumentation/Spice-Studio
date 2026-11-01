# Qucs-S community parts: origin and licence

This pack holds 2309 component models taken from the component library of **Qucs-S** (the Quite Universal Circuit
Simulator with SPICE), https://github.com/ra3xdh/qucs_s, `library/` directory at commit `899808827218757b1241468d40d2b44d55d8957d` (2026-10-30).
Qucs-S and its library are distributed under the GNU General Public License, version 2 or (at your option) any later
version; the full licence text is in `COPYING` (copied unchanged from the Qucs-S repository). The models were written
or collected by the Qucs and Qucs-S contributors; where a part's description names an author it is kept in the comment
above the part.

## What was changed

The files here are a **converted (modified) form** of the Qucs-S library files, produced by `scripts/packs/qucs.ts` in
the ngspice Studio source:

- Qucs component properties (`<Diode>`, `<_BJT>`, `<JFET>`, `<_MOSFET>`) were rewritten as SPICE `.model` cards (or
  small `.subckt` wrappers where instance parameters such as MOSFET L/W are needed), following Qucs-S's own ngspice
  netlister; qucsator `.Def:` subcircuits were rewritten element by element as SPICE `.subckt`s.
- Qucs-S `<Spice>` sections are kept as shipped, nested inside a wrapper `.subckt` that ties the Qucs ground pin to
  node 0 and gives the pins readable names.
- Parts that carry third-party vendor notices, or look like vendor models with their notices removed, were left out,
  as were parts that failed a simulation check in ngspice. `BUILD.md` lists every part left out and why, plus the
  sha256 of each source file in `pack.json` (`provenance`).

## Where the original source is

https://github.com/ra3xdh/qucs_s/tree/899808827218757b1241468d40d2b44d55d8957d/library — the exact files used are listed with download links in `pack.json`. The
conversion script that produced this folder is `scripts/packs/qucs.ts` in the ngspice Studio repository; together they
are the "preferred form for making modifications" of these files.

This pack comes with NO WARRANTY; see sections 11 and 12 of the GPL.
