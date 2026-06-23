import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

const STORAGE_KEY = 'email-agent-workflow-layout';
const WorkflowLayoutContext = createContext(null);

function initialLayout() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'slider' || saved === 'scroll' ? saved : 'scroll';
  } catch {
    return 'scroll';
  }
}

export function WorkflowLayoutProvider({ children }) {
  const [layout, setLayoutState] = useState(initialLayout);
  const setLayout = useCallback((next) => {
    const value = next === 'slider' ? 'slider' : 'scroll';
    setLayoutState(value);
    try { localStorage.setItem(STORAGE_KEY, value); } catch { /* browser storage unavailable */ }
  }, []);
  const value = useMemo(() => ({ layout, setLayout }), [layout, setLayout]);
  return <WorkflowLayoutContext.Provider value={value}>{children}</WorkflowLayoutContext.Provider>;
}

export function useWorkflowLayout() {
  const value = useContext(WorkflowLayoutContext);
  if (!value) throw new Error('useWorkflowLayout must be used within WorkflowLayoutProvider');
  return value;
}
