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
