import React, { useState, useRef, useEffect } from 'react';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { IndexingPanel } from './IndexingPanel';
import { useLLM, UseLLMReturn } from '@renderer/hooks/useLLM';
import { getScrollBehavior } from '@renderer/utils/motion';
import { Bot, FolderKanban, Settings, Sparkles } from 'lucide-react';
import { ChatEmptySuggestions } from './ChatEmptySuggestions';
import type { CopilotQueryMode, OrganizePlanResult } from '@shared/contracts';

interface ChatInterfaceProps {
  currentPath?: string;
  selectedPaths?: string[];
  llm?: UseLLMReturn;
  onOpenCitation?: (filePath: string, startLine?: number, endLine?: number) => void;
  onOpenOrganize?: (targetDir: string) => void;
  onPreviewOrganizePlan?: (plan: OrganizePlanResult) => void;
  onOpenSettings?: () => void;
}

const ChatInterfaceBody: React.FC<{
  currentPath: string;
  selectedPaths: string[];
  llmState: UseLLMReturn;
  onOpenCitation?: (filePath: string, startLine?: number, endLine?: number) => void;
  onOpenOrganize?: (targetDir: string) => void;
  onPreviewOrganizePlan?: (plan: OrganizePlanResult) => void;
  onOpenSettings?: () => void;
}> = ({
  currentPath,
  selectedPaths,
  llmState,
  onOpenCitation,
  onOpenOrganize,
  onPreviewOrganizePlan,
  onOpenSettings,
}) => {
  const {
    messages,
    loading,
    indexingStatus,
    modelsSnapshot,
    sendQuery,
    cancelQuery,
    startIndexing,
    stopIndexing,
    clearIndex,
    setActiveModel,
  } = llmState;
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<CopilotQueryMode>('rag');
  const [useFolder, setUseFolder] = useState<boolean>(false);
  const [useSelection, setUseSelection] = useState<boolean>(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef<boolean>(true);

  const handleLogScroll = (): void => {
    const el = scrollContainerRef.current;
    if (!el) return;
    pinnedToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
  };

  useEffect(() => {
    if (!pinnedToBottomRef.current) return;
    messagesEndRef.current?.scrollIntoView?.({ behavior: getScrollBehavior() });
  }, [messages]);

  const handleSend = async (): Promise<void> => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const mentionsFolder = /(?:^|\s)@folder\b/i.test(trimmed);
    const mentionsSelection = /(?:^|\s)@selection\b/i.test(trimmed);
    const effectiveUseFolder = useFolder || mentionsFolder;
    const effectiveUseSelection = (useSelection || mentionsSelection) && selectedPaths.length > 0;

    await sendQuery(trimmed, {
      mode,
      contextScope:
        effectiveUseFolder || effectiveUseSelection
          ? {
              currentPath: currentPath || undefined,
              selectedPaths: effectiveUseSelection ? selectedPaths : undefined,
              useFolder: effectiveUseFolder,
              useSelection: effectiveUseSelection,
            }
          : undefined,
    });
    setInput('');
  };

  const modelChoices = Array.from(
    new Set([
      modelsSnapshot?.activeModel || 'llama3.2',
      ...(modelsSnapshot?.models ?? []),
    ])
  );

  return (
    <div
      className="flex flex-col h-full bg-white dark:bg-slate-900"
      data-testid="chat-panel"
    >
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-accent-600 to-accent-700 text-white space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center flex-shrink-0">
              <Bot className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold flex items-center gap-1 truncate">
                <span>AI Assistant</span>
                <Sparkles className="w-4 h-4 text-yellow-200 flex-shrink-0" aria-hidden="true" />
              </h2>
              <p className="text-xs text-white/95 truncate">Ask anything about your files</p>
            </div>
          </div>

          {(modelsSnapshot || onOpenSettings) && (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {modelsSnapshot && (
                <>
                  <span
                    className={`w-2 h-2 rounded-full ${
                      modelsSnapshot.available ? 'bg-emerald-300' : 'bg-amber-300'
                    }`}
                    title={
                      `${modelsSnapshot.provider === 'openai_compatible' ? 'AI Endpoint' : 'Ollama'} ${
                        modelsSnapshot.available ? 'Online' : 'Offline'
                      }`
                    }
                    data-testid="ollama-status-dot"
                  />
                  <select
                    value={modelsSnapshot.activeModel}
                    onChange={(e) => {
                      void setActiveModel(e.target.value);
                    }}
                    aria-label="Active LLM model"
                    data-testid="ollama-model-select"
                    className="bg-slate-900/40 text-white text-xs rounded-md px-2 py-1 border border-white/30 focus:outline-none focus:ring-2 focus:ring-white/60 max-w-[130px] truncate"
                  >
                    {modelChoices.map((modelName) => (
                      <option key={modelName} value={modelName} className="text-slate-900 bg-white">
                        {modelName}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {onOpenSettings && (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  title="Configure AI Provider & Settings"
                  aria-label="AI Provider Settings"
                  data-testid="chat-settings-button"
                  className="p-1 rounded-md text-white/90 hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/60"
                >
                  <Settings className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </div>
        {onOpenOrganize && currentPath && (
          <div>
            <button
              type="button"
              onClick={(): void => onOpenOrganize(currentPath)}
              data-testid="organize-folder-button"
              title="Preview AI organization moves before applying"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/15 hover:bg-white/25 text-white text-xs font-medium border border-white/25 transition-colors"
            >
              <FolderKanban className="w-3.5 h-3.5" aria-hidden="true" />
              <span>AI Organize Folder (Dry-Run)</span>
            </button>
          </div>
        )}
      </div>

      {/* Indexing Panel */}
      <IndexingPanel
        indexingStatus={indexingStatus}
        currentPath={currentPath}
        onStartIndexing={startIndexing}
        onStopIndexing={stopIndexing}
        onClearIndex={clearIndex}
      />

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onScroll={handleLogScroll}
        className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin bg-slate-50 dark:bg-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-inset"
        role="log"
        aria-label="Chat messages"
        tabIndex={0}
        aria-live="polite"
        aria-atomic="false"
        data-testid="chat-messages"
      >
        {messages.length === 0 && <ChatEmptySuggestions onSelectSuggestion={setInput} />}
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onOpenCitation={onOpenCitation}
            onPreviewOrganizePlan={onPreviewOrganizePlan}
            onRetry={(retryText, retryOpts): void => {
              pinnedToBottomRef.current = true;
              void sendQuery(retryText, retryOpts);
            }}
          />
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-accent-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 bg-accent-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-accent-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span>Thinking...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <ChatInput
        value={input}
        onChange={setInput}
        onSend={handleSend}
        onCancel={(): void => {
          void cancelQuery();
        }}
        disabled={loading}
        currentPath={currentPath}
        selectedCount={selectedPaths.length}
        useFolder={useFolder}
        useSelection={useSelection}
        mode={mode}
        onToggleFolder={(): void => setUseFolder((prev) => !prev)}
        onToggleSelection={(): void => setUseSelection((prev) => !prev)}
        onToggleMode={(): void => setMode((prev) => (prev === 'rag' ? 'agent' : 'rag'))}
      />
    </div>
  );
};

const ChatInterfaceStandalone: React.FC<{
  currentPath: string;
  selectedPaths: string[];
  onOpenCitation?: (filePath: string, startLine?: number, endLine?: number) => void;
  onOpenOrganize?: (targetDir: string) => void;
  onPreviewOrganizePlan?: (plan: OrganizePlanResult) => void;
  onOpenSettings?: () => void;
}> = ({
  currentPath,
  selectedPaths,
  onOpenCitation,
  onOpenOrganize,
  onPreviewOrganizePlan,
  onOpenSettings,
}) => {
  const internalLlm = useLLM();
  return (
    <ChatInterfaceBody
      currentPath={currentPath}
      selectedPaths={selectedPaths}
      llmState={internalLlm}
      onOpenCitation={onOpenCitation}
      onOpenOrganize={onOpenOrganize}
      onPreviewOrganizePlan={onPreviewOrganizePlan}
      onOpenSettings={onOpenSettings}
    />
  );
};

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
  currentPath = '',
  selectedPaths = [],
  llm,
  onOpenCitation,
  onOpenOrganize,
  onPreviewOrganizePlan,
  onOpenSettings,
}) => {
  if (llm) {
    return (
      <ChatInterfaceBody
        currentPath={currentPath}
        selectedPaths={selectedPaths}
        llmState={llm}
        onOpenCitation={onOpenCitation}
        onOpenOrganize={onOpenOrganize}
        onPreviewOrganizePlan={onPreviewOrganizePlan}
        onOpenSettings={onOpenSettings}
      />
    );
  }
  return (
    <ChatInterfaceStandalone
      currentPath={currentPath}
      selectedPaths={selectedPaths}
      onOpenCitation={onOpenCitation}
      onOpenOrganize={onOpenOrganize}
      onPreviewOrganizePlan={onPreviewOrganizePlan}
      onOpenSettings={onOpenSettings}
    />
  );
};
