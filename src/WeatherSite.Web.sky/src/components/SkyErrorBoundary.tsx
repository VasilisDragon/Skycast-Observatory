import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface SkyErrorBoundaryProps {
  label: string;
  children: ReactNode;
  onRetry?: () => void;
}

interface SkyErrorBoundaryState {
  error: Error | null;
  retryKey: number;
}

export class SkyErrorBoundary extends Component<SkyErrorBoundaryProps, SkyErrorBoundaryState> {
  state: SkyErrorBoundaryState = { error: null, retryKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<SkyErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (typeof console !== "undefined") {
      console.error(`[${this.props.label}] render failed`, error, info.componentStack);
    }
  }

  handleRetry = () => {
    this.setState((state) => ({ error: null, retryKey: state.retryKey + 1 }));
    this.props.onRetry?.();
  };

  render() {
    if (this.state.error) {
      return (
        <section className="obs-error-boundary" role="alert" aria-live="polite">
          <p className="obs-label obs-label-amber mb-2">· {this.props.label} · fault</p>
          <h3 className="obs-error-boundary-heading">PANEL RENDER FAILED</h3>
          <p className="obs-error-boundary-message">
            {this.state.error.message ||
              "An unexpected error occurred while drawing this section."}
          </p>
          <button
            type="button"
            className="obs-btn obs-btn-primary"
            onClick={this.handleRetry}
          >
            ↻ Retry panel
          </button>
        </section>
      );
    }

    return <div key={this.state.retryKey} style={{ display: "contents" }}>{this.props.children}</div>;
  }
}
