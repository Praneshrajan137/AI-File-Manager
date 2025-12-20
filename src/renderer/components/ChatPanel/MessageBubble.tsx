import React from 'react';
import { User, Bot } from 'lucide-react';
import { Message } from '@renderer/hooks/useLLM';

interface MessageBubbleProps {
  message: Message;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isUser = message.role === 'user';

  return (
    <div
      className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
      data-testid={isUser ? 'user-message' : 'assistant-message'}
    >
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-primary-500 flex items-center justify-center flex-shrink-0">
          <Bot className="w-5 h-5 text-white" />
        </div>
      )}

      <div className={`max-w-[80%] ${isUser ? 'order-first' : ''}`}>
        <div
          className={`rounded-lg p-3 ${isUser ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-800'
            }`}
        >
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        </div>

        {message.sources && message.sources.length > 0 && (
          <div className="mt-2 text-xs text-gray-500">
            <span className="font-semibold">Sources:</span>{' '}
            {message.sources.map((source, idx) => (
              <span key={idx} className="underline cursor-pointer hover:text-primary-600">
                {source}
                {idx < message.sources!.length - 1 && ', '}
              </span>
            ))}
          </div>
        )}
      </div>

      {isUser && (
        <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center flex-shrink-0">
          <User className="w-5 h-5 text-gray-600" />
        </div>
      )}
    </div>
  );
};
