import React, { useState, useRef, useEffect } from 'react';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { IndexingPanel } from './IndexingPanel';
import { useLLM } from '@renderer/hooks/useLLM';
import { Bot, Sparkles } from 'lucide-react';

interface ChatInterfaceProps {
  currentPath?: string;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ currentPath = '' }) => {
  const { messages, loading, indexingStatus, sendQuery, startIndexing, stopIndexing, clearIndex } = useLLM();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    await sendQuery(input);
    setInput('');
  };

  return (
    <div className="flex flex-col h-full bg-white" data-testid="chat-panel">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold flex items-center gap-1">
              AI Assistant
              <Sparkles className="w-4 h-4 text-yellow-300" />
            </h2>
            <p className="text-xs text-white/70">Ask anything about your files</p>
          </div>
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
        className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin bg-gray-50"
        role="log"
        aria-live="polite"
        aria-atomic="false"
        data-testid="chat-messages"
      >
        {messages.length === 0 && (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Bot className="w-8 h-8 text-indigo-600" />
            </div>
            <p className="text-lg font-medium text-gray-700">Ask me anything about your files!</p>
            <p className="text-sm text-gray-500 mt-2">
              Try: "What TypeScript files do I have?"
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {['List my recent documents', 'Find large files', 'Search for images'].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setInput(suggestion);
                  }}
                  className="px-3 py-1.5 bg-white border border-gray-200 rounded-full text-xs text-gray-600 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
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
        disabled={loading}
      />
    </div>
  );
};
