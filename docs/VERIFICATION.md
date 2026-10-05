# Verification report — 2026-10-05

## Passed on the development Linux environment

- `npm test`: 55 TypeScript domain/provider/render/viewport tests using Vitest 5.0.3.
- `npm run build`: TypeScript and optimized Vite build pass.
- `npm run test:native`: 21 real-file Python/HTTP/packaging tests pass.
- `npm run test:desktop`: 11 launcher/protocol unit tests pass.
- Frozen Linux x64 native executable: fresh-process import/export, full 326-object authored scene, private HTTP ownership/origin guards, Unicode install path, shutdown, relaunch and failure reporting pass.
- Independent reviewer reproduced native no-op/edited roundtrips, trigger/object preservation and HTTP guards.
- Full `npm audit` against the patched lockfile: zero advisories across 522 dependencies (Electron 44.5.1, Vitest 5.0.3, electron-builder 26.15.3).
- Electron main/preload and development scripts pass Node syntax checks.

Native tests exercise the exact pinned public 1.59 fixture and original derived fixtures, not a user-supplied game file. See `NATIVE-FORMAT.md` and `fixtures/SOURCES.json`.

## Measured performance

`benchmark.json` records five real seeded generation measurements per 64, 120, 240 and 480 square map. It records machine, runtime, every sample and the actual median; no warmup results are discarded. Running other work concurrently can materially affect timings. It does not measure canvas FPS.

`native-benchmark.json` records three real timing measurements each for import, byte-identical no-op export, edited preservation export and generated Mistbridge export. Export includes compilation and separate fresh-process verification.

## Unverified / explicit blockers

- Current AoE2 game build loading, playing, saving, pathfinding, AI behavior and story timing: no game executable or user sample supplied.
- macOS and Windows runtime, installer, signing/notarization: not executed on this Linux environment.
- Self-contained desktop runtime bundling is implemented and Linux native smoke-tested. End-user macOS/Windows package/GUI checks remain pending exact-commit CI; signing, notarization and clean-machine install/uninstall remain untested.
- Local cloud-browser navigation is blocked by the browser host (`ERR_BLOCKED_BY_CLIENT` for loopback). No network alias or tunnel was used. A separate owner-private static preview was successfully deployed; its real page shows the expected owner sign-in gate in the cloud browser. The static preview itself remains blocked behind owner sign-in in that browser. Access was not broadened. Separately, the actual packaged Linux application was successfully launched and tested through native desktop controls, as recorded below.
- No actual language model connection; rule starter only. No asset extraction or game sprite rendering.

The previously published alpha commit `aafb4f92860cf9672d7e8382d3548a08148c0c87` passed its source/test/native/audit matrix on Linux, macOS and Windows in [run 37346279753](https://github.com/AKin-lvyifang/mistbridge-campaign-studio/actions/runs/37346279753). That alpha matrix did not include the later self-contained packaging milestone. Current desktop installer status must be checked against the exact subsequent commit; a workflow definition alone is not a passing result.

## Actual packaged Linux desktop UI

The application was launched normally from `release/linux-unpacked/aoe2-campaign-studio` on the dot cloud Linux/Xfce desktop. No sandbox, CSP, certificate or OS security controls were disabled. This is actual desktop execution, not a mockup or a tunneled browser preview.

Verified through native controls: viewport zoom and minimap navigation; a five-tile terrain stroke followed by undo; object-list selection linked to map and inspector; Town Center X coordinate changed from 26.5 to 28.5 then undone; story-node inspection with explicit instant-camera semantics; and native scenario export through the bundled service and native save dialog. The exact saved UI output was independently imported as DE 1.59, 120×120, 326 objects, four triggers, SHA-256 `638cb7aca3fcddd1bedf74d928c6931d67b9ca0cb4428c48c0bffa4d1eb2e28f`, matching the final generated example. Normal Quit closed the application and no owned native service remained.

This manual pass used an 1180×812 content window on a 1364×1024 cloud desktop. It is a focused functional/visual check, not exhaustive accessibility, high-DPI, platform-native file-dialog, installer or game acceptance.
