import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, Home, RefreshCw, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';
import { BrandLogo } from './BrandLogo';

export interface NormalizedBoundaryError {
  name: string;
  message: string;
  stack?: string;
}

const MAX_ERROR_MESSAGE_LENGTH = 300;

export function normalizeBoundaryError(error: unknown): NormalizedBoundaryError {
  if (error instanceof Error) {
    const rawMsg = (error.message || '').trim() || 'An unexpected application error occurred.';
    return {
      name: error.name || 'Error',
      message:
        rawMsg.length > MAX_ERROR_MESSAGE_LENGTH
          ? `${rawMsg.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
          : rawMsg,
      stack: error.stack,
    };
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    const trimmed = error.trim();
    return {
      name: 'Error',
      message:
        trimmed.length > MAX_ERROR_MESSAGE_LENGTH
          ? `${trimmed.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
          : trimmed,
    };
  }
  return {
    name: 'Error',
    message: 'An unexpected application error occurred.',
  };
}

export function shouldResetErrorBoundary(
  prevResetKey: string | number | undefined,
  nextResetKey: string | number | undefined
): boolean {
  return prevResetKey !== undefined && nextResetKey !== undefined && prevResetKey !== nextResetKey;
}

export interface GlobalErrorBoundaryProps {
  children: ReactNode;
  /** 'app' renders full-screen recovery layout; 'view' renders inline card inside the workspace */
  scope?: 'app' | 'view';
  /** Changing this key (e.g. active navigation tab) automatically resets a caught view error */
  resetKey?: string | number;
  /** Optional handler to return to Dashboard from a crashed view */
  onNavigateHome?: () => void;
  /** Optional callback invoked when an unhandled render error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

export interface GlobalErrorBoundaryState {
  hasError: boolean;
  error: NormalizedBoundaryError | null;
  componentStack: string | null;
  showDetails: boolean;
}

export class GlobalErrorBoundary extends Component<
  GlobalErrorBoundaryProps,
  GlobalErrorBoundaryState
> {
  static getDerivedStateFromError(error: unknown): Partial<GlobalErrorBoundaryState> {
    return {
      hasError: true,
      error: normalizeBoundaryError(error),
    };
  }

  state: GlobalErrorBoundaryState = {
    hasError: false,
    error: null,
    componentStack: null,
    showDetails: false,
  };

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({
      componentStack: errorInfo?.componentStack || null,
    });
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    } else if (typeof console !== 'undefined' && typeof console.error === 'function') {
      console.error('[GlobalErrorBoundary] Unhandled view error:', error, errorInfo?.componentStack);
    }
  }

  componentDidUpdate(prevProps: GlobalErrorBoundaryProps): void {
    if (
      this.state.hasError &&
      shouldResetErrorBoundary(prevProps.resetKey, this.props.resetKey)
    ) {
      this.handleReset();
    }
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      componentStack: null,
      showDetails: false,
    });
  };

  handleGoHome = (): void => {
    this.handleReset();
    this.props.onNavigateHome?.();
  };

  handleReloadApp = (): void => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  toggleDetails = (): void => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }));
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const scope = this.props.scope ?? 'app';
    const isFullScreen = scope === 'app';
    const normalized = this.state.error ?? normalizeBoundaryError(null);

    const card = (
      <div
        role="alert"
        aria-live="assertive"
        data-testid="global-error-boundary-fallback"
        data-error-scope={scope}
        className="max-w-lg w-full bg-white dark:bg-slate-900 rounded-2xl border border-red-200 dark:border-red-900/70 shadow-lg p-6 sm:p-7 text-center space-y-5"
      >
        <div className="flex flex-col items-center gap-3">
          {isFullScreen ? (
            <BrandLogo sizeClass="w-14 h-14" className="shadow-sm" />
          ) : null}
          <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800/70 flex items-center justify-center text-red-700 dark:text-red-400">
            <AlertTriangle className="w-6 h-6" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              {isFullScreen ? 'Something went wrong' : 'This screen ran into an unexpected error'}
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1.5 leading-relaxed">
              Your local business data in Arjun Groceries is safe and has not been modified. You can retry this screen or reload the app to continue working.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2.5 pt-1">
          <button
            type="button"
            onClick={this.handleReset}
            data-testid="error-boundary-retry-btn"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" aria-hidden="true" />
            <span>Try Again</span>
          </button>

          {this.props.onNavigateHome && (
            <button
              type="button"
              onClick={this.handleGoHome}
              data-testid="error-boundary-home-btn"
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-sm font-bold transition-colors cursor-pointer"
            >
              <Home className="w-4 h-4" aria-hidden="true" />
              <span>Go to Dashboard</span>
            </button>
          )}

          <button
            type="button"
            onClick={this.handleReloadApp}
            data-testid="error-boundary-reload-btn"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-sm font-semibold transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            <span>Reload App</span>
          </button>
        </div>

        <div className="border-t border-slate-100 dark:border-slate-800 pt-3 text-left">
          <button
            type="button"
            onClick={this.toggleDetails}
            aria-expanded={this.state.showDetails}
            className="w-full flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
          >
            <span>Technical Details</span>
            {this.state.showDetails ? (
              <ChevronUp className="w-4 h-4" aria-hidden="true" />
            ) : (
              <ChevronDown className="w-4 h-4" aria-hidden="true" />
            )}
          </button>

          {this.state.showDetails && (
            <div className="mt-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] font-mono text-slate-700 dark:text-slate-300 break-words space-y-1.5 max-h-40 overflow-y-auto">
              <div className="font-bold text-red-700 dark:text-red-400">
                {normalized.name}: {normalized.message}
              </div>
              {this.state.componentStack && (
                <pre className="whitespace-pre-wrap text-[10px] text-slate-500 dark:text-slate-400">
                  {this.state.componentStack.trim()}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    );

    if (isFullScreen) {
      return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4 sm:p-6">
          {card}
        </div>
      );
    }

    return <div className="py-10 flex items-center justify-center">{card}</div>;
  }
}
