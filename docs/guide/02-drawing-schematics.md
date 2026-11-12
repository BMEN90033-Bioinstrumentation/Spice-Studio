# 2. Drawing schematics

[Guide index](README.md) · Previous: [Getting started](01-getting-started.md) · Next: [Component reference](03-components.md)

The schematic editor is the canvas in the middle of the window. The toolbar above it holds the drawing tools; the hint line at the bottom always says what the current tool does.

## Moving around

- **Pan**: scroll with the trackpad or mouse wheel, hold **Space** and drag, or drag with the middle button.
- **Zoom**: pinch on a trackpad (or Ctrl + scroll wheel), or press **+** and **−**.
- **Fit**: press **F** or click **⤢** to fit the whole drawing in the window.
- **Panels**: ⌘1 shows or hides the Sheets panel, ⌘2 (or **Shift+L**) the Parts panel and ⌘3 the results.

## Placing parts

There are three ways to pick a part.

**Keyboard.** Press the part's letter, then click on the canvas. Each click places another copy; press **Esc** to go back to Select.

| Key | Part | Key | Part |
|---|---|---|---|
| R | Resistor | D | Diode |
| C | Capacitor | Q | NPN transistor |
| L | Inductor | M | NMOS transistor |
| V | Voltage source | G | Ground |
| I | Current source | N | Net label |
| H | Sheet port | S | SPICE directive |

**Place menu.** The **Place** menu has the parts above plus **PNP Transistor**, **PMOS Transistor** and **Op-amp** (an ideal op-amp; see [chapter 3](03-components.md)).

**Parts panel.** Click **Parts** in the toolbar (or press ⌘2) to open the parts list on the left. It lists every part by category: the basic elements (R, C, L, sources, controlled sources, switches, transformer…) and the thousands of library parts (diodes, transistors, op-amps…). Click a part, then click on the canvas.

To search, press **/** and type. Every word you type must appear in the part's name, description, category or value. **Enter** places the first match.

![Searching the Parts panel for 2n39](images/02-parts-search.png)

While a part follows the mouse, **Ctrl+R** rotates it by 90° and **Ctrl+E** mirrors it. (Ctrl on every platform: ⌘R is not used.)

## Wires

1. Press **W** or click **Wire**.
2. Click where the wire starts, usually on a pin end.
3. Move the mouse. The wire is drawn with one corner; press **/** to flip which way the corner goes.
4. Click to add a corner and keep going, or click on a pin or another wire to finish.
5. Double-click or press **Esc** to stop without connecting.

![Drawing a wire from the out label; / made it go down first](images/02-wire.png)

Connection rules:

- Wire ends and pin ends connect where they meet.
- A wire that ends on the middle of another wire makes a T-junction.
- A pin never connects to the middle of a wire. A part dropped onto a wire is not connected (and not shorted).
- A green dot marks a junction of three or more connections.
- A small red square marks a pin with nothing connected to it.

## Buses

A bus is one thick line that stands for a group of nets, such as the eight lines of a data bus. It keeps a busy drawing readable; the nets themselves still connect by name.

1. Press **B** (or **Place → Bus**, or **Bus** under the pen button) and draw the bus like a wire. A bus joins only other buses, never wires or pins.
2. Put a net label on the bus and name it with a range, such as `D[0..7]` (or `D[7..0]`). The bus now carries `D0` to `D7`. A label with such a name that is not on a bus stays an ordinary net label.
3. Choose **Place → Bus Tap** (or **Bus tap** under the pen button) and click on the bus. A tap is a short diagonal stub from the bus to a wire end. Its value names the member it breaks out, such as `D3`; each new tap takes the next number. Draw a wire from the tap's free end to the part.

A tap joins its wire to the net named by its value, in the same way as a net label, so `D3` on one bus and `D3` on another bus (or a plain `D3` label) are the same net. The netlist stops with an error if a tap names something its bus does not carry, and warns about a tap or bus label that is not on a bus. Buses do not cross into hierarchical blocks: give the sheet one port per member.

## Ground, net labels and the power flag

- **Ground** (G) is net `0`, the reference for all voltages. Every circuit needs at least one ground.
- **Net label** (N) gives a net a name. Labels with the same name are connected, even with no wire between them. New labels get unique names (`n1`, `n2`…) so they don't join by accident; rename them in **Net name**. A label called `0` or `gnd` is ground.
- **Power flag** (the `VCC` part in the Parts panel, or the ⊤ button in the toolbar) is a net label drawn as a supply rail. Two flags called `VCC` are the same net.
- Net names can't contain spaces or `= ( ) , { } " '`.

Labels and flags connect at their pin, so put them on a pin end or a wire end. Named nets show up by name in the results (`V(out)` instead of `V(n001)`).

The four small buttons in the toolbar place a ground, a power flag, a net label and a sheet port.

## Selecting, moving and editing

- Click a part, wire or directive to select it. **Shift+click** adds or removes items.
- Drag on empty canvas to box-select.
- Drag a selection to move it. Wires attached to moved pins follow.
- **Ctrl+R** / **Ctrl+E** rotate or mirror the selected parts.
- **Delete** or **⌫** deletes. ⌘X, ⌘C and ⌘V cut, copy and paste (inside the app only), ⌘D duplicates and ⌘A selects all.

Select a single part to open the inspector. Edit **Name** and **Value** there. Names must start with the right SPICE letter (R for resistors, C for capacitors…). If one doesn't, the app adds the letter when it writes the netlist and shows a warning.

![The inspector for V1, with the Waveform… button](images/02-inspector.png)

Long values are shortened on the canvas; hover over the value to see all of it.

## SPICE directives

Directives are lines of SPICE text that go into the netlist as written: analyses (`.tran`, `.ac`…), `.param`, `.model`, `.include`, `.meas`, `.options` and so on.

1. Press **S**, click **.op** in the toolbar, or choose **Place → SPICE Directive**.
2. Click on the canvas. A card with `.op` appears and is selected.
3. Type in the **SPICE directive** box in the inspector. A card can hold several lines.

Double-click a card to edit it again. If the card holds a single analysis line, the inspector offers **Edit as analysis…**; if it holds an `.options` line, **Edit options…**. Both open the forms described in [chapter 4](04-simulating.md).

## Renumbering parts

After a lot of copying and deleting, part names end up out of order (R7 next to R2). **Tools → Annotate Sheet** renumbers the parts on the current sheet: each prefix (R, C, Q, X…) counts from 1 in reading order, top to bottom, then left to right. **Tools → Annotate Project** does every sheet in a project, top sheet first, and keeps counting from one sheet to the next so every name in the project is different.

References to a renamed part follow it wherever SPICE reads a part name: `i(R1)` and `@R1[i]`, the sources of `.dc`, `.tf` and `.noise`, the V source named by an F, H or W part or line, and the inductors named by a K part or line. Node names (such as `v(R1)` or the nodes of an element line), net labels, model names and comments are left alone. Two parts with the same name each get their own number. A name that does not end in a number (`Rload`) is not changed, and a name already used by an element line in a directive card is skipped. Both commands can be undone with ⌘Z on every sheet that is open in a tab. Annotate Project also renumbers sheets that are not open, and those changes can't be undone; the status bar names them, and closing the project without saving drops them.

## Importing LTspice and KiCad schematics

**File → Import Schematic…** reads an LTspice `.asc` file or a KiCad `.kicad_sch` file and adds it to the sheet you are on, to the right of what is already there, selected so you can move it. To import into an empty sheet, add a sheet in the Sheets panel first (or start a blank project).

What is converted:

- Resistors, capacitors, inductors, voltage and current sources, diodes (plain, Zener, Schottky, LED), NPN and PNP transistors, MOSFETs, JFETs, controlled sources (E, G, F, H), behavioural sources, switches and transmission lines, with their names, values, rotation and mirroring.
- Op-amps: LTspice's ideal `opamp` becomes the ideal op-amp. Other op-amps become the generic op-amp model `OA_GENERIC`: KiCad ones with their pins matched by name, LTspice ones from the `OpAmps` folder only when all five pins (in+, in−, V+, V−, out) of a standard op-amp layout are wired. An LTspice file doesn't say which pin is which, so those are matched by position and the report asks you to check the supply pins. Anything else from that folder (instrumentation amplifiers, buffers, parts with compensation or shutdown pins) becomes a placeholder. Import the vendor model in Manage Libraries if you need it.
- Ground, net labels, power symbols, hierarchical labels (as ports), wires and junctions. The connections follow the source program's rules: in LTspice anything touching a wire joins it; in KiCad a label joins a wire anywhere along it, but a pin or another wire's end joins only at a wire's end or at a junction. Where this app's symbol is a different size, a short wire joins its pin to the original pin position, or, where that wire would touch another net, a pair of net labels with that net's name does. After placing everything, the import compares the nets with the original's and redoes any part that differs; if a difference remains, the report names the nets.
- SPICE directives (LTspice `!` text, KiCad text starting with `.`) become directive cards. LTspice's `.tran <stop>` gets a step, and `startup` and `.backanno` are removed. Comments become text notes; lines, rectangles and circles become shapes.
- A transistor or diode whose model name matches a built-in part (2N3904, 1N4148…) uses that part. KiCad source settings (`Sim.Type`, `Sim.Params`, or the older `Spice_Model`) become the source's value.

An imported file can run commands when you press Run: through a `.control … .endc` block, through a line starting with `*#` (ngspice runs those as commands too), or through a file that an `.include` or `.lib` line pulls in. So the import turns every `.control` block and every `.include`, `.inc` and `.lib` line into comment lines (`* ` in front), changes `*#` to the ordinary comment `* #`, and lists each one in the report. A `.model` line is kept only for the ordinary SPICE devices (diodes, transistors, MOSFETs, JFETs, switches, resistor, capacitor and inductor models and the like); any other model type, such as an XSPICE code model, can run a program or read a file, so it is turned into comment lines too. To use a block or an include, check it (and the file it reads), then delete the leading `* ` on the directive card.

Anything else becomes a **placeholder**: a block drawn with a red dashed outline, its value starting with `?`. KiCad placeholders keep their pins where the original pins were; LTspice placeholders have no pins, because an `.asc` file does not say where a symbol's pins are. The netlist stops with an error until you replace every placeholder. After the import, a report lists what was not converted or was converted with a change, including any line of the file that was skipped because it was damaged. Buses, hierarchical sheets and arcs are not converted. In LTspice a net called `GND` is not ground, so it is renamed `GND_`; in KiCad, a net that is ground here only because of a `GND` label is named in the report. Files with more than 20,000 wires or 5,000 symbols are refused.

## Notes, shapes and the title block

Annotations explain a drawing. They are never written to the netlist, even when a note looks like SPICE.

- **Text note**: press **T** (or **Place → Text Note**, or the pen button in the toolbar), then click. Type in the inspector; a note can hold several lines. **Size** picks Small, Normal, Large or Huge.
- **Shapes**: choose **Line**, **Arrow**, **Rectangle** or **Ellipse** from the pen button or **Place → Shape**. Click where the shape starts, then click where it ends. The line tool keeps going from the last point, so you can draw a polyline; double-click or press **Esc** to stop.
- **Title block**: choose **Title block** from the pen button or **Place → Title Block**. It appears under the bottom-right corner of the drawing with the sheet name, today's date and revision A. Select it to edit **Title**, **Author**, **Date** and **Revision**. In a project, **Sheet n of m** is filled in from the Sheets panel. Choose **Title block** again to remove it. Each sheet has its own.

Notes, shapes and the title block are selected, moved, copied, pasted, deleted and undone like parts, and they appear in exported and printed schematics. **Ctrl+R** and **Ctrl+E** turn and mirror selected shapes (and bus segments) about their own centre; text stays upright.

## Undo

⌘Z undoes and ⇧⌘Z redoes (Ctrl+Y also redoes on Windows and Linux). Each open sheet keeps its own history while the project is open. The **↶** and **↷** toolbar buttons do the same.

## The source waveform editor

Voltage and current sources take their whole specification in one value, such as `DC 0 AC 1 PULSE(0 1 0 1u 1u 5m 10m)`. The waveform editor builds it for you.

1. Select a voltage or current source.
2. Click **Waveform…** in the inspector.
3. Fill in **DC value** (the value for `.op` and `.dc`), **AC magnitude** and **AC phase** (for `.ac` and `.noise`). Leave a field blank to leave it out.
4. Choose a **Transient waveform** and fill in its fields. Blank optional fields use ngspice's default.
5. Check the preview and the **Value** line at the bottom, then click **Apply** (or press ⌘↵). **Esc** cancels.

![The waveform editor showing a pulse](images/02-waveform-pulse.png)

| Waveform | SPICE | Fields |
|---|---|---|
| Pulse | `PULSE(V1 V2 TD TR TF PW PER NP)` | initial value, pulsed value, delay, rise time, fall time, pulse width, period, number of pulses |
| Sine | `SIN(VO VA FREQ TD THETA PHASE)` | offset, amplitude, frequency, delay, damping, phase |
| Exponential | `EXP(V1 V2 TD1 TAU1 TD2 TAU2)` | initial value, pulsed value, rise delay, rise time constant, fall delay, fall time constant |
| Piecewise linear | `PWL(t1 v1 t2 v2 …) r=… td=…` | a table of time/value points, **Repeat from (r=)** and **Delay (td=)** |
| FM (SFFM) | `SFFM(VO VA FC MDI FS)` | offset, amplitude, carrier frequency, modulation index, signal frequency |
| AM | `AM(VA VO MF FC TD PHASEM PHASEC)` | amplitude, offset, modulating frequency, carrier frequency, delay, phases (no preview) |

For a piecewise-linear source, add rows with **Add point** and remove them with **×**. Times must not go backwards. **Repeat from** must be one of the point times; the waveform then repeats from that point.

![The waveform editor in piecewise-linear mode](images/02-waveform-pwl.png)

If a value uses syntax the editor doesn't cover, it is shown as plain text and kept exactly as you wrote it.

### Sources driven by a file

Two more waveforms read their data from a file when you run the simulation:

| Waveform | SPICE | The file |
|---|---|---|
| PWL from a file | `PWL file="drive.csv"` | Two columns, time and value, one point per line. Columns can be separated by spaces, tabs or commas, and values can use SI suffixes (`1m`). Decimal commas work with a semicolon between the columns (`0,001;1,5`) or with a tab or space (`0,5	1,5`); a line that could be read either way (`0,5 1`) is an error. A first line that isn't numbers (a CSV header) is skipped, as are lines starting with `#`, `*`, `;` or `//`, and text after `;`, `#` or `//` on a line is a comment. Times must not go backwards; a repeated time makes a step (the second point is moved 1 part per billion later, because ngspice needs increasing times). |
| WAV file | `wavefile="speech.wav" chan=0` | A `.wav` file played as the source's value: full scale is ±1 V (or ±1 A for a current source). **Channel** 0 is the left channel, 1 the right. PCM (8, 16, 24 or 32-bit) and 32/64-bit float files work. |

1. Choose **PWL from a file** or **WAV file** as the **Transient waveform**.
2. Click **Browse…** and pick the file. A file inside the project folder is stored as a path relative to it, so the project still works when you move or share the folder. You can also type a path.
3. Click **Apply**.

The file is read each time you run, so you can edit it between runs. The DC and AC fields still apply. Before ngspice runs, the app turns the file into an inline `PWL(…)`, with one point per line or sample. ngspice slows down with the square of the number of points, so a file source can have at most 100,000 points (about 2.3 s of 44.1 kHz audio), and the file must be an ordinary file of at most 64 MB. For longer audio, shorten or resample the file. A missing or unreadable file stops the run with a message in the console that names the file and, for a bad line, its line number.

The same syntax works in a hand-written netlist (it is LTspice's).

Next: [Component reference](03-components.md).
