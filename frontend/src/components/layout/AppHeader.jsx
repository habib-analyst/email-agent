import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart3, ChevronDown, GalleryHorizontal, Globe, GraduationCap, Moon,
  Rows3, Settings, Square, Sun,
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext.jsx';
import { useSession } from '../../context/SessionContext.jsx';
import TimeManagement from '../TimeManagement.jsx';
import UniversityOutreachBar from '../UniversityOutreachBar.jsx';
import ModeSwitcher from './ModeSwitcher.jsx';
import { useSettingsModal } from '../../context/SettingsModalContext.jsx';
import { useWorkflowLayout } from '../../context/WorkflowLayoutContext.jsx';
import { post } from '../../api.js';
import { useAnalyticsPopup } from '../../context/AnalyticsPopupContext.jsx';
import InsightsPanel from '../InsightsPanel.jsx';

function AnalyticsMenu() {
  const { open, toggle, close, content } = useAnalyticsPopup();
  const buttonRef = React.useRef(null);
  const popupRef = React.useRef(null);
  const [popupTop, setPopupTop] = React.useState(0);

  React.useLayoutEffect(() => {
    if (!open) return undefined;
    const updateTop = () => {
      const header = buttonRef.current?.closest('header');
      setPopupTop(Math.max(0, Math.round(header?.getBoundingClientRect().bottom || 0)));
    };
    updateTop();
    window.addEventListener('resize', updateTop);
    return () => window.removeEventListener('resize', updateTop);
  }, [open]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = event => {
      if (!buttonRef.current?.contains(event.target) && !popupRef.current?.contains(event.target)) {
        event.preventDefault();
        close();
      }
    };
    const onKeyDown = event => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  const actions = React.useMemo(() => Object.fromEntries(
    Object.entries(content?.actions || {}).map(([key, action]) => [key, action?.onClick ? {
      ...action,
      onClick: () => {
        close();
        action.onClick();
      },
    } : action]),
  ), [content?.actions, close]);

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`group inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-[10px] font-bold transition-all duration-200 ${
          open
            ? 'border-brand-400 bg-brand-500 text-white shadow-lg shadow-brand-500/20'
            : 'border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-card))] text-[rgb(var(--text-primary))] hover:-translate-y-0.5 hover:border-brand-400 hover:shadow-md'
        }`}
      >
        <span className={`relative flex h-6 w-6 items-center justify-center rounded-lg ${open ? 'bg-white/20' : 'bg-gradient-to-br from-brand-500 to-violet-600'}`}>
          <BarChart3 className="h-3.5 w-3.5 text-white transition-transform duration-300 group-hover:scale-110" />
          <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
        </span>
        <span className="hidden xl:inline">Analytics</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <div
              className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex items-start justify-center px-3 pb-3 sm:px-6 sm:pb-6"
              style={{ top: popupTop }}
              aria-hidden={!open}
            >
              <motion.div
                ref={popupRef}
                role="dialog"
                aria-modal="true"
                aria-label="Analytics and insights"
                initial={{ opacity: 0, y: -18, scale: 0.965 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -12, scale: 0.975 }}
                transition={{ type: 'spring', stiffness: 520, damping: 38, mass: 0.65 }}
                className="pointer-events-auto mt-0 max-h-[calc(100%_-_12px)] w-[min(1280px,calc(100vw-24px))] overflow-auto rounded-3xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-card))] shadow-2xl shadow-black/30"
              >
                <div className="p-4">
                  {content ? (
                    <InsightsPanel
                      stats={content.stats}
                      queueStats={content.queueStats}
                      apiUsage={content.apiUsage}
                      health={content.health}
                      progress={content.progress}
                      replyStats={content.replyStats}
                      actions={actions}
                      freshness={content.freshness}
                      hideHeader
                    />
                  ) : (
                    <div className="py-12 text-center text-sm text-muted">Analytics are available inside Instant and Scheduled modes.</div>
                  )}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

function LayoutToggle({ compact = false }) {
  const { layout, setLayout } = useWorkflowLayout();
  return (
    <div className="flex items-center rounded-xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-muted))] p-0.5">
      <button
        type="button"
        onClick={() => setLayout('scroll')}
        className={`inline-flex items-center gap-1.5 rounded-lg ${compact ? 'p-2' : 'px-2.5 py-1.5'} text-[10px] font-bold transition-all ${layout === 'scroll' ? 'bg-[rgb(var(--surface-card))] text-brand-600 shadow-sm' : 'text-muted hover:text-[rgb(var(--text-primary))]'}`}
        aria-label="Scroll layout"
        aria-pressed={layout === 'scroll'}
      >
        <Rows3 className="h-3.5 w-3.5" /> {!compact && 'Scroll'}
      </button>
      <button
        type="button"
        onClick={() => setLayout('slider')}
        className={`inline-flex items-center gap-1.5 rounded-lg ${compact ? 'p-2' : 'px-2.5 py-1.5'} text-[10px] font-bold transition-all ${layout === 'slider' ? 'bg-[rgb(var(--surface-card))] text-brand-600 shadow-sm' : 'text-muted hover:text-[rgb(var(--text-primary))]'}`}
        aria-label="Slider layout"
        aria-pressed={layout === 'slider'}
      >
        <GalleryHorizontal className="h-3.5 w-3.5" /> {!compact && 'Slider'}
      </button>
    </div>
  );
}

function TimeZonesMenu() {
  const [open, setOpen] = useState(false);
  const [popupTop, setPopupTop] = useState(0);
  const buttonRef = React.useRef(null);
  const popupRef = React.useRef(null);

  React.useLayoutEffect(() => {
    if (!open) return undefined;
    const updateTop = () => {
      const header = buttonRef.current?.closest('header');
      setPopupTop(Math.max(0, Math.round(header?.getBoundingClientRect().bottom || 0)));
    };
    updateTop();
    window.addEventListener('resize', updateTop);
    return () => window.removeEventListener('resize', updateTop);
  }, [open]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = event => {
      if (!buttonRef.current?.contains(event.target) && !popupRef.current?.contains(event.target)) {
        event.preventDefault();
        setOpen(false);
      }
    };
    const onKeyDown = event => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        className={`group inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-[10px] font-bold transition-all ${
          open
            ? 'border-sky-400 bg-sky-500 text-white shadow-lg shadow-sky-500/20'
            : 'border-sky-500/25 bg-sky-500/10 text-sky-700 hover:-translate-y-0.5 hover:border-sky-400 hover:bg-sky-500/15 hover:shadow-md dark:text-sky-300'
        }`}
      >
        <Globe className={`h-4 w-4 transition-transform duration-300 ${open ? 'rotate-12' : 'group-hover:rotate-12'}`} />
        <span className="hidden xl:inline">Time zones</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex items-start justify-center px-3 pb-3 sm:px-6 sm:pb-6" style={{ top: popupTop }}>
              <motion.div
                ref={popupRef}
                role="dialog"
                aria-label="Professor time zones"
                initial={{ opacity: 0, y: -18, scaleY: 0.98 }}
                animate={{ opacity: 1, y: 0, scaleY: 1 }}
                exit={{ opacity: 0, y: -12, scaleY: 0.99 }}
                transition={{ type: 'spring', stiffness: 520, damping: 40, mass: 0.7 }}
                className="pointer-events-auto max-h-full w-[min(1280px,calc(100vw-24px))] overflow-auto rounded-3xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-card))] p-4 shadow-2xl shadow-black/30"
                style={{ transformOrigin: 'top center' }}
              >
                <TimeManagement />
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

export default function AppHeader() {
  const { dark, toggle } = useTheme();
  const navigate = useNavigate();
  const {
    stats, health, auth, scheduledBatches, sessionReady, resetting,
    loadSession, resetSession, mode,
  } = useSession();
  const { openSettings } = useSettingsModal();
  const [stopping, setStopping] = useState(false);

  const instantActive = stats && (stats.researching > 0 || stats.drafted > 0 || stats.scraping > 0);
  const scheduledActive = scheduledBatches?.some(batch => ['processing', 'sending'].includes(batch.status));
  const headerActive = instantActive || health?.scrapeRunning || (health?.running && health?.activeWorkers > 0) || scheduledActive;

  const handleStop = async () => {
    setStopping(true);
    try {
      await post('/agent/stop');
      await loadSession({ force: true });
    } catch { /* toast is handled by workflow surfaces */ }
    setTimeout(() => setStopping(false), 2000);
  };

  const handleResetCurrent = async () => {
    try {
      await resetSession(mode);
      await loadSession({ force: true });
    } catch { /* session surface reports the error */ }
  };

  return (
    <header className="sticky top-0 z-40 shrink-0 app-header-bar border-b border-[rgb(var(--border-subtle))]">
      <div className="app-container py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => navigate('/')} className="flex items-center gap-2.5 group shrink-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 flex items-center justify-center shadow-lg shadow-brand-500/20 group-hover:scale-[1.02] transition-transform">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <span className="hidden sm:block text-sm font-bold tracking-tight text-[rgb(var(--text-primary))]">Email Agent</span>
            {auth?.role && (
              <span className={`hidden sm:inline-flex text-[9px] font-bold uppercase px-2 py-1 rounded-full ${auth.role === 'admin' ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300' : 'bg-[rgb(var(--surface-muted))] text-muted'}`}>
                {auth.role}
              </span>
            )}
          </button>

          <div className="w-full flex justify-center lg:w-auto lg:flex-1 lg:px-2 order-last lg:order-none"><ModeSwitcher /></div>
          <div className="order-last flex items-center gap-2 lg:order-none">
            <AnalyticsMenu />
            <UniversityOutreachBar />
            <TimeZonesMenu />
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 ml-auto shrink-0">
            <div className="hidden sm:block"><LayoutToggle /></div>
            {sessionReady && (
              <>
                <button
                  type="button"
                  onClick={handleStop}
                  disabled={stopping || !headerActive}
                  title="Stop all frontend/backend tasks"
                  className={`hidden lg:flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[11px] font-semibold border transition-colors ${stopping || !headerActive ? 'bg-[rgb(var(--surface-muted))] text-muted border-[rgb(var(--border-subtle))]' : 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30 hover:bg-red-500/15'}`}
                >
                  <Square className={`w-3 h-3 ${headerActive ? 'fill-current' : ''}`} />
                  {stopping ? 'Stopping…' : 'Stop All'}
                </button>
                <button
                  type="button"
                  onClick={handleResetCurrent}
                  disabled={resetting || stopping}
                  className={`hidden lg:flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[11px] font-semibold border transition-colors ${resetting ? 'bg-[rgb(var(--surface-muted))] text-muted border-[rgb(var(--border-subtle))]' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30 hover:bg-blue-500/15'}`}
                >
                  {resetting ? 'Resetting…' : 'Reset Session'}
                </button>
              </>
            )}
            <button type="button" onClick={toggle} className="icon-btn" aria-label={dark ? 'Light mode' : 'Dark mode'}>
              <motion.div key={dark ? 'd' : 'l'} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }}>
                {dark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-muted" />}
              </motion.div>
            </button>
            <button type="button" onClick={openSettings} className="icon-btn" aria-label="Open settings"><Settings className="w-4 h-4" /></button>
          </div>

          <div className="sm:hidden ml-auto"><LayoutToggle compact /></div>
        </div>
      </div>

    </header>
  );
}
