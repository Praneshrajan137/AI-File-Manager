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
   - Single or targeted small mocked Jest unit test files (`npx jest <single-test-file> --runInBand`; never pass `--maxWorkers=1` together with `--runInBand`)
3. **Where ALL heavy CI, full test suites, coverage gates, builds, and Playwright E2E MUST run:**
   - **Run them ONLY in GitHub Actions** via `.github/workflows/` (`origin`: `Praneshrajan137/AI-File-Manager`).
   - Push changes cleanly, trigger/monitor the GitHub Actions run, **wait for the real cloud CI results**, fix any failure cleanly, and re-verify in GitHub Actions before claiming completion.

## Non-Blocking Command, Stream & Anti-Hang Protocol (Mandatory Across Every Session)

Prevent terminal stalls, Windows PowerShell buffer deadlocks, and hours-long hangs:

1. **NEVER run bare `gh run watch`, `gh run view --log`, `gh run view --log-failed`, or un-bounded `gh api` pipelines directly in PowerShell.** Large CI logs (e.g., Playwright webpack bundle error stacks) freeze PowerShell streams and TTY waits.
   - ALWAYS monitor CI via `node scripts/ci-watch.mjs watch --branch <branch> --sha <sha> --timeout-sec 900` (or `--run <id>`) and inspect failures via `node scripts/ci-watch.mjs logs --run <id>` — it enforces `stdin: 'ignore'`, headless env vars (`GH_PAGER=cat`, `GH_NO_UPDATE_NOTIFIER=1`, `CI=1`), 20–30s per-call hard timeouts, streaming disk output, and automatic line truncation (`>280` chars).
2. **Always enforce headless env & stdin closure for CLIs:** Set `GIT_TERMINAL_PROMPT=0`, `GH_PAGER=cat`, `PAGER=cat`, `GH_NO_UPDATE_NOTIFIER=1`, and never invoke commands that could open an interactive pager or prompt.
3. **Never buffer multi-MB logs or search results in PowerShell variables/pipes:** Never do `$w = gh api ...` or full-repo `Get-ChildItem -Recurse` into `node_modules`. Scope searches strictly to `Get-ChildItem -Path src,tests -Recurse -Filter *.ts | Select-String ...`.
4. **No complex inline scripts in shell quotes:** Write temporary scripts to `.cjs`/`.mjs` files (or scratch dir) and run `node path/to/script.mjs` rather than escaping quotes/newlines inside `node -e "..."`.
5. **Bounded execution discipline:** Every remote/network command must have a hard timeout (`<=900s` for CI polling, `<=30s` for HTTP/API calls). If a background task produces no progress within its expected window, check `manage_task` status, `kill` it cleanly, and switch to bounded streaming execution rather than waiting passively.
