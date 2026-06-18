import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  GraduationCap, Sun, Moon, Settings, Square, Activity, Radio, ChevronDown, ChevronUp, Globe, ShieldCheck,
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext.jsx';
import { useSession } from '../../context/SessionContext.jsx';
import { useEventStream } from '../../core/EventStreamProvider.jsx';
import GmailConnectionCard from '../GmailConnectionCard.jsx';
import TimeManagement from '../TimeManagement.jsx';
import UniversityOutreachBar from '../UniversityOutreachBar.jsx';
import ModeSwitcher from './ModeSwitcher.jsx';
import { useSettingsModal } from '../../context/SettingsModalContext.jsx';
import { post } from '../../api.js';

export default function AppHeader() {
  const { dark, toggle } = useTheme();
  const navigate = useNavigate();
  const {
    stats,
    health,
    auth,
    settings,
    scheduledBatches,
    sessionReady,
    resetting,
    loadSession,
    resetSession,
    mode,
    backendReachable,
    connectionsSettled,
  } = useSession();
  const { connected: liveConnected } = useEventStream();
  const { openSettings } = useSettingsModal();
  const [stopping, setStopping] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);

  const isActive = stats && (stats.researching > 0 || stats.drafted > 0 || stats.scraping > 0);
  const scrapeRunning = health?.scrapeRunning;
  const workerActive = health?.running && (health?.activeWorkers > 0);
  const scheduledActive = scheduledBatches?.some(b => ['processing', 'sending'].includes(b.status));
  const headerActive = isActive || scrapeRunning || workerActive || scheduledActive;
  const statusLabel = resetting ? 'Resetting' : scrapeRunning ? 'Scraping' : headerActive ? 'Agent active' : 'Idle';

  const handleStop = async () => {
    setStopping(true);
    try {
      await post('/agent/stop');
      await loadSession({ force: true });
    } catch { /* ignore */ }
    setTimeout(() => setStopping(false), 2000);
  };

  const handleResetCurrent = async () => {
    try {
      await resetSession(mode);
      await loadSession({ force: true });
    } catch { /* ignore */ }
  };

  return (
    <header className="sticky top-0 z-40 shrink-0 app-header-bar border-b border-[rgb(var(--border-subtle))]">
      {/* Primary bar */}
      <div className="app-container py-2.5">
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-3">
            {/* Brand */}
            <button
              type="button"
              onClick={() => navigate('/')}
              className="flex items-center gap-2.5 group shrink-0"
            >
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 flex items-center justify-center shadow-lg shadow-brand-500/20 group-hover:scale-[1.02] transition-transform">
                <GraduationCap className="w-5 h-5 text-white" />
              </div>
              <span className="hidden sm:block text-sm font-bold tracking-tight text-[rgb(var(--text-primary))]">
                Email Agent
              </span>
              {auth?.role && (
                <span className={`hidden sm:inline-flex text-[9px] font-bold uppercase px-2 py-1 rounded-full ${
                  auth.role === 'admin'
                    ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300'
                    : 'bg-[rgb(var(--surface-muted))] text-muted'
                }`}>
                  {auth.role}
                </span>
              )}
            </button>

            {/* Mode switcher */}
            <div className="w-full flex justify-center lg:w-auto lg:flex-1 lg:px-2 order-last lg:order-none">
              <ModeSwitcher />
            </div>

            <div className="order-last lg:order-none">
              <UniversityOutreachBar />
            </div>

            {/* Right cluster: status + Gmail + controls */}
            <div className="flex items-center gap-1.5 sm:gap-2 ml-auto shrink-0">
              <div className="hidden md:flex items-center gap-1.5">
                <StatusChip
                  ok={backendReachable && connectionsSettled}
                  label={backendReachable ? 'Backend' : 'Offline'}
                  icon={Activity}
                />
                <StatusChip
                  ok={liveConnected}
                  label={liveConnected ? 'Live' : 'Reconnecting'}
                  icon={Radio}
                  pulse={liveConnected}
                />
                <StatusChip
                  ok={headerActive || resetting}
                  label={statusLabel}
                  icon={Activity}
                  pulse={headerActive}
                  accent={headerActive ? 'emerald' : resetting ? 'blue' : 'neutral'}
                />
                {!!settings?.dry_run_send && <StatusChip ok label="Dry Run" icon={ShieldCheck} accent="blue" />}
              </div>

              <GmailConnectionCard variant="header" />

              {sessionReady && (
                <>
                  <button
                    type="button"
                    onClick={handleStop}
                    disabled={stopping}
                    title="Stop all frontend/backend tasks"
                    className={`hidden lg:flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[11px] font-semibold border transition-colors ${
                      stopping || !headerActive
                        ? 'bg-[rgb(var(--surface-muted))] text-muted border-[rgb(var(--border-subtle))]'
                        : 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30 hover:bg-red-500/15'
                    }`}
                  >
                    <Square className={`w-3 h-3 ${headerActive ? 'fill-current' : ''}`} />
                    {stopping ? 'Stopping…' : 'Stop All'}
                  </button>
                  <button
                    type="button"
                    onClick={handleResetCurrent}
                    disabled={resetting || stopping}
                    title="Reset current session and prepare next run"
                    className={`hidden lg:flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[11px] font-semibold border transition-colors ${
                      resetting
                        ? 'bg-[rgb(var(--surface-muted))] text-muted border-[rgb(var(--border-subtle))]'
                        : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30 hover:bg-blue-500/15'
                    }`}
                  >
                    {resetting ? 'Resetting…' : 'Reset Session'}
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={toggle}
                className="icon-btn"
                aria-label={dark ? 'Light mode' : 'Dark mode'}
              >
                <motion.div key={dark ? 'd' : 'l'} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }}>
                  {dark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-muted" />}
                </motion.div>
              </button>

              <button
                type="button"
                onClick={openSettings}
                className="icon-btn"
                aria-label="Open settings"
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Mobile status row */}
          <div className="flex md:hidden flex-wrap items-center gap-1.5 text-[11px]">
            <StatusChip
              ok={backendReachable && connectionsSettled}
              label={backendReachable ? 'Backend' : 'Offline'}
              icon={Activity}
            />
            <StatusChip ok={liveConnected} label={liveConnected ? 'Live' : 'Reconnecting'} icon={Radio} pulse={liveConnected} />
            <StatusChip
              ok={headerActive || resetting}
              label={statusLabel}
              icon={Activity}
              pulse={headerActive}
              accent={headerActive ? 'emerald' : resetting ? 'blue' : 'neutral'}
            />
            {!!settings?.dry_run_send && <StatusChip ok label="Dry Run" icon={ShieldCheck} accent="blue" />}
          </div>
        </div>
      </div>

      {/* Time zones — attached strip */}
      <div className="border-t border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-muted))]/40">
        <div className="app-container">
          <button
            type="button"
            onClick={() => setTimeOpen(v => !v)}
            className="w-full flex items-center justify-between gap-3 py-2 text-[11px] font-semibold text-muted hover:text-[rgb(var(--text-primary))] transition-colors"
            aria-expanded={timeOpen}
          >
            <span className="inline-flex items-center gap-2">
              <Globe className="w-3.5 h-3.5 text-brand-500" />
              Professor time zones
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] font-medium">
              {timeOpen ? 'Collapse' : 'Expand'}
              {timeOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </span>
          </button>
          <AnimatePresence initial={false}>
            {timeOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="pb-3 pt-0.5">
                  <TimeManagement />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}

function StatusChip({ ok, label, icon: Icon, pulse, accent = 'neutral' }) {
  const colors = {
    emerald: 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/25',
    blue: 'text-blue-700 dark:text-blue-300 bg-blue-500/10 border-blue-500/25',
    neutral: ok
      ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/25'
      : 'text-muted bg-[rgb(var(--surface-muted))] border-[rgb(var(--border-subtle))]',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border font-medium whitespace-nowrap ${colors[accent] || colors.neutral}`}>
      <Icon className={`w-3 h-3 ${pulse ? 'animate-pulse' : ''}`} />
      {label}
    </span>
  );
}
