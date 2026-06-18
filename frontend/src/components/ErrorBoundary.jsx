import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex items-center justify-center h-screen bg-[#f8fafc] dark:bg-black">
          <div className="text-center max-w-md px-6">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <span className="text-2xl">!</span>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Something went wrong</h2>
            <p className="text-sm text-muted mb-6">{this.state.error.message}</p>
            <button
              onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              className="px-5 py-2.5 rounded-xl bg-[#1a73e8] text-white text-sm font-medium hover:bg-[#1557b0] transition-colors"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}