# Guide screenshots

The PNGs here are screenshots of the real app (production build, dark theme, **Fusion Slate Amber** schematic colours), driven over the Chrome DevTools Protocol. They show the example projects in [`../examples/`](../examples/), except the error screenshots (`04-erc-error`, `04-convergence-banner`, `10-cant-find-model`), which use small throw-away broken copies of the RC filter.

`symbols/*.svg` are not screenshots: [`symbols/make-symbols.ts`](symbols/make-symbols.ts) draws them from `src/renderer/src/schematic/symbols.ts`, the same data the app draws from. Regenerate them after changing a symbol:

```sh
node docs/guide/images/symbols/make-symbols.ts docs/guide/images/symbols
```

## How the screenshots were taken

1. Build and start the app with a debugging port and a scratch profile (so your own recent projects and settings are untouched):

   ```sh
   npm run build
   npx electron . --remote-debugging-port=9334 --user-data-dir=/tmp/spice-shots
   node docs/guide/images/cdp.mjs eval "window.api.prefs.set({schTheme:'fusion_slate_amber'}).then(() => 1)"
   ```

2. Size the window to 1440×900 CSS pixels (2880×1800 on a Retina screen):

   ```sh
   node docs/guide/images/cdp.mjs eval 'window.resizeTo(1440, 900)'
   ```

   The README screenshots in `docs/screenshots/` use 1600×1002 instead, which scales to the final 1600 px width with no crop.

   If macOS shows scrollbars all the time (it does with a mouse attached), hide them in the running page. Do this again after every reload, and in the pop-out windows:

   ```sh
   node docs/guide/images/cdp.mjs eval "document.head.appendChild(document.createElement('style')).textContent = '::-webkit-scrollbar{width:0;height:0}'"
   ```

3. Register the examples as recent projects, then reload so they appear on the Home page:

   ```sh
   for n in Hier-Filter Flyback E-Amplifier Diode-TempSweep MonteCarlo-RC RC-Sweep CE-Amplifier RC-Filter; do
     node docs/guide/images/cdp.mjs eval "window.api.project.openPath('$PWD/docs/guide/examples/$n/$n.nsproj').then(() => 1)"
   done
   node docs/guide/images/cdp.mjs eval 'location.reload()'
   ```

4. For each shot, open a project by clicking it in Recent projects, then drive the UI and capture:

   ```sh
   # open an example and run it
   node docs/guide/images/cdp.mjs eval "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'CE-Amplifier').click()"
   node docs/guide/images/cdp.mjs eval "document.querySelector('button.run').click()"
   # Alt+click a wire at CSS position (709, 349) to probe it; capture the window
   node docs/guide/images/cdp.mjs click 709 349 alt
   node docs/guide/images/cdp.mjs shot raw.png
   ```

   [`cdp.mjs`](cdp.mjs) also does `key`, `type`, `move` and `drag`; its header lists them. Set `TARGET='Plots'` or `TARGET='Manage Libraries'` to talk to the pop-out windows instead of the main one. Most screenshots hid the Sheets and Parts panels (⌘1, ⌘2) to give the plots room. A new profile keeps the results panel hidden after a run: click the chart icon at the top right (⌘3) to show it.

5. Crop to the region that matters, limit the size to 1600 px, and reduce to a 256-colour palette (the dark UI has few colours, so this cuts the files to about a third with no visible change):

   ```sh
   sips -c <height px> <width px> --cropOffset <y px> <x px> raw.png   # device pixels = CSS × 2; use offsets ≥ 1
   sips -Z 1600 raw.png --out NN-topic.png
   python3 -c "from PIL import Image; im = Image.open('NN-topic.png').convert('RGB'); im.quantize(256, kmeans=3, dither=Image.Dither.NONE).save('NN-topic.png', optimize=True)"
   ```

   (`sips` treats a crop offset of 0 as "centre", hence the 1-pixel offsets.) `kmeans=3` keeps the amber wires amber; without it the palette pulls them towards the orange of the selection and trace colours. Compare the wire colour with the raw capture after reducing.

6. Quit the app (`pkill -f remote-debugging-port=9334`). Opening the examples never changes them, but don't press Save in the app while taking shots.

Names follow `NN-topic.png`, where `NN` is the chapter number.
