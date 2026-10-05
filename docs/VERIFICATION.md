# Verification report — 2026-10-05

## Passed on the development Linux environment

- `npm test`: 50 TypeScript domain/provider/render tests using Vitest 5.0.3.
- `npm run build`: TypeScript and optimized Vite build pass.
- `npm run test:native`: 13 real-file Python/HTTP tests pass.
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
- End-user desktop runtime bundling: incomplete; current Electron package is a developer shell requiring native Python dependencies.
- Local cloud-browser navigation is blocked by the browser host (`ERR_BLOCKED_BY_CLIENT` for loopback). No network alias or tunnel was used. Hosted private preview QA is recorded separately if the supported browser can access it.
- No actual language model connection; rule starter only. No asset extraction or game sprite rendering.

The CI matrix is included as future automated coverage; its existence alone does not establish a passing remote run.
