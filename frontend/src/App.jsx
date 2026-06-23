import React from 'react';
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { SessionProvider, useSession } from './context/SessionContext.jsx';
import { EventStreamProvider } from './core/EventStreamProvider.jsx';
import gmailAuthService from './services/gmailAuthService.js';
import AppHeader from './components/layout/AppHeader.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Instant from './pages/Instant.jsx';
import Scheduled from './pages/Scheduled.jsx';
import BasicInstant from './pages/BasicInstant.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import { SettingsModalProvider, useSettingsModal } from './context/SettingsModalContext.jsx';
import { ToastProvider } from './components/Toast.jsx';
import { TimezoneProvider } from './context/TimezoneContext.jsx';
import { WorkflowLayoutProvider } from './context/WorkflowLayoutContext.jsx';
import { AnalyticsPopupProvider } from './context/AnalyticsPopupContext.jsx';

if (window.location.hostname === '127.0.0.1') {
  const canonical = new URL(window.location.href);
  canonical.hostname = 'localhost';
  window.location.replace(canonical.toString());
}

function OAuthHandler() {
  const { loadSession } = useSession();
  React.useEffect(() => {
    const result = gmailAuthService.parseOAuthReturn(window.location.search);
    if (!result) return;
    gmailAuthService.clearOAuthParams();
    loadSession({ force: true });
  }, [loadSession]);
  return null;
}

function SettingsRouteOpener() {
  const { openSettings } = useSettingsModal();
  const navigate = useNavigate();
  React.useEffect(() => {
    openSettings();
    navigate('/', { replace: true });
  }, [openSettings, navigate]);
  return null;
}

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="min-w-0"
      >
        <Routes location={location}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/instant" element={<Instant />} />
          <Route path="/basic-instant" element={<BasicInstant />} />
          <Route path="/scheduled" element={<Scheduled />} />
          <Route path="/settings" element={<SettingsRouteOpener />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

function AppShell() {
  const { open, closeSettings, sentArchiveRequest } = useSettingsModal();

  return (
    <div className="flex flex-col h-screen overflow-hidden min-w-0 w-full bg-surface-page">
      <OAuthHandler />
      <AppHeader />
      <main className="flex-1 overflow-auto min-w-0 w-full">
        <AnimatedRoutes />
      </main>
      <footer className="shrink-0 border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-page))] px-4 py-1 text-center">
        <a
          href="https://habib.top"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium text-muted transition-colors hover:text-brand-600 dark:hover:text-brand-400"
        >
          Developed by Habib Ur Rehman
        </a>
      </footer>
      <SettingsModal open={open} onClose={closeSettings} sentArchiveRequest={sentArchiveRequest} />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <TimezoneProvider>
          <SessionProvider>
            <BrowserRouter>
              <WorkflowLayoutProvider>
                <AnalyticsPopupProvider>
                  <SettingsModalProvider>
                    <EventStreamProvider>
                      <AppShell />
                    </EventStreamProvider>
                  </SettingsModalProvider>
                </AnalyticsPopupProvider>
              </WorkflowLayoutProvider>
            </BrowserRouter>
          </SessionProvider>
        </TimezoneProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
