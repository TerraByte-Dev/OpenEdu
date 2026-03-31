import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[OpenEdu:ErrorBoundary] Uncaught error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center bg-surface-900 p-8">
          <div className="max-w-md w-full rounded-xl border border-red-500/30 bg-surface-800 p-6 space-y-4">
            <div className="flex items-center gap-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
              <h2 className="text-zinc-100 font-semibold">Something went wrong</h2>
            </div>
            <p className="text-sm text-zinc-400">
              An unexpected error occurred. Your data is safe — reload the app to continue.
            </p>
            {this.state.error && (
              <pre className="text-xs text-red-400/80 bg-surface-900 rounded p-3 overflow-auto max-h-32">
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={() => window.location.reload()}
              className="w-full px-4 py-2 rounded-lg bg-terra-600 hover:bg-terra-500 text-white text-sm font-medium transition-colors"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
