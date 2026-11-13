# Project Brief — OS File Manager with Local RAG (`project-2-file-manager`)

**Last Verified:** 2026-11-13 (Windows 11 host; Node `v24.11.0`, npm `11.6.1`, `@lancedb/lancedb@0.4.20`)

---

## 1. Purpose & Intended Users

- **Product**: Cross-platform Electron 28 + React 18 + strict TypeScript + Tailwind CSS desktop file manager (`project-2-file-manager` v0.1.0).
- **Dual Technical Pillars**:
  1. **OS / CS Fundamentals**: Five bespoke data structures (`PathTrie`, `LRUCache`, `EventQueue`, `HistoryStack`, `RingBuffer`) operating inside real desktop workflows (virtualized browsing via `react-window`, `O(L)` prefix autocomplete, memory-bounded LRU caching, priority-scheduled file watching, navigation history, tailing preview) behind strict Electron process isolation (`contextIsolation: true`, `nodeIntegration: false`, sandboxed renderer, path containment).
  2. **100% Local AI Intelligence (RAG)**: Offline text/PDF extraction, local `all-MiniLM-L6-v2` embeddings in Node Worker Threads (`EmbeddingWorkerPool`), embedded columnar storage (`@lancedb/lancedb@0.4.20`), and streaming local Ollama (`llama3.2`) generation with grounded source citations.
- **Intended Users** (`PRD.md`): Developers, students/engineers studying OS/DSA systems, and privacy-conscious desktop users navigating large directories and querying local documents offline.

## 2. Measured Baseline Before Transformation (2026-11-13)

| Check | Exact Command | Outcome | Timing | Evidence |
| --- | --- | --- | --- | --- |
| TypeScript | `npm run type-check` | PASS (exit `0`) | `3.60s` | Zero compiler errors (`strict: true`). |
| ESLint | `npm run lint` | FAIL (exit `1`) | `3.93s` | `192` problems (`94` errors, `98` warnings). |
| Jest Suite | `npm test` | FAIL (exit `1`) | `13.35s` | `18/20` suites passed (`354` unit tests); failed on `tests/integration/llm-pipeline.test.ts` (top-level Electron `net.fetch` undefined in Node) & `tests/e2e/user-flows.test.ts` (Playwright spec swept into Jest). |
| Playwright E2E | Pre-existing `2026-11-13 16:28` run; M0 filtered repro | FAIL (`28/30`) | `—` | `16:28` run failed on `should receive file watcher events` & `Journey 6` (`Target page, context or browser has been closed`). M0 filtered repro (`--grep "watcher|Journey 6"`) passed `2/2` (`15.8s`), exposing `--remote-debugging-port=9222` multi-launch instability plus vacuous watcher assertion (`expect(Array.isArray(receivedEvents)).toBe(true)` passed with `[]`!). |
| Ollama Daemon | `http://127.0.0.1:11434/api/tags` | UNAVAILABLE | `~2s` | Ollama CLI `0.16.1` present; server not running and headless auto-start failed (`Unable to init instance`). |

## 3. Sacred Constraints (Preserve Without Explicit Consent)

1. Strict Electron renderer sandbox (`contextIsolation: true`, `nodeIntegration: false`, no Node/`fs` APIs exposed directly to renderer).
2. 100% local AI execution (no cloud LLM/embedding calls or external telemetry); clean degradation when Ollama is offline.
3. Preserve all 5 CS data structures (`PathTrie`, `LRUCache`, `EventQueue`, `HistoryStack`, `RingBuffer`) as authentic, wired, tested runtime primitives.
4. Preserve existing `window.electronAPI` public surface (`fs`, `navigation`, `search`, `llm`, `fileWatcher`, `clipboard`, `shell`, `ping`) while upgrading contract enforcement and error fidelity cleanly.
