import React, { useEffect, useRef, useState } from 'react';

interface CreateEntryDialogProps {
  isOpen: boolean;
  mode: 'file' | 'directory';
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export const CreateEntryDialog: React.FC<CreateEntryDialogProps> = ({
  isOpen,
  mode,
  onConfirm,
  onCancel,
}) => {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    const timeoutId = setTimeout((): void => {
      inputRef.current?.focus();
    }, 0);
    return (): void => clearTimeout(timeoutId);
  }, [isOpen, mode]);

  if (!isOpen) {
    return null;
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && name.trim()) {
      onConfirm(name.trim());
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onCancel}
      data-testid="create-entry-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'file' ? 'Create New File' : 'Create New Folder'}
    >
      <div
        className="bg-white rounded-lg shadow-xl p-6 w-96"
        onClick={(e): void => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-4">
          {mode === 'file' ? 'New File' : 'New Folder'}
        </h2>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e): void => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          data-testid="create-entry-input"
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          placeholder={mode === 'file' ? 'e.g. notes.txt' : 'e.g. project-docs'}
        />
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={(): void => {
              if (name.trim()) {
                onConfirm(name.trim());
              }
            }}
            disabled={!name.trim()}
            data-testid="create-entry-confirm"
            className="px-4 py-2 bg-primary-500 text-white rounded-md hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
};
