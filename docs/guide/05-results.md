# 5. Reading results

[Guide index](README.md) · Previous: [Simulating](04-simulating.md) · Next: [Sweeps and Monte Carlo](06-sweeps.md)

The screenshots in this chapter use [examples/CE-Amplifier](examples/CE-Amplifier/), a 2N3904 common-emitter stage with `.op`, `.tran`, `.ac` and a `.meas` line.

## The results panel

After a run, the results panel on the right has:

- **Tabs**, one per analysis (*Operating Point*, *Transient Analysis*, *AC Analysis*, *DC transfer characteristic*, *Noise…*) in the order of your analysis directives, plus **Measurements** when the deck has `.meas` lines. The first tab is shown after a run.
- **The vector list** on the left of the plot: **Voltages**, **Currents** and **Expressions**. Tick a box to plot that vector. The first few voltages are ticked for you. **Search vectors** at the top filters the list by name (`ecg`, `i(d1)`, `x3`); **Enter** ticks the first match, **Esc** clears the search.
- **The plot.** Voltages and currents get separate, titled y axes (currents on the right), so a milliamp trace isn't flattened next to a 10 V one. The legend under it names each trace and shows its value under the mouse.
- **The console** under the plot: the netlist that was run and ngspice's output.

Plot controls:

- Drag across the plot to zoom; drag mostly sideways to zoom in time only. Double-click to zoom back out.
- AC plots open in the **Bode** view: magnitude above phase on one log-frequency axis. **Magnitude** and **Phase** show one of them on its own; **Nyquist**, **Polar** and **Smith** draw the complex values (see [AC views](#ac-views-bode-nyquist-polar-smith)).
- Transient plots have **Time**, **FFT** and **Eye** buttons (see below).
- The legend under the plot shows the values under the mouse.

An analysis that produces a single point, such as `.op`, is shown as a table instead of a plot.

### Choosing the plots with `.plot`

Put `.plot` lines in a directive to pick what is plotted after each run. Each line becomes its own chart, stacked in the analysis's tab, so signals of very different sizes (millivolts at the electrodes, volts after the amplifier) each get a readable scale:

```
.plot tran v(la,ra) ; Electrodes
.plot tran v(ina) v(ecg) ; Amplified
.plot tran I(D1) v(led_a,led_k) ; LED current and voltage
```

Text after `;` (a SPICE inline comment) becomes the chart's title. When the charts don't fit, the stack scrolls.

The word after `.plot` names the analysis (`tran`, `ac`, `dc` or `noise`). An entry can be a vector name or any [expression](#expressions), written without spaces. Each chart keeps its own vector list, so you can tick more traces into it, and Alt+click probes go into the top chart. ngspice ignores `.plot` lines when it writes results for the app, so they don't change the simulation. The [ECG-Frontend](examples/ECG-Frontend/) example uses four.

## Probing the schematic

You can add traces straight from the schematic after a run. Probing works on the top sheet, which is the circuit that was simulated.

- **Alt+click a wire, label or pin** to add that net's voltage to the current tab.
- **Alt+click a part** to add the current through it (for a transistor, the collector or drain current).
- Alt+click the same thing again to remove its trace.
- Or press **P** (or click **Probe**) to use the probe tool, where a plain click probes. **Esc** goes back to Select.

While Alt is held, the net or part under the mouse is highlighted.

![Alt+click on the out wire and on the in wire added V(out) and V(in)](images/05-probe.png)

**Differential voltage.** Alt+drag from one net to another (a dashed line follows the mouse) and release on the second net. The app adds the expression `v(first)-v(second)`. Dragging to or from ground gives the plain voltage of the other net.

![Alt+drag from VCC to out added v(vcc)-v(out), the voltage across R3. Alt+click on R3 added I(R3)](images/05-differential.png)

The status bar confirms each probe (`Added V(out)`, `Added v(vcc)-v(out)`), or says why nothing was added, for example `Run a simulation first` or `Ground is the 0 V reference`.

## The operating point on the schematic

If the deck includes `.op`, every named or wired net gets a small yellow tag with its DC voltage after the run. The **OP** toolbar button (or **View › Show Operating Point**) hides and shows them. The tags disappear when you edit the sheet, because they would be out of date.

![Operating-point voltages on the common-emitter amplifier](images/05-op-overlay.png)

The **Operating Point** tab lists the node voltages and device currents as a table:

![The Operating Point table](images/05-op-table.png)

## Cursors

1. Click on the plot to place cursor **A**.
2. **Shift+click** to place cursor **B**.
3. Drag a cursor line to move it.

A readout table appears under the plot. For each trace it shows the value at A, at B, the difference **B − A** and the **slope** (ΔY/ΔX). The first row shows the x values, their difference, and **1/Δ**, which is the frequency when A and B are one period apart. Click **×** in the table to remove both cursors.

![Cursors A and B one period apart: 1/Δ reads 1.009 kHz](images/05-cursors.png)

Cursors stay where they are when you switch tabs or pop the plot out, until the next run.

## Expressions

Type a formula into **＋ expression** under the vector list and press **Enter**. It is plotted like any other trace and kept across runs. Click **×** to remove it. A formula with a mistake shows the error in red under the box.

| You can use | Example |
|---|---|
| Any vector by its raw or display name | `v(out)`, `i(r3)`, `ic(q1)` |
| Differential voltage | `v(a,b)` is the same as `v(a)-v(b)` |
| Arithmetic with `+ − * /` and brackets | `(v(vcc)-v(out))/4.7k` |
| SPICE numbers | `1k`, `2.2u` |
| `db(x)` | gain in dB: `db(v(out)/v(in))` |
| `mag(x)`, `abs(x)` | magnitude |
| `ph(x)` | phase in degrees |
| `re(x)`, `im(x)` | real and imaginary parts (AC) |
| `sqrt(x)` | square root |
| `deriv(x)` | derivative with respect to the x axis, e.g. `deriv(v(out))` in V/s |
| `gd(x)` | group delay of an AC result, in seconds |

Units follow the maths: volts times amps is watts, so `v(out)*i(r1)` or `(v(vcc)-v(out))*i(r3)` is plotted as power in W on its own axis. In AC results, expressions work on complex values, so `db(v(out)/v(in))` is the true gain.

## AC views: Bode, Nyquist, polar, Smith

An AC tab has two rows of view buttons.

- **Bode** (the default) stacks the magnitude in dB over the phase in degrees. The two charts share the frequency axis: zooming one zooms the other, and cursors A and B show in both. One legend, under the phase chart, shows both values under the mouse (`-3.01dB · -45.0°`). The cursor readout lists each trace twice, once in dB and once in degrees.
- **Magnitude** and **Phase** show one chart, as before.
- **Unwrap phase** (Bode and Phase) removes the jumps from −180° to +180°, so a fourth-order filter's phase runs smoothly down to −360°.
- **Nyquist** plots Im against Re with equal scales, with −1 marked when it is in view.
- **Polar** draws the same points on a polar grid: magnitude rings and angle spokes.
- **Smith** draws reflection coefficients on a Smith chart. S-parameters (from a `.sp` analysis) are drawn as they are. A trace in ohms, such as the expression `v(in)/i(v1)` or a `Z_1_1` vector, is converted with Γ = (Z − Z0)/(Z + Z0); set **Z0** in the sidebar (50 Ω by default). Any other trace is drawn as if it were Γ. Parts of a trace outside |Γ| = 1 are cut off at the edge of the chart.

In the Nyquist, polar and Smith views, hover over a trace to read its frequency and value in the top-right corner (on the Smith chart also the impedance). Click a trace to put cursor A at that frequency, Shift+click for cursor B; dots mark each trace at A and B. In the Nyquist and polar views, scroll to zoom (Nyquist zooms about the mouse) and double-click to see everything again. All ticked traces share one scale, so a small trace next to a large one (a current next to a voltage) can shrink to a dot: untick the large one or zoom in. Only complex traces are drawn there: `db(…)` and other real expressions are left out. **PNG**, **SVG** and **CSV** export these views too; the CSV has the real and imaginary parts.

## Eye diagram

On a transient tab, click **Eye** to overlay a waveform period by period, as an oscilloscope eye diagram does.

1. Pick the **Trace** (one of the ticked traces).
2. Type the **Bit period**, for example `1u`.
3. Optionally type an **Offset**: periods start at offset + k × period, so an offset moves the eye sideways (use it to centre the crossings).

Every whole period in the run is drawn over the others, up to 2,000; with more, the axis title says how many of them are shown (`the first 2000 of 5000 periods`). The app resamples the waveform at 256 points per period, so set a small **Max step** in the `.tran` line for sharp edges. Drag to zoom, double-click to zoom back out. PNG and SVG export the eye.

## Tuning values with sliders

**Tune** in the results tab bar opens a row of sliders above the plots.

1. Pick a value in **Add a parameter or part…**: a `.param` with a plain number, or a resistor, capacitor or inductor whose value is a number. Parameters a `.step` line sweeps aren't offered, since the sweep sets them.
2. Each slider covers a decade either side of the value on a log scale. Edit the minimum and maximum, or untick **log** for a linear scale.
3. Move the slider. The app runs the simulation again a moment after you stop moving it, and stops a run that is still going if you move it again.

The plot updates in place: the zoom, the cursors and the ticked traces stay as they are. Every run while the sliders are open uses the slider values, and the console starts with a `Tuned:` line listing them. The values are not written back to the schematic. Remove a slider (**×**) to go back to the netlist value. Closing the row goes back to all the netlist values and runs the simulation once more with them, so the plot matches the schematic again. The sliders stay in use if you pop the results out or dock them.

## FFT

On a transient tab, click **FFT** to see the spectrum of the ticked traces.

1. Optional: place cursors A and B first. The FFT then uses only the time between them; for a clean spectrum, span a whole number of periods after the circuit has settled.
2. Click **FFT**. **Log f** and **Linear f** switch the frequency axis.
3. Click **Time** to go back.

The hint line under the plot shows the settings: a Hann window, the number of points N (a power of two, up to 65,536) and the bin spacing Δf. ngspice's time steps are uneven, so the app resamples the waveform first; for an accurate spectrum, set a small **Max step** in the `.tran` line.

![FFT of V(out) and of the power in R3](images/05-fft.png)

## Measurements (`.meas`)

A `.meas` directive makes ngspice compute a single number from a result, such as a peak-to-peak value, a rise time or an average. The CE-Amplifier example has

```
.meas tran vpp PP v(out) from=2m to=5m
```

After a run, the **Measurements** tab lists each measurement by name. A measurement that failed (for example, a `WHEN` condition that never happens) shows **failed**; hover over it to see ngspice's message.

![The Measurements tab](images/05-measurements.png)

Some useful forms:

```
.meas tran vavg AVG v(out) from=1m to=2m
.meas tran vmax MAX v(out)
.meas tran trise TRIG v(out) VAL=0.1 RISE=1 TARG v(out) VAL=0.9 RISE=1
.meas tran t50 WHEN v(out)=0.5 RISE=1
.meas ac fpeak WHEN vdb(out)=-3 FALL=1
```

ngspice reports measurements for one analysis type only. If the deck has both `.tran` and `.ac`, only the `tran` measurements appear. Put `.ac` measurements in a separate project, or remove the `.tran` line while you need them.

With a sweep or Monte Carlo run there is one column per run, plus **mean**, **σ**, **min** and **max** when there are more than two runs ([chapter 6](06-sweeps.md)).

## The pop-out window

Click **⧉** at the top right of the results panel (or **View › Results in Separate Window**) to move the results into their own window. You can put it on a second screen and make it as large as you like. It stays live: new runs, probes and expressions appear there. Click **Dock** (or close the window) to bring the results back.

While the results are popped out, the right edge of the main window shows a **Results** rail; a dot on it means new results arrived. ⌘3 shows or hides the docked results panel.

Next: [Sweeps and Monte Carlo](06-sweeps.md).
