# Bundled desktop builds

## What this milestone implements

The desktop application now bundles its Python interpreter, FastAPI service,
AoE2ScenarioParser 0.9.4, all parser version/dataset files, public/original native
fixtures, built frontend, dependency metadata, licenses and corresponding source.
End users do not need to install Python, Node.js or pip. This replaces the earlier
external-venv-only developer shell.

**Status:** the Linux x64 frozen runtime and its real import/compile/fresh-process
verification have been executed successfully in the development environment.
macOS/Windows installers and their GUI smoke checks are **unverified until the
`Build unsigned desktop apps` workflow succeeds for the exact published commit**.
No game executable has been run. These are unsigned development artifacts, not a
signed/notarized production release. Current CI targets macOS arm64 (`macos-15`), macOS x64
(`macos-15-intel`) and Windows x64 (`windows-latest`); read the artifact's OS/architecture and
`native-build.json`, rather than assuming it is universal or Intel-compatible.

Electron 44 requires macOS 13 or newer and a 64-bit CPU; macOS 12 is not supported.

## Build on the target OS and CPU

Requirements for developers: Node.js 24, Python 3.12 and the checked-in npm
lockfile. PyInstaller and its build dependencies are exactly pinned in
`requirements-build.txt`; runtime dependencies remain pinned in `requirements.txt`.

macOS / Linux:

```sh
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt -r requirements-build.txt
npm run check
npm run test:desktop
npm run desktop:package
```

Windows PowerShell:

```powershell
npm ci
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt -r requirements-build.txt
npm run check
npm run test:desktop
npm run desktop:package
```

`desktop:package` builds the frontend, freezes the local native runtime, tests it
from a Unicode installation path, then runs Electron Builder with publishing
explicitly disabled. It creates macOS DMG/ZIP or Windows per-user NSIS/portable
EXE artifacts under `release/`. Installer and portable names are distinct and
contain `unsigned`. `desktop:dir` performs the same pipeline but creates an
unpacked application directory. On Linux the optional builder target is AppImage;
Linux is currently a development smoke platform, not a certified distribution.

Do not cross-build a Windows installer with a macOS or Linux frozen service, or
mix x64/arm64 components. `package-desktop.mjs` checks the manifest against the
actual host and rejects cross-target arguments. Build separately on each desired
OS/CPU. `npm run desktop` remains the source/developer workflow; it uses `.venv`
(or an explicit `STUDIO_PYTHON`) only when the app is not packaged.

The first native build retrieves the exact parser source distribution from PyPI
and checks SHA-256 against `fixtures/SOURCES.json`. An already verified local
copy is reused. Build outputs are ignored by Git. No tokens, signing keys or
other credentials belong in these files.

## Runtime layout

```text
Application resources/
  app.asar                  Electron main/preload + frontend fallback
  LICENSE
  THIRD-PARTY-NOTICES.md
  THIRD-PARTY-LICENSES.txt
  native/
    studio-native[.exe]     PyInstaller one-directory executable
    _internal/
      Python/shared runtime dependencies
      AoE2ScenarioParser/   Full version/dataset resources
      fixtures/            Public blank and original regression/demo inputs
      dist/                Built React frontend
      licenses/
        native-build.json
        LICENSE.Python.txt
        LICENSE.AoE2ScenarioParser
        per-distribution license files
        corresponding-source/
          application-source.tar.gz
          aoe2scenarioparser-0.9.4.tar.gz
          SHA256SUMS.json
```

The parser's optional external `xs-check` executables are excluded. XS checker
integration remains disabled. Full parser version data is present for the pinned
library to function; the application still accepts only ordinary DE 1.59.

The application source archive snapshots the actual build input files, including
scripts, tests and fixtures, from an explicit safe allowlist. It does not include
user projects, credentials, `.venv`, `node_modules` or generated binaries. The
parser source archive is verified against
`722cf1ce44b7f3a7d4ba2562191fcdf65065e9b69d4de6671b1c49096e081a55`.
Retain these source archives and notices with any redistributed artifact.
The upstream package metadata/LICENSE disagreement is still documented in
`THIRD-PARTY-NOTICES.md`; this distribution follows GPL-3.0-only.

## Process ownership and security

- Packaged apps always start `resources/native/studio-native[.exe]`. A missing
  bundle is a visible startup failure. `STUDIO_PYTHON` and `STUDIO_DEV_URL` cannot
  redirect a packaged application to an external service.
- The child binds an OS-assigned `127.0.0.1` socket before announcing the port on
  its stdout pipe. No fixed-port probing, arbitrary-service attachment or
  close/rebind race is involved.
- Each launch gets a new random in-memory ownership token, passed only to its
  child. The service consumes it from the environment before starting parser
  workers. Every HTTP request requires it; only main verifies the health proof.
  It is not a saved credential and is never sent to an external site.
- The renderer uses the stable, standard and secure `studio://app` origin. This
  preserves localStorage/autosave continuity across runtime-port changes. The
  protocol handler accepts that exact scheme/host, rejects foreign initiators
  and origins, forwards only intended headers to the owned loopback service and
  removes the ownership token from responses. It is not a general HTTP proxy.
- The original native Host, Origin, content-type, size and worker-limit guards
  are unchanged. Electron keeps sandboxed renderers, context isolation, disabled
  Node integration, web security, existing CSP and denied browser permissions.
  No CSP bypass, `--no-sandbox` or certificate/security-warning override is used.
- Import, compile and verification still each start a fresh bounded process.
  Frozen workers re-execute the bundled executable with `--worker`; the HTTP
  process never loads the parser. Unix CPU/memory/file limits and all-platform
  input/wall-time limits remain in place.
- Closing the last macOS window keeps its service for normal reopen. Other
  platforms quit. Application quit closes the parent pipe, waits for graceful
  shutdown, then terminates only the process tree it created if necessary.
  Unexpected service death shows a visible error and leaves an open editor
  available to save the current project. Restart is required for native work.

Automatic drafts remain a convenience; use Save Project for a portable backup.
The explicit startup-error editor-only fallback uses a different file origin and
cannot perform native conversion. Existing `studio://app` drafts are retained for
the next successful full launch.

## Automated evidence

```sh
npm run test:desktop                  # Launcher/protocol unit tests
npm run test:native                   # Native + packaging/guard regressions
npm run native:build                  # Requires an existing production frontend
npm run native:smoke                  # Frozen service and worker integration
node scripts/package-smoke.mjs --packaged
node scripts/package-app-smoke.mjs    # macOS/Windows packaged GUI launch
```

Native smoke tests copy the complete frozen bundle to a Unicode directory and
run independently of the source working directory. They check blank exact-byte
roundtrip; a new native map; an authored 326-object/four-story-node project with
an object and Chinese dialogue edit; real HTTP preservation export; missing/wrong
tokens; origin rejection; frontend resources; no attachment to an unrelated
listener; shutdown; relaunch with a new token; and unexpected-exit reporting.

The packaged GUI smoke starts with a fresh temporary Electron profile. It checks
rendered React content, the isolated preload bridge, native health through the
stable protocol, localStorage reload continuity, and macOS close/reopen. It
captures a PNG and JSON report. CI archives these with PyInstaller warnings and
unsigned end-user artifacts plus corresponding sources. These checks do not
replace an install/uninstall test, actual keyboard/IME/native-dialog interaction,
clean-machine testing, accessibility review or a game playtest.

## Still required before production distribution

- Successful macOS/Windows CI results for the exact commit and advertised CPU
- Manual install/launch/quit/reopen/export/uninstall on clean supported systems
  without Python or Node, including non-ASCII home paths and denied permissions
- macOS Developer ID signing and notarization, Windows Authenticode signing,
  controlled owner credentials, and post-signing checks of nested native binaries
- Native save/open, overwritten-file safety, autosave recovery, interruption and
  high-DPI/keyboard/IME testing on each platform
- Current AoE2 DE game load/save/reopen and gameplay acceptance described in
  `RELEASE-CHECKLIST.md`

Unsigned artifacts can trigger operating-system warnings. Do not disable
Gatekeeper, SmartScreen, Electron sandboxing or OS security settings as a release
workaround. No updater or auto-publication is configured.
