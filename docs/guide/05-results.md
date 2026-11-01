# 5. Reading results

[Guide index](README.md) · Previous: [Simulating](04-simulating.md) · Next: [Sweeps and Monte Carlo](06-sweeps.md)

The screenshots in this chapter use [examples/CE-Amplifier](examples/CE-Amplifier/), a 2N3904 common-emitter stage with `.op`, `.tran`, `.ac` and a `.meas` line.

## The results panel

After a run, the results panel on the right has:

- **Tabs**, one per analysis (*Operating Point*, *Transient Analysis*, *AC Analysis*, *DC transfer characteristic*, *Noise…*), plus **Measurements** when the deck has `.meas` lines.
- **The vector list** on the left of the plot: **Voltages**, **Currents** and **Expressions**. Tick a box to plot that vector. The first few voltages are ticked for you.
- **The plot.** Voltages and currents get separate y axes (currents on the right), so a milliamp trace isn't flattened next to a 10 V one.
- **The console** under the plot: the netlist that was run and ngspice's output.

Plot controls:

- Drag across the plot to zoom; drag mostly sideways to zoom in time only. Double-click to zoom back out.
- AC plots have **Magnitude** (dB) and **Phase** (degrees) buttons and a log-frequency axis.
- Transient plots have **Time** and **FFT** buttons (see below).
- The legend under the plot shows the values under the mouse.

An analysis that produces a single point, such as `.op`, is shown as a table instead of a plot.

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
