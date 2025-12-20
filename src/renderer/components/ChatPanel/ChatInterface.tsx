import React, { useState, useRef, useEffect } from 'react';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { IndexingStatus } from './IndexingStatus';
import { useLLM } from '@renderer/hooks/useLLM';

export const ChatInterface: React.FC = () => {
  const { messages, loading, indexingStatus, sendQuery } = useLLM();
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
    <div className="flex flex-col h-full" data-testid="chat-panel">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-800">AI Assistant</h2>
        <IndexingStatus {...indexingStatus} />
      </div>

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin"
        role="log"
        aria-live="polite"
        aria-atomic="false"
        data-testid="chat-messages"
      >
        {messages.length === 0 && (
          <div className="text-center text-gray-400 py-8">
            <p className="text-lg">Ask me anything about your files!</p>
            <p className="text-sm mt-2">Try: "What TypeScript files do I have?"</p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="animate-pulse">Thinking...</span>
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
