import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

const SettingsModalContext = createContext(null);

export function SettingsModalProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [sentArchiveRequest, setSentArchiveRequest] = useState(0);

  const openSettings = useCallback(() => setOpen(true), []);
  const openSentArchive = useCallback(() => {
    setOpen(true);
    setSentArchiveRequest(value => value + 1);
  }, []);
  const closeSettings = useCallback(() => setOpen(false), []);

  const value = useMemo(
    () => ({ open, openSettings, openSentArchive, closeSettings, sentArchiveRequest }),
    [open, openSettings, openSentArchive, closeSettings, sentArchiveRequest],
  );

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
