# Gemini / Antigravity Workspace Rules — AI File Manager

## Hardware & Remote-First CI Policy (Persistent Across All Sessions)

Always obey the laptop resource constraint (**12 GB RAM + RTX 3050 GPU**):

- **Do NOT run heavy CI, heavy GitHub Actions workflows, full `jest --coverage`, full Playwright Electron E2E suites (`npm run test:e2e`), `npm run test:all`, `npm run package`, 10k-file scale suites, or heavy real ONNX/Ollama evaluations locally.**
- **Local checks must stay lightweight:** `npm run type-check`, targeted `npx eslint <changed-files>`, and single/small targeted unit tests (`npx jest <file> --runInBand --maxWorkers=1`).
- **Offload ALL heavy verification to GitHub Actions (`.github/workflows/ci.yml`)** on `Praneshrajan137/AI-File-Manager`, monitor runs with `gh run watch` / `gh run view`, wait for real cloud results, and continue only after verified pass/fix-forward.
