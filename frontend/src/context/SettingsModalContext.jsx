import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

const SettingsModalContext = createContext(null);

export function SettingsModalProvider({ children }) {
  const [open, setOpen] = useState(false);

  const openSettings = useCallback(() => setOpen(true), []);
  const closeSettings = useCallback(() => setOpen(false), []);

  const value = useMemo(() => ({ open, openSettings, closeSettings }), [open, openSettings, closeSettings]);

  return (
    <SettingsModalContext.Provider value={value}>
      {children}
    </SettingsModalContext.Provider>
  );
}

export function useSettingsModal() {
  const ctx = useContext(SettingsModalContext);
  if (!ctx) throw new Error('useSettingsModal must be used within SettingsModalProvider');
  return ctx;
}
