import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const AnalyticsPopupContext = createContext(null);

export function AnalyticsPopupProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState(null);

  const register = useCallback((next) => {
    setContent(next);
    return () => setContent(current => current === next ? null : current);
  }, []);

  const value = useMemo(() => ({
    open,
    setOpen,
    toggle: () => setOpen(current => !current),
    close: () => setOpen(false),
    content,
    register,
  }), [open, content, register]);

  return <AnalyticsPopupContext.Provider value={value}>{children}</AnalyticsPopupContext.Provider>;
}

export function useAnalyticsPopup() {
  const value = useContext(AnalyticsPopupContext);
  if (!value) throw new Error('useAnalyticsPopup must be used within AnalyticsPopupProvider');
  return value;
}

export function AnalyticsPopupRegistration(props) {
  const { register } = useAnalyticsPopup();
  useEffect(() => register(props), [
    register,
    props.stats,
    props.queueStats,
    props.apiUsage,
    props.health,
    props.progress,
    props.replyStats,
    props.actions,
    props.freshness,
  ]);
  return null;
}
