# Third-party notices

The application is distributed under GPL-3.0-only. Keep corresponding source available with distributions.

- AoE2ScenarioParser 0.9.4: installed wheel contains GNU GPL v3 text, despite MIT metadata. Actual license retained at fixtures/upstream/LICENSE.AoE2ScenarioParser. See fixtures/SOURCES.json for pinned wheel/source hashes and commit. Source: https://github.com/KSneijders/AoE2ScenarioParser/tree/e5b483a80f2e6096f019a8ea128eed3aa4f9f188 . The license discrepancy remains unresolved; process isolation does not waive licensing duties.
- React and React DOM: MIT. https://github.com/facebook/react
- Radix Primitives: MIT. https://github.com/radix-ui/primitives
- Lucide icons: ISC. https://github.com/lucide-icons/lucide
- fflate: MIT. https://github.com/101arrowz/fflate
- TypeScript: Apache-2.0. https://github.com/microsoft/TypeScript
- Vite / Vitest: MIT. https://github.com/vitejs/vite and https://github.com/vitest-dev/vitest
- Electron / electron-builder: MIT. https://github.com/electron/electron and https://github.com/electron-userland/electron-builder
- FastAPI / Pydantic: MIT. https://github.com/fastapi/fastapi and https://github.com/pydantic/pydantic
- Starlette / Uvicorn: BSD-3-Clause. https://github.com/encode/starlette and https://github.com/encode/uvicorn

Exact JavaScript dependency versions are in package-lock.json. Exact Python dependencies are in requirements.txt. Their installed distributions retain their individual licenses. This source package does not redistribute node_modules or an Electron/Python runtime; a future bundled release must also include the notices and corresponding source obligations of everything actually bundled.

All map layouts, story text, schematic canvas/SVG artwork and app icons are original to this application. No proprietary AoE2 image/audio assets are bundled. Game names and native numeric IDs are used for interoperability and identification, with no endorsement claim.
