# 🧪 Test & Verification Report — PrivateVault AI

**Repository:** `https://github.com/Praneshrajan137/AI-File-Manager`  
**Verification Policy:** Lightweight local checks on laptop (`type-check`, `lint`, single mocked Jest specs) + authoritative cross-platform CI matrix in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml).

---

## 1. Automated Verification Gates

### Authoritative Cloud CI (`.github/workflows/ci.yml` — Node.js 24 LTS)

1. **`quality-and-unit` (`ubuntu-latest`)**
   - `npm run type-check` (`tsc --noEmit`, strict TypeScript)
   - `npm run lint` (`eslint src --ext .ts,.tsx --max-warnings=0`)
   - `npx jest --coverage --coverageReporters=text-summary --coverageReporters=text --runInBand`
     - Enforced `jest.config.js` thresholds:
       - **Global minimum:** `56%` branches, `66%` functions, `70%` lines, `70%` statements
       - **`src/shared/security/SecretGuard.ts`:** `75%` branches, `90%` functions, `90%` lines, `90%` statements
       - **`src/main/services/PathValidator.ts`:** `60%` branches, `75%` functions, `70%` lines, `70%` statements
       - **`src/main/services/MarkdownLinkRepair.ts`:** `70%` branches, `90%` functions, `80%` lines, `80%` statements

2. **`build-and-e2e` (`ubuntu-24.04` & `windows-latest`)**
   - `npm run build` (Webpack main + `embeddingWorker.js` + standalone `mcpServer.js` + renderer bundle)
   - `npm run package` (`electron-builder --dir` unpacked desktop distribution with ASAR + unpacked `mcpServer.js` & `embeddingWorker.js`)
   - `node scripts/verify-unpacked-build.mjs` (runs standalone unpacked `resources/app.asar.unpacked/dist/main/mcpServer.js` over stdio JSON-RPC `initialize` / `tools/list` / `list_directory` AND boots packaged Electron binary `--smoke-packaged-boot`)
   - `npx playwright test` (real Electron desktop UI, Trash Vault recovery UI, Settings loopback guard, Quick Preview inline Edit/Save, symlink/junction containment, Knowledge Graph, Copilot Offline Synthesis fallback, and WCAG `@axe-core/playwright` checks)

---

## 2. Test Suite Inventory (`tests/`)

| Directory | Coverage Area | Runner |
| --- | --- | --- |
| `tests/unit/` | 5 OS DSAs (`PathTrie`, `LRUCache`, `EventQueue`, `HistoryStack`, `RingBuffer`), `PathValidator`, `SecretGuard`, `OperationJournal`, `VectorStore`, `SemanticClustering`, `WorkspaceMcpServer`, `WorkspaceKnowledgeGraph`, `AIOrganizerService`, `Stage1PackagedRuntimeAndPaths`, `Stage2GenuineSemanticClustering`, `Stage3UXAndRecovery` | Jest |
| `tests/unit/handlers/` | Declarative Zod IPC contracts, rate limiting, security middleware, channel coverage | Jest |
| `tests/unit/renderer/` | `uiLogic.test.ts` (SSR component & helper checks) and `interactiveA11y.test.tsx` (`jsdom` + `jest-axe` WCAG AA interactive audits) | Jest + JSDOM |
| `tests/integration/` | `llm-pipeline.test.ts` (Hybrid SQLite/LanceDB RAG + mock Ollama streaming + reactive kernel sync) | Jest |
| `tests/e2e/` | `frontier-workflows.spec.ts`, `vault-and-undo.spec.ts`, `accessibility-and-frontier-ui.spec.ts`, `copilot-organize.spec.ts`, `spatial-ui.spec.ts`, `file-operations.spec.ts`, `navigation.spec.ts`, `security.spec.ts`, `ipc-communication.spec.ts`, `user-flows.test.ts` | Playwright (Electron) |
| `tests/eval/` & `tests/perf/` | Grounded retrieval & agent benchmarks (`npm run eval:rag`, `npm run eval:agent`) + 10k-file scale benchmarks | Jest / Node scripts |

---

## 3. Running Locally (Resource-Safe Defaults)

Because target developer hardware uses a **12 GB RAM + RTX 3050** laptop (`AGENTS.md`), run lightweight verification locally and let GitHub Actions execute full coverage & cross-platform Electron packaging:

```bash
npm run type-check
npm run lint
npx jest tests/unit/Stage3UXAndRecovery.test.ts --runInBand
npx jest tests/unit/renderer/interactiveA11y.test.tsx --runInBand
```

Optional local RAG benchmark (caches ONNX models in `~/.privatevault/models`):

```bash
npm run eval:rag
```

---

## 4. Historical Baseline Archive (December 22, 2025 — Superseded)

> **Historical Note:** Prior to the PrivateVault AI kernel, security, RAG, MCP, packaged-runtime, clustering, and UI transformations, a December 22, 2025 pre-transformation baseline recorded `18/20` Jest suites passing (`354` unit tests) and non-functional E2E configuration (`user-flows.test.ts` Jest/Playwright conflict). Those issues were resolved cleanly; live pass/coverage status is governed by the current GitHub Actions workflows above.
