import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  title?: string;
  onReset?: () => void;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

/**
 * Isolates rendering exceptions inside panes so one crashed lens, previewer, or panel
 * cannot take down the entire File Manager window.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || 'An unexpected rendering failure occurred.',
    };
  }

  public componentDidCatch(error: Error): void {
    void error;
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, errorMessage: '' });
    this.props.onReset?.();
  };

  public render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          data-testid="error-boundary-fallback"
          className="h-full w-full flex flex-col items-center justify-center p-6 text-center bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
        >
          <div className="max-w-md rounded-xl border border-red-200 dark:border-red-900/60 bg-white dark:bg-slate-900 p-6 shadow-sm space-y-3">
            <AlertTriangle className="w-8 h-8 text-error-700 dark:text-red-400 mx-auto" aria-hidden="true" />
            <h2 className="text-base font-semibold">
              {this.props.title ?? 'Something went wrong in this panel'}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 break-words">
              {this.state.errorMessage}
            </p>
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-4 py-2 min-h-[36px] rounded-lg bg-accent-600 hover:bg-accent-700 text-white text-sm font-medium transition-colors"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
              <span>Retry View</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
