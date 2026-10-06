# Verification report — 2026-10-05

## Passed on the development Linux environment

- `npm test`: 146 TypeScript domain/LUI/render/viewport/asset tests using Vitest 5.0.3.
- `npm run build`: TypeScript and optimized Vite build pass.
- `npm run test:native`: 256 real-file Python/HTTP/packaging, synthetic-asset and mocked compatible-provider tests pass.
- `npm run test:desktop`: 15 launcher/protocol/directory-selection unit tests pass.
- Frozen Linux x64 native executable: fresh-process import/export, full 326-object authored scene, private HTTP ownership/origin guards, Unicode install path, shutdown, relaunch and failure reporting pass.
- Independent reviewer reproduced native no-op/edited roundtrips, trigger/object preservation and HTTP guards.
- Last completed full `npm audit` on 2026-10-05: zero advisories across 522 dependencies (Electron44.5.1, Vitest5.0.3, electron-builder26.15.3), with the same package.json/package-lock.json published at `db49c926b5c4aa0dfd6239f0d413427020381f48`. The JavaScript package and lockfile remain byte-identical to that baseline. This is a historical JavaScript-only result; the native-assets revision adds pinned Pillow and genieutils-py Python dependencies and does not claim a fresh advisory scan for them or any other dependency. No new online audit was run.
- Electron main/preload and development scripts pass Node syntax checks.

Native tests exercise the exact pinned public 1.59 fixture and original derived fixtures, not a user-supplied game file. See `NATIVE-FORMAT.md` and `fixtures/SOURCES.json`.

## Measured performance

`benchmark.json` records five real seeded generation measurements per 64, 120, 240 and 480 square map. It records machine, runtime, every sample and the actual median; no warmup results are discarded. Running other work concurrently can materially affect timings. It does not measure canvas FPS.

`native-benchmark.json` records three real timing measurements each for import, byte-identical no-op export, edited preservation export and generated Mistbridge export. Export includes compilation and separate fresh-process verification.

## Unverified / explicit blockers

- Current AoE2 game build loading, playing, saving, pathfinding, AI behavior and story timing: no game executable or user sample supplied.
- macOS and Windows artifacts for the previous alpha were built and smoke-launched in platform CI (see below). The current LUI/relief revision still requires its own exact-commit platform CI. Signing/notarization and clean-machine install/uninstall remain unverified.
- Self-contained desktop runtime bundling is implemented and Linux native smoke-tested. End-user macOS/Windows package/GUI checks remain pending exact-commit CI; signing, notarization and clean-machine install/uninstall remain untested.
- Local cloud-browser navigation is blocked by the browser host (`ERR_BLOCKED_BY_CLIENT` for loopback). No network alias or tunnel was used. A separate owner-private static preview was successfully deployed; its real page shows the expected owner sign-in gate in the cloud browser. The static preview itself remains blocked behind owner sign-in in that browser. Access was not broadened. Separately, the actual packaged Linux application was successfully launched and tested through native desktop controls, as recorded below.
- Real OpenAI-compatible Chat Completions tool-calling integration is implemented and tested with controlled MockTransport responses only. No live account key, provider call, output-quality or billing verification. Native asset previews are tested only with original synthetic fixtures; real game art remains unverified.

The previously published alpha commit `aafb4f92860cf9672d7e8382d3548a08148c0c87` passed its source/test/native/audit matrix on Linux, macOS and Windows in [run 37346279753](https://github.com/AKin-lvyifang/mistbridge-campaign-studio/actions/runs/37346279753). That alpha matrix did not include the later self-contained packaging milestone. Current desktop installer status must be checked against the exact subsequent commit; a workflow definition alone is not a passing result.

## Actual packaged Linux desktop UI

The application was launched normally from `release/linux-unpacked/aoe2-campaign-studio` on the dot cloud Linux/Xfce desktop. No sandbox, CSP, certificate or OS security controls were disabled. This is actual desktop execution, not a mockup or a tunneled browser preview.

Verified through native controls: viewport zoom and minimap navigation; a five-tile terrain stroke followed by undo; object-list selection linked to map and inspector; Town Center X coordinate changed from 26.5 to 28.5 then undone; story-node inspection with explicit instant-camera semantics; and native scenario export through the bundled service and native save dialog. The exact saved UI output was independently imported as DE 1.59, 120×120, 326 objects, four triggers, SHA-256 `638cb7aca3fcddd1bedf74d928c6931d67b9ca0cb4428c48c0bffa4d1eb2e28f`, matching the final generated example. Normal Quit closed the application and no owned native service remained.

This manual pass used an 1180×812 content window on a 1364×1024 cloud desktop. It is a focused functional/visual check, not exhaustive accessibility, high-DPI, platform-native file-dialog, installer or game acceptance.

## LUI and relief revision

The previous published commit `db49c926b5c4aa0dfd6239f0d413427020381f48` passed its Linux/macOS/Windows source matrix and actual packaged application renderer/native-service smoke on macOS arm64, macOS x64 and Windows x64 in [desktop run 37348326256](https://github.com/AKin-lvyifang/mistbridge-campaign-studio/actions/runs/37348326256). Those results do not verify later LUI/relief code.

The new revision was run through native controls on the same Linux desktop: persistent DeepSeek dock, unconfigured/disabled composer, masked empty session-only settings and close/reopen, height tool set to8 with radius4, visibly raised cliff plateau and height-range update, then one-step undo restoring0–2. All native heights0–16 also passed binary export/import regression. Credentials were not entered and no provider request was made. UI mock proposal apply/cancel interactions are not claimed manually verified.

Mocked protocol/unit tests cover bounded tool loops, atomic map/story patches, stale revisions, locked/native objects, destructive confirmation, before/after statistics, credential-echo rejection including decoded Unicode, generic safe errors, request-scoped cancellation, cancelled-before-registration races, session replacement and late-response guards. Exact counts above should be checked by rerunning the aggregate command on the final snapshot.

## Generic-provider revision

The model assistant now supports explicit service name, HTTPS Base URL, model ID and session-only key. DeepSeek and OpenAI are presets; custom compatible endpoints do not receive vendor-specific request fields. Other protocols need adapters. Controlled tests cover separate endpoint/key pairs, public-IP DNS pinning with original TLS SNI/Host, redirects/proxies, private/metadata addresses, process-restart session freshness and history isolation. No live account/provider call has been made.

The height legend distinguishes supported editing levels0–16 from current map minimum/maximum and pointer/target readings; levels are not meters. The separately added limited local native-asset preview slice is described below and in NATIVE-ASSETS.md.

CI installs use --no-audit --no-fund and disable implicit advisory submission. No audit service or CI route substitutes for the omitted online advisory scan. Dependency installation, source checks and packaged-app smoke tests remain enabled.


## Native-asset preview revision

The new isolated implementation passes 70 synthetic asset tests within the 256-test Python suite: DDS pixels/header/type limits, SLD v4 first-frame BC1/transparent blocks/signed anchors/truncation/budgets, genuine synthetic DAT v8.9 serialize→DEFLATE→bounded parse→byte-identical reserialization, and end-to-end civilization/unit/graphic→SLD→PNG through actual subprocess workers and owned HTTP routes. Security checks cover expired handles, source-hash invalidation, symlink and root-ancestor substitution, unsafe DAT filenames, duplicate graphic-name rejection, directory-selection proof and schema limits. The renderer has four additional budget/key/anchor/state tests; Electron has three directory-picker tests.

The frozen Linux native runtime successfully decoded the checked-in original synthetic DDS/SLD, read the synthetic DAT, resolved unit 109, and passed the existing native scene roundtrip/ownership/restart/failure smoke suite. This tests the packaged decoder imports as well as source mode. The complete genieutils-py LGPL source archive is hash-checked and bundled; installed dependency licenses and modified openage-derived SLD notices are retained.

Manual native Linux Electron controls verified the directory picker and its Cancel path, three-file discovery, DAT version/civilization display, 1/18 unit-type resolution in the sample scene, a first-frame transparent 192×192 SLD with hotspot (96,168), and actual session-only placement of that decoded marker on the map's selected ground point. These files are intentionally artificial, not downloaded game resources. The explicit label says mixed preview with unmapped schematic objects and game appearance unverified. Further final QA results accompany the immutable snapshot.

Not verified: actual game asset builds, live game appearance, Windows handle-based reads and directory enumeration races, macOS resource selection, high-DPI/native format variants, full direction/player-color/shadow/child-graphic rendering, automatic terrain-DAT mapping, blend masks or current-game playability. Generic CI history does not verify this new revision; exact-commit platform CI remains required.

Final packaged Linux x64 recheck: normal app launch with sandbox enabled, empty resource session after restart, directory selection, clean non-overlapping catalog rows, DDS 64×64 decode and manual terrain-0 projection passed. The decoded checkerboard visibly appeared only on mapped terrain while unmapped terrain remained schematic. The packaged resource smoke also reports syntheticAssetPreviewVerified=true and packagedResources=true. Linux packaging used the already installed, exact Electron 44.5.1 distribution via electron-builder's supported electronDist option because its default cache path was read-only; no security settings were changed. No installer or game test is implied.

Packaged SLD/map recheck also passed after the layout fix: the decoded survey marker was assigned to unit 109, remained grounded while panning, and could be selected by clicking its actual decoded pixels; the inspector still showed Town Center #109 at X26.5/Y74.5 and map range0–2. This is a synthetic visual/hit-test check, not native art fidelity.

Disconnect-and-clear was verified through the packaged UI: catalog and DAT selection disappeared, cached image references were dropped, and the map returned to original schematic art. No project edit or model request was made during these asset checks.

Independent source/security review reproduced the extracted snapshot tests and required two final corrections: a stale README sentence was removed, and DAT input is now explicitly restricted to 7.7/7.8/8.4/8.8/8.9. A regression test rejects older 7.1–7.6 headers even though the dependency enum recognizes them. The tested DAT binary remains synthetic8.9 only.

Review correction validation: final source aggregate checks pass146 TypeScript,256 Python (70 asset-specific),15 desktop tests and production build. Manual screenshots and frozen/packaged smoke evidence above were captured before the final version-gate tightening; their synthetic DAT8.9 input remains allowed. No new native binary is distributed for this documentation/allowlist correction; exact final-source platform builds remain a separate gate.
