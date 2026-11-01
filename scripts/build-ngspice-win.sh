#!/usr/bin/env bash
# Windows (MSYS2 MINGW64) build of the bundled ngspice -> vendor/ngspice/win32-x64/.
# Based on ngspice's compile_min.sh, but as a console build (no --with-wingui) without
# readline, statically linked against the MinGW runtime (LDFLAGS: see the win32 branch of build-ngspice.sh) so
# ngspice.exe and the .cm DLLs depend only on Windows system DLLs.
#
# Run from an MSYS2 "MINGW64" shell (CI: msys2/setup-msys2 with msystem: MINGW64). Packages:
#   pacman -S --needed git make tar autoconf automake libtool bison flex \
#     mingw-w64-x86_64-gcc mingw-w64-x86_64-ntldd-git
#
# All configure/assemble/check logic is shared with the macOS/Linux build in build-ngspice.sh
# (the win32 branches there): spinit codemodel paths become ../lib/ngspice/*.cm, which
# ngspice.exe resolves against its own directory, so no environment variable is needed.
# The dependency check runs `ntldd` and fails on any DLL outside C:\Windows.
set -euo pipefail
[ "${MSYSTEM:-}" = MINGW64 ] || { echo "build-ngspice-win: run inside an MSYS2 MINGW64 shell" >&2; exit 1; }
exec bash "$(dirname "$0")/build-ngspice.sh" "$@"
