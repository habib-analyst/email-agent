import React from 'react';

/**
 * Unified page shell — title, description, optional actions, consistent spacing.
 */
export default function PageLayout({
  title,
  subtitle,
  badge,
  actions,
  children,
  className = '',
}) {
  return (
    <div className={`app-container py-6 sm:py-8 space-y-6 ${className}`}>
      {(title || subtitle || actions) && (
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              {badge}
              {title && (
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[rgb(var(--text-primary))]">
                  {title}
                </h1>
              )}
            </div>
            {subtitle && (
              <p className="text-sm text-muted max-w-2xl leading-relaxed">{subtitle}</p>
            )}
          </div>
          {actions && (
            <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
