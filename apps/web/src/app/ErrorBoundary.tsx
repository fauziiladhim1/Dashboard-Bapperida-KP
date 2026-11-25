import { Component, type ReactNode } from 'react';
import { ErrorPage } from '@/features/errors/ErrorPage';

/** Menangkap error render satu halaman agar shell & navigasi tetap hidup. `resetKey` berubah -> coba render ulang. */
export class ErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { failed: boolean; key: string }> {
  state = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { failed: boolean; key: string }) {
    return props.resetKey === state.key ? null : { failed: false, key: props.resetKey };
  }

  render() {
    return this.state.failed ? <ErrorPage code={500} onRetry={() => this.setState({ failed: false })} /> : this.props.children;
  }
}
