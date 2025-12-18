import React from 'react';
import { FolderOpen } from 'lucide-react';

export const EmptyState: React.FC = () => (
  <div className="flex flex-col items-center justify-center h-full text-gray-400">
    <FolderOpen className="w-16 h-16 mb-4" />
    <p className="text-lg font-medium">This folder is empty</p>
    <p className="text-sm mt-2">Drop files here or create a new file</p>
  </div>
);
