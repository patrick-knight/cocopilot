/**
 * ErrorBoundary — React class component that catches render errors
 * and displays a cocoa-themed fallback UI with a retry button.
 */

import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("[ErrorBoundary] Uncaught error:", error, info.componentStack);
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          backgroundColor: "#3B1F0B",
          color: "#FFF8E7",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: "2rem",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, marginBottom: "0.75rem" }}>
          Something went wrong
        </h1>
        <p style={{ maxWidth: "28rem", lineHeight: 1.6, opacity: 0.85, marginBottom: "1.5rem" }}>
          An unexpected error occurred. You can try again or reload the page.
        </p>
        {this.state.error && (
          <pre
            style={{
              maxWidth: "36rem",
              padding: "1rem",
              borderRadius: "0.5rem",
              backgroundColor: "rgba(0,0,0,0.25)",
              fontSize: "0.8rem",
              overflowX: "auto",
              marginBottom: "1.5rem",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {this.state.error.message}
          </pre>
        )}
        <button
          onClick={this.handleRetry}
          style={{
            padding: "0.625rem 1.5rem",
            backgroundColor: "#D2691E",
            color: "#FFF8E7",
            border: "none",
            borderRadius: "0.375rem",
            fontSize: "1rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try Again
        </button>
      </div>
    );
  }
}
