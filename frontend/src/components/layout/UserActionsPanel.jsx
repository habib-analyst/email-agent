import React from 'react';
import { Zap } from 'lucide-react';
import SectionShell from './SectionShell.jsx';

/**
 * Bulk actions, run batch, presets, duplicates, reset.
 */
export default function UserActionsPanel({
  children,
  className = '',
  title = 'Your controls',
  subtitle = 'Actions that require your decision or approval',
}) {
  return (
    <SectionShell
      className={className}
      icon={Zap}
      title={title}
      subtitle={subtitle}
      bodyClassName="p-4 space-y-3"
      collapsible
      defaultOpen
    >
      {children}
    </SectionShell>
  );
}
