import React from 'react';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { SystemPathsProvider } from './contexts/SystemPathsContext';
import { OverlayStackProvider } from './hooks/useOverlayStack';
import { WorkspaceShell } from './WorkspaceShell';

export const App: React.FC = () => (
  <ErrorBoundary title="Workspace Application">
    <OverlayStackProvider>
      <SystemPathsProvider>
        <WorkspaceShell />
      </SystemPathsProvider>
    </OverlayStackProvider>
  </ErrorBoundary>
);

export default App;
