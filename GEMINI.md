# Gemini / Antigravity Workspace Rules — AI File Manager

## Hardware & Remote-First CI Policy (Persistent Across All Sessions)

Always obey the laptop resource constraint (**12 GB RAM + RTX 3050 GPU**):

- **Do NOT run heavy CI, heavy GitHub Actions workflows, full `jest --coverage`, full Playwright Electron E2E suites (`npm run test:e2e`), `npm run test:all`, `npm run package`, 10k-file scale suites, or heavy real ONNX/Ollama evaluations locally.**
- **Local checks must stay lightweight:** `npm run type-check`, targeted `npx eslint <changed-files>`, and single/small targeted unit tests (`npx jest <file> --runInBand`).
- **Offload ALL heavy verification to GitHub Actions (`.github/workflows/ci.yml`)** on `Praneshrajan137/AI-File-Manager`, monitor runs strictly via **`node scripts/ci-watch.mjs`** (never bare `gh run watch` / `gh run view --log-failed`), wait for real cloud results, and continue only after verified pass/fix-forward.

## Non-Blocking Command & Anti-Hang Policy

- Never run un-bounded `gh run watch`, `gh run view --log-failed`, or `$x = gh api ...` in PowerShell (60MB Playwright Webpack error frames hang PowerShell pipes and TTYs). Use `node scripts/ci-watch.mjs watch --run <id> --timeout-sec 900` / `node scripts/ci-watch.mjs logs --run <id>` exclusively.
- Set `GH_PAGER=cat`, `PAGER=cat`, `GH_NO_UPDATE_NOTIFIER=1`, `GIT_TERMINAL_PROMPT=0` on git/gh operations and close stdin on spawned automation subprocesses.
- Never pass complex multiline JS via `node -e` in PowerShell; write a small `.mjs`/`.cjs` scratch script cleanly and run `node <file>`.
- Always enforce explicit per-call timeouts and active watchdog checks so no background task stalls beyond its expected window.
