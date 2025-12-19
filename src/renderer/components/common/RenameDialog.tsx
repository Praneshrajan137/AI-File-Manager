import React, { useState, useEffect, useRef } from 'react';

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
    onCancel
}) => {
    const [newName, setNewName] = useState(currentName);
    const inputRef = useRef<HTMLInputElement>(null);

    // Reset and focus when dialog opens
    useEffect(() => {
        if (isOpen) {
            setNewName(currentName);
            // Focus and select name (without extension)
            setTimeout(() => {
                if (inputRef.current) {
                    inputRef.current.focus();
                    const dotIndex = currentName.lastIndexOf('.');
                    if (dotIndex > 0) {
                        inputRef.current.setSelectionRange(0, dotIndex);
                    } else {
                        inputRef.current.select();
                    }
                }
            }, 0);
        }
    }, [isOpen, currentName]);

    // Handle keyboard events
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && newName.trim()) {
            onConfirm(newName.trim());
        } else if (e.key === 'Escape') {
            onCancel();
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
            onClick={onCancel}
        >
            <div
                className="bg-white rounded-lg shadow-xl p-6 w-96"
                onClick={(e) => e.stopPropagation()}
            >
                <h2 className="text-lg font-semibold mb-4">Rename</h2>
                <input
                    ref={inputRef}
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="Enter new name"
                />
                <div className="flex justify-end gap-2 mt-4">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => newName.trim() && onConfirm(newName.trim())}
                        disabled={!newName.trim() || newName === currentName}
                        className="px-4 py-2 bg-primary-500 text-white rounded-md hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Rename
                    </button>
                </div>
            </div>
        </div>
    );
};
