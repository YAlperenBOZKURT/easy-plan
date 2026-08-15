import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logger } from '../lib/logger.ts';

type Props = { children: ReactNode };
type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error('react_render_error', error, { componentStack: info.componentStack });
  }

  render() {
    if (this.state.error) {
      return (
        <main className="center-page fatal-error" role="alert">
          <div className="fatal-error-card">
            <h1>Beklenmeyen bir sorun oluştu</h1>
            <p>Verilerin güvende. Sayfayı yenileyerek tekrar deneyebilirsin.</p>
            <button type="button" onClick={() => window.location.reload()}>
              Sayfayı yenile
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
