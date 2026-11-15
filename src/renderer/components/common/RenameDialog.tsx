import React, { useState, useEffect, useId, useRef } from 'react';
import { ModalShell } from './ModalShell';

interface RenameDialogProps {
  isOpen: boolean;
  currentName: string;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
}

export const RenameDialog: React.FC<RenameDialogProps> = ({
  isOpen,
  currentName,
  onConfirm,
  onCancel,
}) => {
  const [newName, setNewName] = useState(currentName);
  const headingId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setNewName(currentName);
    const timer = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        const dotIndex = currentName.lastIndexOf('.');
        if (dotIndex > 0) {
          inputRef.current.setSelectionRange(0, dotIndex);
        } else {
          inputRef.current.select();
        }
      }
    }, 10);
    return (): void => clearTimeout(timer);
  }, [isOpen, currentName]);

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && newName.trim() && newName !== currentName) {
      e.preventDefault();
      onConfirm(newName.trim());
    }
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onCancel}
      ariaLabelledBy={headingId}
      dataTestId="rename-dialog"
      initialFocusRef={inputRef}
      panelClassName="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-6 w-96 max-w-[92vw]"
    >
      <h2 id={headingId} className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">
        Rename
      </h2>
      <input
        ref={inputRef}
        type="text"
        value={newName}
        onChange={(e): void => setNewName(e.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="New file or folder name"
        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 rounded-md focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent"
        placeholder="Enter new name"
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
            if (newName.trim()) {
              onConfirm(newName.trim());
            }
          }}
          disabled={!newName.trim() || newName === currentName}
          className="px-4 py-2 bg-accent-600 text-white rounded-md hover:bg-accent-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Rename
        </button>
      </div>
    </ModalShell>
  );
};
