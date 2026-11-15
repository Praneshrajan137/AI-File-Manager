import React, { useEffect, useId, useRef, useState } from 'react';
import { ModalShell } from './ModalShell';

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
  const headingId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName('');
  }, [isOpen, mode]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && name.trim()) {
      e.preventDefault();
      onConfirm(name.trim());
    }
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onCancel}
      ariaLabelledBy={headingId}
      dataTestId="create-entry-dialog"
      initialFocusRef={inputRef}
      panelClassName="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-6 w-96 max-w-[92vw]"
    >
      <h2 id={headingId} className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">
        {mode === 'file' ? 'New File' : 'New Folder'}
      </h2>
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e): void => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        aria-label={mode === 'file' ? 'New file name' : 'New folder name'}
        data-testid="create-entry-input"
        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 rounded-md focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent"
        placeholder={mode === 'file' ? 'e.g. notes.txt' : 'e.g. project-docs'}
      />
      <div className="flex justify-end gap-2 mt-4">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
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
          className="px-4 py-2 bg-accent-600 text-white rounded-md hover:bg-accent-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Create
        </button>
      </div>
    </ModalShell>
  );
};
