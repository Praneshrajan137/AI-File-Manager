import React from 'react';
import { Send } from 'lucide-react';
import { Button } from '@renderer/components/common/Button';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  value,
  onChange,
  onSend,
  disabled
}) => {
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="p-4 border-t border-gray-200 flex gap-2" data-testid="chat-input-container">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyPress={handleKeyPress}
        placeholder="Ask about your files..."
        disabled={disabled}
        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
        data-testid="chat-input"
      />
      <Button
        variant="primary"
        onClick={onSend}
        disabled={disabled || !value.trim()}
        icon={<Send className="w-4 h-4" />}
        aria-label="Send message"
        data-testid="send-button"
      />
    </div>
  );
};
