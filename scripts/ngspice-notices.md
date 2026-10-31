# Third-party notices: bundled ngspice

ngspice Studio ships an unmodified build of [ngspice](https://ngspice.sourceforge.io/)
(the `bin/`, `lib/` and `share/` folders next to this file). The app runs it as a separate
program; it does not link to it. The full license texts are in `COPYING`. This file lists
which of those licenses cover the files shipped here.

| Shipped file | Contains | License |
|---|---|---|
| `bin/ngspice` | ngspice simulator core (Spice3f5 and later work) | Modified (3-clause) BSD |
| | sparse matrix solver (`src/maths/sparse`) | MIT-style, unnamed |
| | KLU sparse solver (`src/maths/KLU`), **statically linked** | LGPL v2.1 |
| | numparam parameter preprocessor (`src/frontend/numparam`), statically linked | LGPL v2 or later |
| | OSDI/OpenVAF model interface (`src/osdi`) | MPL 2.0 |
| | XSPICE simulator extensions (`src/xspice`) | public domain |
| `lib/ngspice/*.cm` except `table.cm` | XSPICE code models | public domain |
| `lib/ngspice/table.cm` | 2-D/3-D table code models (`src/xspice/icm/table`) | GPL v2 or later |
| `share/ngspice/scripts/*` | ngspice start-up scripts | Modified BSD |

The build does not include CIDER, tclspice, ndev, X11, readline, FFTW or OpenMP. The binary
links only to operating-system libraries.

## What this obliges

- **BSD / MIT / public domain:** keep the copyright notices and license text. `COPYING` does this.
- **LGPL (KLU, numparam):** these are statically linked into `bin/ngspice`, so recipients
  must be able to relink the program against a modified copy of those libraries
  (LGPL v2.1 §6). Because all of ngspice is open source, we meet this by pointing to the
  complete source at the revision listed below, together with `scripts/build-ngspice.sh`,
  which rebuilds this exact tree. The LGPL text is part of `COPYING`.
- **MPL 2.0 (OSDI):** the source of those files must be available. The same source pointer
  covers it.
- **GPL (table.cm):** `table.cm` is a separate, dynamically loaded module. If it is
  distributed, its source must be available under the GPL (the same source pointer). If
  shipping GPL code is not acceptable, delete `table.cm` and its `codemodel` line in
  `share/ngspice/scripts/spinit`.
