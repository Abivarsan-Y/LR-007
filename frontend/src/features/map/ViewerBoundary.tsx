import { Component, type ReactNode } from 'react'

/** Keep recorded analysis usable if WebGL or the deferred viewer fails. */
export class ViewerBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <div role="alert" className="absolute inset-0 grid place-items-center p-8 text-center text-sm text-slate-300">
      <div>The lunar viewer could not load. Recorded dashboard results remain available.
        <button className="block mx-auto mt-3 underline" onClick={() => window.location.reload()}>Reload viewer</button>
      </div>
    </div>
    return this.props.children
  }
}
