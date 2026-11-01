# Spice Studio user guide

This guide shows you how to draw circuits in Spice Studio and simulate them with ngspice. It is written for students and engineers who know some electronics but have not used SPICE before. For a feature overview and how the app works inside, see the [project README](../../README.md).

Keyboard shortcuts are written for macOS (⌘). On Windows and Linux, use Ctrl where the guide says ⌘.

## Chapters

1. [Getting started](01-getting-started.md): install, the Home page, your first project and your first simulation.
2. [Drawing schematics](02-drawing-schematics.md): parts, wires, labels, ground, editing values, directives, undo and the source waveform editor.
3. [Component reference](03-components.md): every part kind, its pins and its value syntax, with worked examples.
4. [Simulating](04-simulating.md): the Analysis dialog, `.options`, Run and Stop, Run settings, the rules check and convergence help.
5. [Reading results](05-results.md): plots, probing, the operating point, cursors, expressions, FFT, measurements and the pop-out window.
6. [Sweeps and Monte Carlo](06-sweeps.md): `.step param`, `.step temp` and `.mc`.
7. [Projects and hierarchy](07-projects-and-hierarchy.md): sheets, the top sheet, ports and blocks.
8. [Component libraries](08-libraries.md): the library browser, importing vendor models, packs and compatibility mode.
9. [Exporting](09-exporting.md): plots, schematics and netlists.
10. [Troubleshooting](10-troubleshooting.md): common ngspice errors and what to do about them.

Also: [Keyboard shortcuts](shortcuts.md).

## Example projects

The chapters use the projects in [`examples/`](examples/). Each is a folder with a `.nsproj` file and its sheets. To open one, choose **Open project** (⌘O) on the Home page and pick the `.nsproj` file.

| Example | What it shows | Chapter |
|---|---|---|
| [RC-Filter](examples/RC-Filter/) | RC low-pass, transient and AC analyses | 1, 2, 5 |
| [CE-Amplifier](examples/CE-Amplifier/) | 2N3904 common-emitter amplifier, operating point, `.meas` | 5 |
| [E-Amplifier](examples/E-Amplifier/) | Voltage-controlled voltage source (E) as a ×10 amplifier | 3 |
| [Flyback](examples/Flyback/) | Transformer, voltage-controlled switch and diode | 3 |
| [RC-Sweep](examples/RC-Sweep/) | `.step param` over three resistor values | 6 |
| [Diode-TempSweep](examples/Diode-TempSweep/) | `.step temp` on a 1N4148 diode | 6 |
| [MonteCarlo-RC](examples/MonteCarlo-RC/) | `.mc 20` with a ±5 % resistor | 6 |
| [Hier-Filter](examples/Hier-Filter/) | Two copies of a filter sheet used as blocks | 7 |
| [ECG-Frontend](examples/ECG-Frontend/) | 3-electrode ECG, one sheet per stage: op-amp instrumentation amp, right-leg drive, filters, QRS detector, LED per beat; `.plot` charts and frequency response | 5, 7 |

[`examples/make-examples.ts`](examples/make-examples.ts) regenerates them, and [`images/README.md`](images/README.md) says how the screenshots were made.
