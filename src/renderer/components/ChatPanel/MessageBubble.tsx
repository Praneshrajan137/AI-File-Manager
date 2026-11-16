import React, { useMemo, useState } from 'react';
import {
  User,
  Bot,
  FileCode2,
  Cpu,
  WifiOff,
  FolderKanban,
  RotateCcw,
} from 'lucide-react';
import { MessageMetaBadges } from './MessageMetaBadges';
import type { OrganizePlanResult } from '@shared/contracts';
import { Message, SendQueryOptions } from '@renderer/hooks/useLLM';
import { parseCitationSegments } from '@renderer/utils/explorerHelpers';
import { extractBasename } from '@renderer/utils/pathHelpers';

interface MessageBubbleProps {
  message: Message;
  onOpenCitation?: (filePath: string, startLine?: number, endLine?: number) => void;
  onPreviewOrganizePlan?: (plan: OrganizePlanResult) => void;
  onRetry?: (query: string, options?: SendQueryOptions) => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  onOpenCitation,
  onPreviewOrganizePlan,
  onRetry,
}) => {
  const isUser = message.role === 'user';
  const [traceExpanded, setTraceExpanded] = useState<boolean>(false);

  const segments = useMemo(() => {
    if (isUser) return null;
    return parseCitationSegments(message.content);
  }, [isUser, message.content]);

  const resolveFilePathForName = (nameOrPath: string): string => {
    const clean = nameOrPath.trim();
    const matchFromStructured = message.structuredSources?.find(
      (s) =>
        s.filePath === clean ||
        extractBasename(s.filePath).toLowerCase() === clean.toLowerCase()
    );
    if (matchFromStructured) return matchFromStructured.filePath;

    const matchFromPaths = message.sources?.find(
      (p) => p === clean || extractBasename(p).toLowerCase() === clean.toLowerCase()
    );
    return matchFromPaths ?? clean;
  };

  return (
    <div
      className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
      data-testid={isUser ? 'user-message' : 'assistant-message'}
    >
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-accent-600 flex items-center justify-center flex-shrink-0">
          <Bot className="w-5 h-5 text-white" aria-hidden="true" />
        </div>
      )}

      <div className={`max-w-[82%] ${isUser ? 'order-first' : ''}`}>
        <div
          className={`rounded-lg p-3 ${
            isUser
              ? 'bg-accent-600 text-white'
              : message.isError
                ? 'bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-900 dark:text-red-100'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
          }`}
        >
          <p className="text-sm whitespace-pre-wrap">
            {isUser || !segments
              ? message.content
              : segments.map((seg, idx) => {
                  if (seg.type === 'citation' && seg.fileName) {
                    const targetPath = resolveFilePathForName(seg.fileName);
                    return (
                      <button
                        key={idx}
                        type="button"
                        data-testid="inline-citation-link"
                        onClick={() => onOpenCitation?.(targetPath, seg.startLine, seg.endLine)}
                        className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded bg-accent-100 dark:bg-accent-950 text-accent-700 dark:text-accent-300 font-mono text-xs hover:underline cursor-pointer"
                        title={`Inspect ${targetPath}${seg.startLine ? ` at line ${seg.startLine}` : ''}`}
                      >
                        {seg.content}
                      </button>
                    );
                  }
                  return <React.Fragment key={idx}>{seg.content}</React.Fragment>;
                })}
          </p>
          {!isUser && message.isError && message.retryQuery && onRetry && (
            <div className="mt-2 pt-2 border-t border-red-200/80 dark:border-red-800/80">
              <button
                type="button"
                data-testid="retry-query-button"
                onClick={(): void => onRetry(message.retryQuery!, message.retryOptions)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-error-700 hover:bg-error-600 text-white text-xs font-medium"
              >
                <RotateCcw className="w-3 h-3" aria-hidden="true" />
                <span>Retry Request</span>
              </button>
            </div>
          )}
        </div>

        {message.offlineSynthesis && !isUser && (
          <div className="mt-1.5">
            <span
              data-testid="offline-synthesis-badge"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/70 border border-amber-200 dark:border-amber-800 text-[10px] font-medium text-amber-800 dark:text-amber-300"
            >
              <WifiOff className="w-2.5 h-2.5" />
              <span>Offline Local Graph Synthesis</span>
            </span>
          </div>
        )}

        {message.proposedPlan && !isUser && (
          <div
            data-testid="message-proposed-plan-card"
            className="mt-2 p-2.5 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-950/40 text-xs space-y-1.5"
          >
            <div className="font-semibold text-indigo-900 dark:text-indigo-200 flex items-center gap-1.5">
              <FolderKanban className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>Proposed Organization Plan ({message.proposedPlan.operations.length} ops)</span>
            </div>
            <p className="text-[11px] text-indigo-700 dark:text-indigo-300">
              {message.proposedPlan.summary}
            </p>
            {onPreviewOrganizePlan && (
              <button
                type="button"
                data-testid="review-proposed-plan-button"
                onClick={(): void => onPreviewOrganizePlan(message.proposedPlan!)}
                className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-medium"
              >
                Review Dry-Run Proposal
              </button>
            )}
          </div>
        )}

        {!isUser && <MessageMetaBadges message={message} />}

        {message.agentSteps && message.agentSteps.length > 0 && (
          <div className="mt-2">
            <button
              type="button"
              data-testid="agent-trace-badge"
              onClick={(): void => setTraceExpanded((prev) => !prev)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-950/70 border border-purple-200 dark:border-purple-800 text-[11px] font-mono text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900"
            >
              <Cpu className="w-3 h-3" />
              <span>
                ReAct Trace ({message.agentSteps.length} step
                {message.agentSteps.length === 1 ? '' : 's'})
                {message.usage?.totalTokens ? ` · ${message.usage.totalTokens} tok` : ''}
              </span>
            </button>
            {traceExpanded && (
              <div
                data-testid="agent-trace-details"
                className="mt-1.5 p-2 rounded border border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-slate-900 text-[11px] font-mono space-y-1 text-purple-900 dark:text-purple-200"
              >
                {message.agentSteps.map((st, idx) => (
                  <div key={`${st.step}-${st.callId ?? st.tool}-${idx}`}>
                    #{st.step}
                    {st.parallelGroupSize && st.parallelGroupSize > 1
                      ? `[x${st.parallelGroupSize}]`
                      : ''}{' '}
                    [{st.allowed ? st.tool : `BLOCKED:${st.tool}`}] —{' '}
                    {st.observationSummary} ({st.durationMs}ms)
                  </div>
                ))}
                {(message.retrievalMs !== undefined || message.generationMs !== undefined) && (
                  <div className="pt-1 border-t border-purple-200/70 dark:border-purple-800/70 text-[10px] text-purple-800 dark:text-purple-200">
                    retrieval {message.retrievalMs ?? 0}ms · generation {message.generationMs ?? 0}ms
                    {message.traceId ? ` · trace ${message.traceId.slice(0, 8)}` : ''}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {message.structuredSources && message.structuredSources.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5" data-testid="message-structured-sources">
            {message.structuredSources.map((source, idx) => {
              const name = extractBasename(source.filePath);
              const lineSuffix = source.startLine
                ? `#L${source.startLine}${source.endLine && source.endLine > source.startLine ? `-L${source.endLine}` : ''}`
                : '';
              return (
                <button
                  key={`${source.filePath}-${source.startLine ?? idx}-${idx}`}
                  type="button"
                  data-testid="source-citation-pill"
                  onClick={() => onOpenCitation?.(source.filePath, source.startLine, source.endLine)}
                  title={source.heading ? `${source.filePath} (${source.heading})` : source.filePath}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 text-[11px] font-mono text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-colors"
                >
                  <FileCode2 className="w-3 h-3" />
                  <span>
                    {name}
                    {lineSuffix}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          message.sources &&
          message.sources.length > 0 && (
            <div className="mt-2 text-xs text-slate-600 dark:text-slate-300">
              <span className="font-semibold">Sources:</span>{' '}
              {message.sources.map((source, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onOpenCitation?.(source)}
                  className="underline cursor-pointer hover:text-primary-600 dark:hover:text-indigo-400"
                >
                  {extractBasename(source)}
                  {idx < message.sources!.length - 1 && ', '}
                </button>
              ))}
            </div>
          )
        )}
      </div>

      {isUser && (
        <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
          <User className="w-5 h-5 text-gray-600 dark:text-slate-200" />
        </div>
      )}
    </div>
  );
};
