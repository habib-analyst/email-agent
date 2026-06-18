import React from 'react';

/** Workflow page shell — sections only, no duplicate page hero. */
export default function WorkflowPage({ children, className = '' }) {
  return (
    <div className={`app-container py-5 sm:py-6 space-y-5 ${className}`}>
      {children}
    </div>
  );
}
