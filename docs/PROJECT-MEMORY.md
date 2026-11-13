# Project Memory — OS File Manager Transformation

**Transformation:** *Unified Contract-Enforced, Self-Observing Reactive Kernel*
**Started:** 2026-11-13 | **Brief:** [PROJECT-BRIEF.md](./PROJECT-BRIEF.md)

---

## Core Architectural Decisions & Rejected Alternatives

| Decision | Choice | Rejected Alternatives & Why |
| --- | --- | --- |
| **Transformation Strategy** | Unified typed IPC/security contracts + single coalescing `EventQueue` causal loop connecting all 5 DSAs & RAG + live `RuntimeDiagnostics` + real UI/E2E verification | *Prune-only cleanup* (guts DSAs & leaves security bypasses); *Vite + native SQLite FTS5 rewrite* (high Win native build churn, wrong leverage priority); *Security-only* (leaves watcher/cache/trie/RAG disconnected). |
| **Hybrid Search Strategy** | LanceDB `0.4.20` dense cosine vectors + pure-TS BM25 (`HybridLexicalIndex`) rebuilt deterministically from LanceDB rows + Reciprocal Rank Fusion (RRF) | `@lancedb/lancedb@0.4.20` JS SDK lacks FTS/BM25 (`Index` only exposes `ivfPq`/`btree`); adding `better-sqlite3`/`sqlite3` risks native ABI friction on Electron 28 + Node 24. |
| **IPC Contract & Error Model** | Single Zod contract registry (`shared/ipc/contracts.ts`) enforcing `filepath`/traversal/symlink security middleware + returning `IPCEnvelope<T>` that `preload.ts` unwraps & rethrows as structured `Error` (`.code`, `.userMessage`, `.details`) | Returning raw `{ ok: false }` everywhere would break existing `try/catch` UI & Playwright error specs; throwing plain objects over IPC causes `[object Object]` coercion. |
| **Temp Root Policy** | Production defaults to `ConfigManager` `allowedRoots` (`[os.homedir()]`); `FILE_MANAGER_ALLOWED_ROOTS` honored strictly when `NODE_ENV === 'test' \|\| E2E_TEST === 'true'` | Hardcoding `os.homedir()` breaks Linux/macOS `/tmp` E2E specs; always trusting env vars weakens production sandbox boundaries. |
| **UI Test Coverage Strategy** | Keep Jest on pure TypeScript logic, handlers, security, kernel & React `react-dom/server` verification (`jest-environment-jsdom` not in `node_modules`) + Playwright real Chromium Electron UI journeys | Installing new npm packages (`jsdom`) avoided unless necessary. |

## Milestone Tracker

- [x] **M0 (Diagnostic Experiment)**: Reproduced M0 watcher/Journey 6 tests (`2/2` in `15.8s`). Confirmed `--remote-debugging-port=9222` static port risk across 30 consecutive launches AND discovered `ipc-communication.spec.ts:134` assertion (`expect(Array.isArray(receivedEvents)).toBe(true)`) silently passed with `0` events received!
- [x] **M1 (Memory, RuntimeDiagnostics & Tooling Baseline)** — `RuntimeDiagnostics` + `shared/diagnostics.ts` live; `jest.config.js` excludes `tests/e2e/`; `webpack.main.config.js` adds `@llm`; `ConfigManager` supports test/E2E-gated `FILE_MANAGER_ALLOWED_ROOTS`; M1 files 0 ESLint errors; `tsc --noEmit` exit `0`; `npx jest tests/unit` `19/19` suites (`356/356` tests) green.
- [x] **M2 (Contract-Enforced IPC & Canonical Security Boundary)** — `shared/ipc/contracts.ts` (28 Zod contracts + safe entry name & regex stream channel) + zero-dep `shared/ipc/envelope.ts`; canonical `PathValidator.validateCanonical` (`fs.realpath` + missing-leaf ancestor walk + dangling symlink/junction blocking + multi-root + Windows case-insensitivity); `withContract` + `IPCEnvelope<T>` error rehydration in `preload.ts`; dynamic `ALL_IPC_CHANNELS` registry + `RUNTIME:GET_DIAGNOSTICS` + `ping`; eliminated path/channel bypasses in `FS:CREATE_*`, `FS:RENAME`, `SEARCH:QUERY`, `LLM:*`, `SHELL:OPEN_PATH`; fixed `main.ts` `will-navigate` `pathToFileURL` & `isDestroyed()` guards; fixed `LLM:QUERY` stream listener cleanup + `[DONE]` bug; lazy fetch in `LLMInterface.ts`. Verified: `npm run type-check` exit 0; `npx jest tests/unit` `20/20` suites (`362/362` tests) passed; M2 files `0` new ESLint errors (`FileSystemService.ts` retains 9 pre-existing `any` catches for M3 refactor).
- [x] **M3 (Closed-Loop Reactive Workspace Kernel & DSA Wiring)** — `FileWatcher` fixed (`appdata`/`temp` ancestor segments above `watchRoot` no longer block `os.tmpdir()`; ignores internal `.file-manager`/`vectordb`/`.lancedb`); `PathTrie` dual-indexed with basename char-trie + last-segment prefix matching; `LRUCache` upgraded with optional `maxBytes` + hits/misses/evictions/invalidations metrics; `FileSystemService` eliminated all 9 pre-existing `any` ESLint errors, bounded `readDirectory` concurrency, and wired `RingBuffer(100)` + `LRUCache` `previewFile`; `ReactiveWorkspaceKernel` connects `FileWatcher` -> coalescing `EventQueue` drain -> `PathTrie`/`LRUCache`/`RuntimeDiagnostics` -> renderer broadcasts across `fileSystemHandlers`, `searchHandlers`, and `main.ts`. Verified: `tsc --noEmit` exit `0`; `npx eslint` M3 files `0` errors; `npx jest tests/unit` `21/21` suites (`367/367` tests in `11.091s`) passed including real Windows `AppData\Local\Temp` watcher create/delete tests.
- [ ] **M4 (Node-Decoupled Hybrid RAG, ContextManager & LLMMetrics)**
- [ ] **M5 (Surgical UI Inspector, Quick Preview Drawer & Control Fixes)**
- [ ] **M6 (E2E Hardening, Full Verification & Adversarial Subagent Review)**

## Acceptance Criteria Ledger

| Criterion | Status | Evidence |
| --- | --- | --- |
| **AC-1** Zero unvalidated path bypasses & symlink escape blocked | Verified (Unit & IPC; E2E in M6) | `PathValidator.validateCanonical` blocks junction/symlink escape on read & nested write; `ipcSecurityAndContracts.test.ts` proves bypass elimination across `SEARCH:QUERY`, `LLM:*`, `SHELL:OPEN_PATH`, `FS:CREATE_*`, `FS:RENAME`; `main.ts` uses `pathToFileURL`. |
| **AC-2** Single IPC contract source of truth + clean stream unsubscribe | Verified (Unit & IPC; E2E in M6) | `shared/ipc/contracts.ts` defines all 28 channels; `ipcHandlers.ts` registers dynamically from `ALL_IPC_CHANNELS` with real `areHandlersRegistered()`; `preload.ts` unwraps `IPCEnvelope<T>` & cleans stream listeners in `finally`. |
| **AC-3** Live reactive kernel (`Watcher -> EventQueue -> Trie/Cache/Index`) | Verified (Unit & Kernel; E2E in M6) | `ReactiveWorkspaceKernel.test.ts` verifies OS file create/delete in `os.tmpdir()`, coalescing `EventQueue` (`3` -> `1`), dual-index `PathTrie` basename lookup (`quarter` -> `quarterly-report.md`), and automatic cache invalidation; M4 hooks RAG index sync. |
| **AC-4** `RingBuffer` + `LRUCache` power `FS:PREVIEW_FILE` UI drawer | Verified (Backend Unit; UI in M5/M6) | `FileSystemService.previewFile` reads bounded bytes via `RingBuffer(100)` (tailing `.log`, capping `.txt`), caches in byte-bounded `LRUCache`, records `previewsServed`/`cacheHits` in `RuntimeDiagnostics`, and invalidates on edits/watcher events. |
| **AC-5** Node-decoupled Hybrid RAG + small-batch flush + chunk dedup + mock streaming | Pending | `—` |
| **AC-6** Live `RUNTIME:GET_DIAGNOSTICS` & UI Inspector | Pending | `—` |
| **AC-7** `type-check`, `lint`, `build`, `npm test`, `npm run test:e2e` 100% green | Pending | `—` |

## Open Items / Next Actions Outside Transformation Scope
- Native OS file drag-and-drop & cross-session Favorites persistence (`FavoritesList`).
- Live GPU Ollama `llama3.2` interactive benchmark (requires running Ollama desktop daemon).
