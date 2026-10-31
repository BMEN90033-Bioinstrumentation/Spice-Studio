# ngspice Studio

A desktop front end for the [ngspice](https://ngspice.sourceforge.io/) circuit simulator: draw
schematics (including hierarchical, multi-sheet projects), edit netlists, run simulations and
plot the results. Electron + React + TypeScript, built with electron-vite. Packaged builds ship
their own ngspice, so nothing else needs installing.

## Development

```sh
npm install
npm run dev          # app with hot reload
npm test             # unit tests (node --test)
npx tsc --noEmit     # typecheck
```

The app looks for ngspice in this order: `NGSPICE_PATH`, the bundled build
(`vendor/ngspice/<platform>-<arch>/` in dev, `Resources/ngspice/` when packaged), then
Homebrew (`/opt/homebrew/bin`, `/usr/local/bin`) and `PATH`. The engine in use is shown at
the top right of the Home page (hover for its path).

## Building the bundled ngspice

ngspice is built from source into `vendor/ngspice/<platform>-<arch>/` (`bin/`, `lib/ngspice/*.cm`,
`share/ngspice/`, `COPYING`, `THIRD_PARTY_NOTICES.md`). Put the ngspice source in
`ngspice-ngspice/` (or set `NGSPICE_SRC`), then:

```sh
git clone https://git.code.sf.net/p/ngspice/ngspice ngspice-ngspice
npm run ngspice:build               # macOS / Linux (needs autoconf automake libtool bison flex)
bash scripts/build-ngspice-win.sh   # Windows, from an MSYS2 MINGW64 shell
```

## Packaging

```sh
npm run dist:mac     # dmg + zip for this Mac's arch (MAC_ARCH=x64 or arm64,x64 to change)
npm run dist:win     # NSIS installer, x64
npm run dist:linux   # AppImage + deb, x64
```

Output goes to `dist/`. Each target needs its `vendor/ngspice/<platform>-<arch>/` first; the
build stops with a message if it is missing. Config: `electron-builder.cjs`. The icon is
`build/icon.svg`; re-render `build/icon.png` with `npm run icon`.

**macOS signing.** With a "Developer ID Application" identity in the keychain (or `CSC_LINK` +
`CSC_KEY_PASSWORD`, or `CSC_NAME`), the app and the bundled ngspice (binary and `.cm` code
models) are signed with it under the hardened runtime. Notarisation runs when `APPLE_ID` +
`APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` (or `APPLE_API_KEY` + `APPLE_API_KEY_ID` +
`APPLE_API_ISSUER`) are set. Without credentials (or with `CSC_IDENTITY_AUTO_DISCOVERY=false`)
the build is ad-hoc signed: it runs on the machine that built it, but Gatekeeper blocks it elsewhere.

**Windows signing.** Set `CSC_LINK` / `CSC_KEY_PASSWORD` to a code-signing `.pfx`; otherwise the
installer is unsigned and SmartScreen will warn.

**CI.** `.github/workflows/release.yml` builds ngspice and the installers on macOS (arm64 and
x64), Windows and Linux. Pushing a `v*` tag attaches them to a draft GitHub release. Signing
secrets (`MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
`APPLE_TEAM_ID`, `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`) are optional.

## Licenses

The bundled ngspice is mostly BSD-licensed, with LGPL (KLU, numparam), MPL 2.0 (OSDI) and
GPL (`table.cm`) parts. Its `COPYING` and `THIRD_PARTY_NOTICES.md` ship inside the app
(`Resources/ngspice/`) and say what each license requires, including where to get the exact
source. ngspice Studio's own code doesn't have a license file yet.
