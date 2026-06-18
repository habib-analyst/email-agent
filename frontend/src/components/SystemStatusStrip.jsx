import React from 'react';
import { RefreshCw, Wifi, WifiOff, Mail, Server } from 'lucide-react';
import { useSession } from '../context/SessionContext.jsx';
import { useEventStream } from '../core/EventStreamProvider.jsx';
import useGmailAuth from '../hooks/useGmailAuth.js';

/** Unified backend + Gmail + live stream status with recovery actions. */
export default function SystemStatusStrip({ onRefresh, className = '' }) {
  const { sessionError, backendReachable, sessionLoading, sessionRefreshing, loadSession, connectionsSettled } = useSession();
  const { connected: sseConnected } = useEventStream();
  const { isConnected: gmailConnected, senderEmail, senderName, connect, connecting } = useGmailAuth();

  const backendOk = backendReachable && !sessionError && connectionsSettled;
  const refresh = onRefresh || (() => loadSession({ force: true }));

  return (
    <div className={`flex flex-wrap items-center gap-2 p-2.5 rounded-xl bg-gray-50 dark:bg-neutral-900/50 border border-gray-200 dark:border-neutral-800 text-[11px] ${className}`}>
      <span className="font-semibold text-muted mr-1">System</span>

      <StatusPill
        ok={backendOk}
        okLabel="Backend"
        badLabel="Backend offline"
        icon={backendOk ? Server : Server}
        badClass="text-amber-700 bg-amber-50 border-amber-200"
      />

      <StatusPill
        ok={gmailConnected}
        okLabel={senderEmail ? (
          <>
            <span className="hidden 2xl:inline">{senderName ? `${senderName} · ` : ''}</span>
            <span className="truncate max-w-[8rem] xl:max-w-[12rem] 2xl:max-w-none">{senderEmail}</span>
          </>
        ) : 'Gmail connected'}
        badLabel="Gmail disconnected"
        icon={Mail}
        badClass="text-red-700 bg-red-50 border-red-200 cursor-pointer hover:bg-red-100"
        onClickBad={!gmailConnected && !connecting ? connect : undefined}
        loading={connecting}
        title={gmailConnected && senderEmail ? `${senderName || ''} ${senderEmail}`.trim() : undefined}
      />

      <StatusPill
        ok={sseConnected}
        okLabel="Live updates"
        badLabel="Live paused — reconnecting…"
        icon={sseConnected ? Wifi : WifiOff}
        badClass="text-amber-700 bg-amber-50 border-amber-200"
      />

      {(!backendOk || !sseConnected) && (
        <button
          type="button"
          onClick={refresh}
          disabled={sessionLoading || sessionRefreshing}
          className="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 font-medium transition-colors"
        >
          <RefreshCw className={`w-3 h-3 ${sessionLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      )}

      {!sseConnected && (
        <span className="w-full text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
          Queue may be stale until live connection restores — click Refresh if needed.
        </span>
      )}
    </div>
  );
}

function StatusPill({ ok, okLabel, badLabel, icon: Icon, badClass, onClickBad, loading, title }) {
  const Tag = onClickBad ? 'button' : 'span';
  return (
    <Tag
      type={onClickBad ? 'button' : undefined}
      onClick={onClickBad}
      title={title}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border font-medium min-w-0 max-w-full ${
        ok
          ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-50/80 dark:bg-neutral-800 border-emerald-200/80 dark:border-emerald-800'
          : badClass + ' dark:bg-opacity-20'
      }`}
    >
      {loading ? <RefreshCw className="w-3 h-3 animate-spin shrink-0" /> : <Icon className="w-3 h-3 shrink-0" />}
      <span className="truncate min-w-0">{ok ? okLabel : badLabel}</span>
    </Tag>
  );
}
