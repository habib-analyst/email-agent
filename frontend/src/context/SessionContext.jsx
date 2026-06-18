import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { get, post, BOOTSTRAP_TIMEOUT } from '../api.js';
import {
  loadCachedAuth, saveCachedAuth, markBackendOk, wasBackendRecentlyOk, clearBackendOk, mergeAuthState,
} from '../utils/connectionCache.js';

const EMPTY_STATS = {
  total: 0, sent: 0, pending: 0, awaitingProceed: 0, duplicateReview: 0, failed: 0, researching: 0, drafted: 0,
  verified: 0, skipped: 0, replied: 0, todaySent: 0, totalSent: 0, uniqueSentEmails: 0, scraping: 0, sessionEpoch: 0,
};

const EMPTY_SCHEDULED_STATS = {
  total: 0, sent: 0, pending: 0, approved: 0, failed: 0, todaySent: 0, totalSent: 0, uniqueSentEmails: 0, sessionEpoch: 0,
  batches: { total: 0, pending: 0, drafted: 0, scheduled: 0, sending: 0, completed: 0 },
  drafts: { total: 0, draft: 0, approved: 0, sent: 0, failed: 0 },
};

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  // Per-mode state (instant vs basic_instant never share queue/stats/template)
  const [instantStats, setInstantStats] = useState(EMPTY_STATS);
  const [basicStats, setBasicStats] = useState(EMPTY_STATS);
  const [instantQueue, setInstantQueue] = useState([]);
  const [basicQueue, setBasicQueue] = useState([]);
  const [instantTemplate, setInstantTemplate] = useState(null);
  const [basicTemplate, setBasicTemplate] = useState(null);

  // Scheduled-mode state (completely separate from instant)
  const [scheduledStats, setScheduledStats] = useState(EMPTY_SCHEDULED_STATS);
  const [scheduledBatches, setScheduledBatches] = useState([]);
  const [scheduledDrafts, setScheduledDrafts] = useState([]);
  const [scheduledTemplate, setScheduledTemplate] = useState(null);
  const [basicScheduledTemplate, setBasicScheduledTemplate] = useState(null);
  const [basicScheduledAgentContext, setBasicScheduledAgentContext] = useState(null);

  // Shared state
  const [settings, setSettings] = useState(null);
  const [auth, setAuthState] = useState(() => loadCachedAuth());
  const [health, setHealth] = useState(null);
  const [sessionReady, setSessionReady] = useState(() => wasBackendRecentlyOk());
  const [backendReachable, setBackendReachable] = useState(() => wasBackendRecentlyOk());
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionRefreshing, setSessionRefreshing] = useState(false);
  const [connectionsSettled, setConnectionsSettled] = useState(() => wasBackendRecentlyOk());
  const initialLoadDoneRef = useRef(false);
  const [sessionError, setSessionError] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [sessionVersion, setSessionVersion] = useState(0);
  const [analytics, setAnalytics] = useState(null);
  const [agentContext, setAgentContext] = useState(null);
  const [mode, setMode] = useState('instant');

  const setAuth = useCallback((next) => {
    setAuthState(prev => {
      const merged = typeof next === 'function' ? next(prev) : next;
      if (merged?.authenticated) saveCachedAuth(merged);
      else if (merged && merged.authenticated === false) saveCachedAuth(null);
      return merged;
    });
  }, []);

  // Persist auth to localStorage whenever server updates it
  useEffect(() => {
    if (auth?.authenticated) saveCachedAuth(auth);
  }, [auth]);
  const sessionEpochRef = useRef(0);
  const loadPromiseRef = useRef(null);
  const modeRef = useRef('instant');

  const applyServerData = useCallback((data, epoch) => {
    if (epoch != null) sessionEpochRef.current = epoch;

    if (modeRef.current === 'scheduled') {
      setScheduledStats(data.stats ?? { ...EMPTY_SCHEDULED_STATS, sessionEpoch: sessionEpochRef.current });
      setScheduledBatches(Array.isArray(data.batches) ? data.batches : []);
      setScheduledDrafts(Array.isArray(data.drafts) ? data.drafts : []);
      setScheduledTemplate(data.template?.raw_html ? data.template : null);
      if (data.basicScheduledTemplate !== undefined) {
        setBasicScheduledTemplate(data.basicScheduledTemplate?.raw_html ? data.basicScheduledTemplate : null);
      }
      if (data.basicScheduledAgentContext !== undefined) {
        setBasicScheduledAgentContext(data.basicScheduledAgentContext);
      }
    } else if (modeRef.current === 'basic_instant') {
      setBasicStats(data.stats ?? { ...EMPTY_STATS, sessionEpoch: sessionEpochRef.current });
      setBasicQueue(Array.isArray(data.queue) ? data.queue : []);
      setBasicTemplate(data.template?.raw_html ? data.template : null);
    } else {
      setInstantStats(data.stats ?? { ...EMPTY_STATS, sessionEpoch: sessionEpochRef.current });
      setInstantQueue(Array.isArray(data.queue) ? data.queue : []);
      setInstantTemplate(data.template?.raw_html ? data.template : null);
    }

    if (data.analytics !== undefined) setAnalytics(data.analytics);
    if (data.agentContext !== undefined) setAgentContext(data.agentContext);
  }, []);

  useEffect(() => {
    modeRef.current = mode;
    loadPromiseRef.current = null;
  }, [mode]);

  const backendFailStreakRef = useRef(0);

  const loadSession = useCallback(async (options = {}) => {
    const force = options === true || options?.force;
    if (loadPromiseRef.current && !force) return loadPromiseRef.current;
    if (force) loadPromiseRef.current = null;

    const run = (async () => {
      const isInitial = !initialLoadDoneRef.current;
      if (isInitial) setSessionLoading(true);
      else setSessionRefreshing(true);

      try {
        // Fast ping — one retry helps when frontend loads before backend is listening
        const ping = async () => get('/health', { timeout: 4000 });
        try {
          await ping();
        } catch {
          await new Promise(r => setTimeout(r, 2500));
          await ping();
        }

        const data = await get(`/bootstrap?mode=${modeRef.current}`, { timeout: BOOTSTRAP_TIMEOUT });
        const epoch = data?.session?.epoch ?? data?.stats?.sessionEpoch ?? sessionEpochRef.current;
        sessionEpochRef.current = epoch;
        setSettings(data.settings ?? null);
        setHealth(data.health ?? null);
        applyServerData(data, epoch);
        setAuth(mergeAuthState(loadCachedAuth(), data.auth, { allowCache: !initialLoadDoneRef.current }));
        markBackendOk();
        setBackendReachable(true);
        setSessionReady(true);
        backendFailStreakRef.current = 0;
        setSessionError(null);
        if (data.auth?.authenticated) saveCachedAuth(data.auth);
        setConnectionsSettled(true);
        initialLoadDoneRef.current = true;

        // Prefetch sibling instant-family template so mode switch is instant
        const current = modeRef.current;
        if (current === 'instant' || current === 'basic_instant') {
          const other = current === 'instant' ? 'basic_instant' : 'instant';
          Promise.allSettled([
            get(`/template?mode=${other}`, { timeout: 6000 }),
            get(`/stats?mode=${other}`, { timeout: 6000 }),
            get(`/queue?mode=${other}`, { timeout: 6000 }),
          ]).then(([tRes, sRes, qRes]) => {
            if (tRes.status === 'fulfilled' && tRes.value?.raw_html) {
              if (other === 'basic_instant') setBasicTemplate(tRes.value);
              else setInstantTemplate(tRes.value);
            }
            if (sRes.status === 'fulfilled' && sRes.value) {
              if (other === 'basic_instant') setBasicStats(sRes.value);
              else setInstantStats(sRes.value);
            }
            if (qRes.status === 'fulfilled' && Array.isArray(qRes.value)) {
              if (other === 'basic_instant') setBasicQueue(qRes.value);
              else setInstantQueue(qRes.value);
            }
          }).catch(() => {});
        }

        return { epoch, stats: data.stats, queue: data.queue, batches: data.batches, drafts: data.drafts };
      } catch (bootstrapErr) {
        try {
          const m = modeRef.current;
          const short = { timeout: 6000 };
          const results = await Promise.allSettled([
            get(`/stats?mode=${m}`, short),
            get(`/queue?mode=${m}`, short),
            get(`/template?mode=${m}`, short),
            get('/settings', short),
            get('/health', short),
            get('/session', short),
          ]);

          const pick = (i, fallback = null) =>
            results[i].status === 'fulfilled' ? results[i].value : fallback;

          const s = pick(0, { ...EMPTY_STATS, sessionEpoch: sessionEpochRef.current });
          const q = pick(1, []);
          const t = pick(2, null);
          const cfg = pick(3, null);
          const h = pick(4, null);
          const meta = pick(5, { epoch: sessionEpochRef.current });

          const epoch = meta?.epoch ?? s?.sessionEpoch ?? sessionEpochRef.current;
          sessionEpochRef.current = epoch;
          setSettings(cfg);
          setHealth(h);
          applyServerData({ stats: s, queue: q, template: t }, epoch);

          const anyOk = results.some(r => r.status === 'fulfilled');
          backendFailStreakRef.current += 1;
          if (anyOk) {
            markBackendOk();
            setBackendReachable(true);
            setSessionReady(true);
            backendFailStreakRef.current = 0;
            setSessionError('Some data could not be loaded — retrying in the background');
          } else if (backendFailStreakRef.current >= 2 && !wasBackendRecentlyOk()) {
            clearBackendOk();
            setBackendReachable(false);
            setSessionError('Backend not reachable — run `npm run dev` from the project root and wait ~10s');
          } else if (wasBackendRecentlyOk()) {
            setBackendReachable(true);
            setSessionError(null);
          } else {
            setSessionError('Backend not reachable — run `npm run dev` from the project root and wait ~10s');
          }
          return { epoch, stats: s, queue: q };
        } catch {
          backendFailStreakRef.current += 1;
          if (backendFailStreakRef.current >= 2 && !wasBackendRecentlyOk()) {
            clearBackendOk();
            setBackendReachable(false);
            setSessionError('Backend not reachable — run `npm run dev` from the project root and wait ~10s');
          }
          applyServerData(
            { stats: { ...EMPTY_STATS, sessionEpoch: sessionEpochRef.current }, queue: [], template: null },
            sessionEpochRef.current,
          );
          return null;
        }
      } finally {
        setSessionLoading(false);
        setSessionRefreshing(false);
        loadPromiseRef.current = null;
      }
    })();

    loadPromiseRef.current = run;
    return run;
  }, [applyServerData]);

  useEffect(() => {
    loadSession();
    const i = setInterval(loadSession, 30000);
    return () => clearInterval(i);
  }, [loadSession, sessionVersion, mode]);

  const resetAllSession = useCallback(async () => {
    setResetting(true);
    try {
      const res = await post('/reset', { mode: 'all' });
      if (!res?.success) throw new Error(res?.error || 'Reset failed');

      const epoch = res.sessionEpoch ?? sessionEpochRef.current + 1;
      sessionEpochRef.current = epoch;

      setInstantStats({ ...EMPTY_STATS, sessionEpoch: epoch });
      setBasicStats({ ...EMPTY_STATS, sessionEpoch: epoch });
      setInstantQueue([]);
      setBasicQueue([]);
      setInstantTemplate(null);
      setBasicTemplate(null);
      setScheduledStats({ ...EMPTY_SCHEDULED_STATS, sessionEpoch: epoch });
      setScheduledBatches([]);
      setScheduledDrafts([]);
      setScheduledTemplate(null);
      setBasicScheduledTemplate(null);
      setBasicScheduledAgentContext(null);

      setSessionVersion(v => v + 1);
      await new Promise(r => setTimeout(r, 500));
      await loadSession({ force: true });
      return { success: true, sessionEpoch: epoch, backupPath: res.backupPath };
    } catch (e) {
      return { success: false, error: e.message };
    } finally {
      setResetting(false);
    }
  }, [loadSession]);

  const resetSession = useCallback(async (modeOverride) => {
    const resetMode = modeOverride || modeRef.current;
    setResetting(true);
    try {
      const res = await post('/reset', { mode: resetMode });
      if (!res?.success) throw new Error(res?.error || 'Reset failed');

      const epoch = res.sessionEpoch ?? sessionEpochRef.current + 1;
      sessionEpochRef.current = epoch;

      if (resetMode === 'scheduled' || resetMode === 'basic_scheduled') {
        if (resetMode === 'basic_scheduled') {
          setBasicScheduledTemplate(null);
        } else {
          setScheduledTemplate(null);
        }
        setScheduledStats({ ...EMPTY_SCHEDULED_STATS, sessionEpoch: epoch });
        setScheduledBatches([]);
        setScheduledDrafts([]);
      } else if (resetMode === 'basic_instant') {
        setBasicStats({ ...EMPTY_STATS, ...res.stats, sessionEpoch: epoch });
        setBasicQueue([]);
        setBasicTemplate(null);
      } else {
        setInstantStats({ ...EMPTY_STATS, ...res.stats, sessionEpoch: epoch });
        setInstantQueue([]);
        setInstantTemplate(null);
      }

      setSessionVersion(v => v + 1);

      await new Promise(r => setTimeout(r, 500));

      const verify = await loadSession();
      if (resetMode === 'instant' && verify && (verify.stats?.total > 0 || (Array.isArray(verify.queue) && verify.queue.length > 0))) {
        throw new Error('Reset did not clear the database — please try again');
      }
      if (resetMode === 'basic_instant' && verify && (verify.stats?.total > 0 || (Array.isArray(verify.queue) && verify.queue.length > 0))) {
        throw new Error('Reset did not clear the database — please try again');
      }
      if ((resetMode === 'scheduled' || resetMode === 'basic_scheduled') && verify && (Array.isArray(verify.batches) && verify.batches.length > 0)) {
        const modeBatches = verify.batches.filter(b => (b.batch_mode || 'scheduled') === resetMode);
        if (modeBatches.length > 0) throw new Error('Reset did not clear the database — please try again');
      }

      return { success: true, sessionEpoch: epoch, backupPath: res.backupPath };
    } catch (e) {
      return { success: false, error: e.message };
    } finally {
      setResetting(false);
    }
  }, [loadSession]);

  const applyReset = useCallback((epoch) => {
    if (epoch != null) sessionEpochRef.current = epoch;

    if (modeRef.current === 'scheduled') {
      setScheduledStats(prev => ({ ...EMPTY_SCHEDULED_STATS, sessionEpoch: epoch ?? sessionEpochRef.current }));
      setScheduledBatches([]);
      setScheduledDrafts([]);
      setScheduledTemplate(null);
      setBasicScheduledTemplate(null);
    } else if (modeRef.current === 'basic_instant') {
      setBasicStats(prev => ({ ...EMPTY_STATS, sessionEpoch: epoch ?? sessionEpochRef.current }));
      setBasicQueue([]);
      setBasicTemplate(null);
    } else {
      setInstantStats(prev => ({ ...EMPTY_STATS, sessionEpoch: epoch ?? sessionEpochRef.current }));
      setInstantQueue([]);
      setInstantTemplate(null);
    }

    setSessionVersion(v => v + 1);
  }, []);

  const setTemplate = useCallback((tpl) => {
    if (modeRef.current === 'basic_instant') setBasicTemplate(tpl);
    else setInstantTemplate(tpl);
  }, []);

  const setStats = useCallback((s) => {
    if (modeRef.current === 'basic_instant') setBasicStats(s);
    else setInstantStats(s);
  }, []);

  const setQueue = useCallback((q) => {
    if (modeRef.current === 'basic_instant') setBasicQueue(q);
    else setInstantQueue(q);
  }, []);

  const stats = mode === 'scheduled' ? scheduledStats : mode === 'basic_instant' ? basicStats : instantStats;
  const queue = mode === 'basic_instant' ? basicQueue : instantQueue;
  const template = mode === 'basic_instant' ? basicTemplate : instantTemplate;

  return (
    <SessionContext.Provider value={{
      // Instant-mode state
      stats, queue, template, instantTemplate, basicTemplate, instantStats, basicStats, instantQueue, basicQueue,
      setStats, setQueue, setTemplate, setInstantTemplate, setBasicTemplate,

      // Scheduled-mode state
      scheduledStats, scheduledBatches, scheduledDrafts, scheduledTemplate, basicScheduledTemplate, basicScheduledAgentContext,
      setScheduledStats, setScheduledBatches, setScheduledDrafts, setScheduledTemplate, setBasicScheduledTemplate,

      // Shared state
      settings, auth, health, analytics, agentContext, mode, backendReachable,
      sessionReady, sessionLoading, sessionRefreshing, connectionsSettled, sessionError, resetting, sessionVersion, sessionEpoch: sessionEpochRef.current,
      setSettings, setAuth, setAnalytics, setMode,
      loadSession, resetSession, resetAllSession, applyReset, getSessionEpoch: () => sessionEpochRef.current,
      emptyStats: EMPTY_STATS,
    }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
