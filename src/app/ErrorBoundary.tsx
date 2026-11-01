import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Keeps a render error from blanking the whole app; data is safe in the store. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Casa Papel render error', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto max-w-xl p-6 text-sm">
        <h1 className="text-lg font-semibold">Something broke on this screen</h1>
        <p className="mt-2 text-muted-foreground">Your data is safe in this browser. Reload the page to continue. If it keeps happening, export your data from the Data screen and report the message below.</p>
        <pre className="mt-3 overflow-auto rounded-md bg-muted p-3 text-xs">{this.state.error.message}</pre>
        <button className="mt-4 rounded-md border px-3 py-1.5" onClick={() => window.location.reload()}>Reload</button>
      </div>
    )
  }
}
