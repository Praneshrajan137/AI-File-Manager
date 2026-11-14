# Workspace Agent Rules — AI File Manager

## Hardware & Remote-First CI Rule (Mandatory Across Every Session)

This project is developed on a **12 GB RAM + RTX 3050 laptop**. Treat local compute and RAM as scarce:

1. **NEVER run heavy CI, heavy build/packaging, or heavy test suites locally.** Specifically forbidden on the local laptop unless the user explicitly overrides for a one-off check:
   - Full `npm run test:coverage` / `jest --coverage` across the entire repo
   - Full `npm run test:e2e` / `npx playwright test` (Electron/Chromium multi-spec runs)
   - Full `npm run test:all` or `npm run package` (`electron-builder`)
   - Full multi-bundle production builds (`npm run build`) when avoidable, 10,000-file stress benchmarks, or heavy real ONNX/Ollama multi-model batch benchmarks
   - Heavy local GitHub Actions emulation (e.g. `act` / Docker CI containers)
2. **What to run locally (fast, lightweight sanity checks ONLY):**
   - `npm run type-check` (`tsc --noEmit`)
   - Targeted ESLint on touched files (`npx eslint <paths>`)
   - Single or targeted small mocked Jest unit test files (`npx jest <single-test-file> --runInBand --maxWorkers=1`)
3. **Where ALL heavy CI, full test suites, coverage gates, builds, and Playwright E2E MUST run:**
   - **Run them ONLY in GitHub Actions** via `.github/workflows/` (`origin`: `Praneshrajan137/AI-File-Manager`).
   - Push changes cleanly, trigger/monitor the GitHub Actions run (`gh run list`, `gh run watch`, `gh run view --log-failed`), **wait for the real cloud CI results**, fix any failure cleanly, and re-verify in GitHub Actions before claiming completion.
