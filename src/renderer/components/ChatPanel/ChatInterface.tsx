import React, { useState, useRef, useEffect } from 'react';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { IndexingPanel } from './IndexingPanel';
import { useLLM, UseLLMReturn } from '@renderer/hooks/useLLM';
import { Bot, FolderKanban, Sparkles } from 'lucide-react';
import type { CopilotQueryMode, OrganizePlanResult } from '@shared/contracts';

interface ChatInterfaceProps {
  currentPath?: string;
  selectedPaths?: string[];
  llm?: UseLLMReturn;
  onOpenCitation?: (filePath: string, startLine?: number, endLine?: number) => void;
  onOpenOrganize?: (targetDir: string) => void;
  onPreviewOrganizePlan?: (plan: OrganizePlanResult) => void;
}

const ChatInterfaceBody: React.FC<{
  currentPath: string;
  selectedPaths: string[];
  llmState: UseLLMReturn;
  onOpenCitation?: (filePath: string, startLine?: number, endLine?: number) => void;
  onOpenOrganize?: (targetDir: string) => void;
  onPreviewOrganizePlan?: (plan: OrganizePlanResult) => void;
}> = ({
  currentPath,
  selectedPaths,
  llmState,
  onOpenCitation,
  onOpenOrganize,
  onPreviewOrganizePlan,
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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = (): void => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
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
      <div className="px-4 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center flex-shrink-0">
              <Bot className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold flex items-center gap-1 truncate">
                AI Assistant
                <Sparkles className="w-4 h-4 text-yellow-300 flex-shrink-0" />
              </h2>
              <p className="text-xs text-white/70 truncate">Ask anything about your files</p>
            </div>
          </div>

          {modelsSnapshot && (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span
                className={`w-2 h-2 rounded-full ${
                  modelsSnapshot.available ? 'bg-emerald-400' : 'bg-amber-300'
                }`}
                title={modelsSnapshot.available ? 'Ollama Online' : 'Ollama Offline'}
                data-testid="ollama-status-dot"
              />
              <select
                value={modelsSnapshot.activeModel}
                onChange={(e) => {
                  void setActiveModel(e.target.value);
                }}
                aria-label="Active LLM model"
                data-testid="ollama-model-select"
                className="bg-white/15 text-white text-xs rounded-md px-2 py-1 border border-white/25 focus:outline-none focus:ring-1 focus:ring-white/50 max-w-[125px] truncate"
              >
                {modelChoices.map((modelName) => (
                  <option key={modelName} value={modelName} className="text-slate-900 bg-white">
                    {modelName}
                  </option>
                ))}
              </select>
            </div>
          )}
          {onOpenOrganize && currentPath && (
            <button
              type="button"
              onClick={(): void => onOpenOrganize(currentPath)}
              data-testid="organize-folder-button"
              title="Preview AI organization moves before applying"
              className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/15 hover:bg-white/25 text-white text-xs font-medium border border-white/20 transition-colors"
            >
              <FolderKanban className="w-3.5 h-3.5" />
              <span>AI Organize Folder (Dry-Run)</span>
            </button>
          )}
        </div>
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
        className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin bg-gray-50 dark:bg-slate-950"
        role="log"
        aria-live="polite"
        aria-atomic="false"
        data-testid="chat-messages"
      >
        {messages.length === 0 && (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-950 rounded-full flex items-center justify-center mx-auto mb-4">
              <Bot className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
            </div>
            <p className="text-lg font-medium text-gray-700 dark:text-slate-200">
              Ask me anything about your files!
            </p>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-2">
              Try: &quot;What TypeScript files do I have?&quot;
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {['List my recent documents', 'Find large files', 'Search for images'].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setInput(suggestion);
                  }}
                  className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-full text-xs text-gray-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-slate-700 hover:border-indigo-200 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onOpenCitation={onOpenCitation}
            onPreviewOrganizePlan={onPreviewOrganizePlan}
          />
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-slate-400">
            <div className="flex gap-1">
              <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
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
}> = ({
  currentPath,
  selectedPaths,
  onOpenCitation,
  onOpenOrganize,
  onPreviewOrganizePlan,
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
    />
  );
};
