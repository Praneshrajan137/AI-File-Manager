/**
 * LlmWorkspaceService.ts - Temporary Step-5 Compatibility Facade
 *
 * Delegates all workspace intelligence, indexing, graph queries, and Copilot operations
 * cleanly to the explicit `WorkspaceRuntime` Composition Root (`@main/entry/WorkspaceRuntime`)
 * and `IntelligenceRuntime` (`@llm/runtime/*`).
 *
 * Will be deleted cleanly in Step 6 once remaining legacy tests migrate to `WorkspaceRuntime`.
 */

import { IpcMainInvokeEvent } from 'electron';
import {
  ContentSearchMatch,
  FileConnectionsSummary,
  GraphImpactCheckResult,
  GraphInsightsResponse,
  IndexingStatus,
  LLMModelsSnapshot,
  OrganizeApplyResult,
  OrganizePlanOperation,
  OrganizePlanResult,
  OrganizeStrategy,
  WorkspaceCollectionGroup,
  WorkspaceGraphMap,
} from '@shared/contracts';
import { IPCResponseMap } from '@shared/ipc/contracts';
import { cleanupWorkspaceRuntime, getWorkspaceRuntime } from '@main/entry/WorkspaceRuntime';
import type { CopilotQueryInput } from '../../llm/runtime/CopilotCoordinator';
import { replayPendingVectorOutbox } from '../../llm/runtime/IndexingCoordinator';
import type { SetLlmModelConfigInput } from '../../llm/runtime/ModelLifecycleManager';
import { AIOrganizerService } from './AIOrganizerService';

export { replayPendingVectorOutbox };

export function resolveVectorDbPath(): string {
  return getWorkspaceRuntime().resolveVectorDbPath();
}

export function withKnowledgeGraphSession<T>(fn: () => Promise<T>): Promise<T> {
  return getWorkspaceRuntime().withKnowledgeGraphSession(fn);
}

export function searchWorkspaceContent(
  query: string,
  topK: number = 20,
  searchRoot?: string
): ContentSearchMatch[] {
  return getWorkspaceRuntime().searchWorkspaceContent(query, topK, searchRoot);
}

export function queryWorkspaceGraphInsights(input: {
  symbolQuery?: string;
  backlinkTarget?: string;
}): GraphInsightsResponse {
  return getWorkspaceRuntime().queryWorkspaceGraphInsights(input);
}

export function checkWorkspaceGraphImpact(targetPaths: string[]): GraphImpactCheckResult {
  return getWorkspaceRuntime().checkWorkspaceGraphImpact(targetPaths);
}

export function getWorkspaceGraphMapData(input?: {
  rootPrefix?: string;
  maxNodes?: number;
}): WorkspaceGraphMap {
  return getWorkspaceRuntime().getWorkspaceGraphMapData(input);
}

export function getWorkspaceCollectionsData(input?: {
  rootPrefix?: string;
}): Promise<WorkspaceCollectionGroup[]> {
  return getWorkspaceRuntime().getWorkspaceCollectionsData(input);
}

export function getWorkspaceFileConnectionsData(filePath: string): FileConnectionsSummary {
  return getWorkspaceRuntime().getWorkspaceFileConnectionsData(filePath);
}

export function createOrganizerService(): AIOrganizerService {
  return getWorkspaceRuntime().createOrganizerService();
}

export function executeCopilotQuery(
  event: IpcMainInvokeEvent,
  input: CopilotQueryInput
): Promise<IPCResponseMap['LLM:QUERY']> {
  return getWorkspaceRuntime().executeCopilotQuery(event, input);
}

export function abortCopilotQuery(
  event: IpcMainInvokeEvent,
  input: { channel: string }
): Promise<{ aborted: boolean }> {
  return getWorkspaceRuntime().abortCopilotQuery(event, input);
}

export function getIndexingStatus(
  event: IpcMainInvokeEvent,
  input: Record<string, never>
): Promise<IndexingStatus> {
  return getWorkspaceRuntime().getIndexingStatus(event, input);
}

export function startDirectoryIndexing(
  event: IpcMainInvokeEvent,
  input: { path: string }
): Promise<{ success: boolean; message?: string; total?: number; error?: string }> {
  return getWorkspaceRuntime().startDirectoryIndexing(event, input);
}

export function stopDirectoryIndexing(
  event: IpcMainInvokeEvent,
  input: Record<string, never>
): Promise<{ success: boolean }> {
  return getWorkspaceRuntime().stopDirectoryIndexing(event, input);
}

export function indexSingleFile(
  event: IpcMainInvokeEvent,
  input: { filePath: string }
): Promise<{ success: boolean; chunksCreated?: number; error?: string }> {
  return getWorkspaceRuntime().indexSingleFile(event, input);
}

export function handleKernelIndexMutation(
  eventType: 'create' | 'change' | 'unlink',
  filePath: string
): Promise<void> {
  return getWorkspaceRuntime().handleKernelIndexMutation(eventType, filePath);
}

export function checkOllamaStatus(
  event: IpcMainInvokeEvent,
  input: Record<string, never>
): Promise<{ available: boolean; models: string[] }> {
  return getWorkspaceRuntime().checkOllamaStatus(event, input);
}

export function listLlmModels(
  event: IpcMainInvokeEvent,
  input: Record<string, never>
): Promise<LLMModelsSnapshot> {
  return getWorkspaceRuntime().listLlmModels(event, input);
}

export function setLlmModelConfig(
  event: IpcMainInvokeEvent,
  input: SetLlmModelConfigInput
): Promise<{ success: boolean; config: LLMModelsSnapshot }> {
  return getWorkspaceRuntime().setLlmModelConfig(event, input);
}

export function downloadLlmModels(
  event: IpcMainInvokeEvent,
  input: Record<string, never>
): Promise<{ success: boolean; snapshot: LLMModelsSnapshot; error?: string }> {
  return getWorkspaceRuntime().downloadLlmModels(event, input);
}

export function clearVectorIndex(
  event: IpcMainInvokeEvent,
  input: Record<string, never>
): Promise<{ success: boolean; error?: string }> {
  return getWorkspaceRuntime().clearVectorIndex(event, input);
}

export function getRecentAgentTraces(
  event: IpcMainInvokeEvent,
  input?: { limit?: number }
): Promise<IPCResponseMap['LLM:GET_TRACES']> {
  return getWorkspaceRuntime().getRecentAgentTraces(event, input);
}

export function clearAgentTracesHistory(
  event: IpcMainInvokeEvent,
  input: Record<string, never>
): Promise<IPCResponseMap['LLM:CLEAR_TRACES']> {
  return getWorkspaceRuntime().clearAgentTracesHistory(event, input);
}

export function planWorkspaceOrganize(
  event: IpcMainInvokeEvent,
  input: { targetDir: string; strategy?: OrganizeStrategy; useLLM?: boolean; recursive?: boolean }
): Promise<OrganizePlanResult> {
  return getWorkspaceRuntime().planWorkspaceOrganize(event, input);
}

export function applyWorkspaceOrganize(
  event: IpcMainInvokeEvent,
  input: {
    planId: string;
    targetDir: string;
    operations: OrganizePlanOperation[];
    repairMarkdownLinks?: boolean;
  }
): Promise<OrganizeApplyResult> {
  return getWorkspaceRuntime().applyWorkspaceOrganize(event, input);
}

export function cleanupLLMServices(): Promise<void> {
  return cleanupWorkspaceRuntime();
}
