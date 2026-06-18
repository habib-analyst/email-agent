import React from 'react';
import { motion } from 'framer-motion';
import { Link2, CheckCircle2, XCircle, Loader2, Mail, FileText, Shield } from 'lucide-react';
import useGmailAuth from '../hooks/useGmailAuth.js';

function initialsFromIdentity(name, email) {
  const n = (name || '').trim();
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    return n.slice(0, 2).toUpperCase();
  }
  return (email?.[0] || '?').toUpperCase();
}

function GmailMark({ connected = false, className = '' }) {
  return (
    <div className={`relative shrink-0 ${className}`}>
      <div className="w-12 h-12 rounded-2xl bg-white dark:bg-neutral-900 border border-gray-200/80 dark:border-neutral-700 shadow-sm flex items-center justify-center overflow-hidden">
        <svg viewBox="0 0 48 48" className="w-7 h-7" aria-hidden>
          <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303C33.654 32.657 29.223 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
          <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
          <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
          <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.655-.389-3.917z" />
        </svg>
      </div>
      {connected && (
        <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-500 border-2 border-white dark:border-neutral-900 flex items-center justify-center">
          <CheckCircle2 className="w-2.5 h-2.5 text-white" strokeWidth={3} />
        </span>
      )}
    </div>
  );
}

const GMAIL_FEATURES = [
  { label: 'Send outreach', icon: Mail },
  { label: 'Load your template', icon: FileText },
  { label: 'Secure OAuth', icon: Shield },
];
function SenderIdentity({ name, email, className = '' }) {
  if (!email && !name) return null;
  return (
    <div className={`min-w-0 ${className}`}>
      {name && (
        <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">{name}</p>
      )}
      {email && (
        <p className="text-[11px] text-muted truncate font-mono">{email}</p>
      )}
    </div>
  );
}

/**
 * Shared Gmail connection UI — banner | header | card | compact
 */
export default function GmailConnectionCard({ variant = 'card', className = '' }) {
  const {
    isConnected, senderEmail, senderName, connect, disconnect, connecting, disconnecting, sessionReady, authPending, connectionsSettled,
  } = useGmailAuth();

  const authKnown = sessionReady || isConnected;
  const showChecking = authPending || (!authKnown && !isConnected);
  const displayName = senderName?.trim() || '';

  if (variant === 'banner') {
    if (showChecking && !connectionsSettled) {
      return (
        <div className={`flex items-center gap-2 p-3.5 rounded-xl bg-gray-50 dark:bg-neutral-900/30 border border-gray-200 dark:border-neutral-700 ${className}`}>
          <Loader2 className="w-4 h-4 text-gray-400 animate-spin shrink-0" />
          <span className="text-xs font-medium text-muted">Checking Gmail connection…</span>
        </div>
      );
    }
    if (isConnected) {
      return (
        <div className={`flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-emerald-50 dark:bg-neutral-800 border border-emerald-200 dark:border-emerald-800 ${className}`}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center shrink-0 shadow-sm">
              <CheckCircle2 className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Connected Gmail</p>
              <SenderIdentity name={displayName} email={senderEmail} />
            </div>
          </div>
          <button
            onClick={disconnect}
            disabled={disconnecting}
            className="shrink-0 inline-flex items-center gap-1.5 text-[11px] font-medium text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 px-3 py-1.5 rounded-lg border border-transparent hover:border-red-200 dark:hover:border-red-800 transition-colors"
          >
            {disconnecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
            Disconnect
          </button>
        </div>
      );
    }
    return (
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 ${className}`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <XCircle className="w-4 h-4 text-amber-500 shrink-0" />
          <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
            Gmail not connected — connect to send emails and load your template
          </span>
        </div>
        <button onClick={connect} disabled={connecting} className="btn-primary text-[11px] px-3 py-1.5 shrink-0">
          {connecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Link2 className="w-3 h-3" /> Connect Gmail</>}
        </button>
      </motion.div>
    );
  }

  if (variant === 'header') {
    if (showChecking && !connectionsSettled) {
      return (
        <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-muted))] ${className}`}>
          <Loader2 className="w-3.5 h-3.5 text-muted animate-spin shrink-0" />
          <span className="text-[11px] font-medium text-muted whitespace-nowrap">Checking Gmail…</span>
        </div>
      );
    }
    if (isConnected) {
      return (
        <div className={`flex items-center gap-2 pl-2 pr-1.5 py-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 max-w-[min(14rem,42vw)] sm:max-w-[240px] lg:max-w-[280px] min-w-0 ${className}`}>
          <div className="w-7 h-7 rounded-md bg-emerald-500 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-[9px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Connected Gmail</p>
            {displayName && <p className="text-[11px] font-semibold text-[rgb(var(--text-primary))] truncate">{displayName}</p>}
            {senderEmail && <p className="text-[10px] text-muted truncate font-mono">{senderEmail}</p>}
          </div>
          <button
            type="button"
            onClick={disconnect}
            disabled={disconnecting}
            title="Disconnect Gmail"
            className="p-1.5 rounded-md text-red-500 hover:bg-red-500/10 transition-colors shrink-0"
          >
            {disconnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
          </button>
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={connect}
        disabled={connecting}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300 hover:bg-amber-500/15 transition-colors whitespace-nowrap ${className}`}
      >
        {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
        Connect Gmail
      </button>
    );
  }

  if (variant === 'compact') {
    if (showChecking && !isConnected) {
      return (
        <button type="button" onClick={connect} disabled={connecting} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border bg-gray-50/80 dark:bg-neutral-900 border-gray-200 dark:border-neutral-700 text-muted hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors ${className}`}>
          {connecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />} Gmail
        </button>
      );
    }
    if (!isConnected) {
      return (
        <button type="button" onClick={connect} disabled={connecting} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border bg-red-50/80 dark:bg-neutral-800 border-red-200/80 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/20 transition-colors ${className}`}>
          {connecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
          Connect Gmail
        </button>
      );
    }
    return (
      <div
        title={senderEmail ? `${displayName} · ${senderEmail}` : displayName}
        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border bg-emerald-50/80 dark:bg-neutral-800 border-emerald-200/80 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 max-w-[min(9rem,32vw)] md:max-w-[180px] lg:max-w-[220px] min-w-0 ${className}`}
      >
        <CheckCircle2 className="w-3 h-3 shrink-0" />
        <div className="min-w-0 leading-tight">
          {displayName && <span className="block font-semibold truncate">{displayName}</span>}
          {senderEmail && <span className="block text-[10px] opacity-80 truncate font-mono">{senderEmail}</span>}
        </div>
      </div>
    );
  }

  // card (Settings)
  if (showChecking && !connectionsSettled) {
    return (
      <div className={`overflow-hidden rounded-2xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-sm ${className}`}>
        <div className="px-5 py-4 border-b border-gray-100 dark:border-neutral-800 bg-gradient-to-r from-slate-50 to-gray-50 dark:from-neutral-900 dark:to-neutral-900">
          <div className="flex items-center gap-3">
            <GmailMark />
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100">Gmail Connection</h3>
              <p className="text-[11px] text-muted mt-0.5">Checking your account…</p>
            </div>
            <Loader2 className="w-5 h-5 text-gray-400 animate-spin shrink-0" />
          </div>
        </div>
        <div className="p-5 space-y-3 animate-pulse">
          <div className="h-16 rounded-xl bg-gray-100 dark:bg-neutral-800" />
          <div className="flex gap-2">
            <div className="h-7 flex-1 rounded-lg bg-gray-100 dark:bg-neutral-800" />
            <div className="h-7 flex-1 rounded-lg bg-gray-100 dark:bg-neutral-800" />
            <div className="h-7 flex-1 rounded-lg bg-gray-100 dark:bg-neutral-800" />
          </div>
        </div>
      </div>
    );
  }

  if (isConnected) {
    const avatarInitials = initialsFromIdentity(displayName, senderEmail);
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className={`overflow-hidden rounded-2xl border border-emerald-200/70 dark:border-emerald-900/50 bg-white dark:bg-neutral-900 shadow-sm ${className}`}
      >
        <div className="px-5 py-4 border-b border-emerald-100/80 dark:border-emerald-900/30 bg-gradient-to-r from-emerald-50/90 via-teal-50/50 to-white dark:from-emerald-950/40 dark:via-neutral-900 dark:to-neutral-900">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <GmailMark connected />
              <div className="min-w-0">
                <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100">Gmail Connection</h3>
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5 font-medium">Ready to send outreach</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Connected
            </span>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-4 p-4 rounded-xl bg-gray-50/80 dark:bg-neutral-800/50 border border-gray-100 dark:border-neutral-700">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white text-sm font-bold shrink-0 shadow-md">
              {avatarInitials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{displayName || 'Gmail account'}</p>
              <p className="text-xs text-muted truncate font-mono mt-0.5">{senderEmail}</p>
              <div className="flex items-center gap-1.5 mt-2 text-[10px] text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3 h-3 shrink-0" />
                <span>OAuth authorized · emails send from this address</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {GMAIL_FEATURES.map(({ label, icon: Icon }) => (
              <div
                key={label}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white dark:bg-neutral-900 border border-gray-100 dark:border-neutral-700 text-[11px] font-medium text-gray-600 dark:text-gray-300"
              >
                <Icon className="w-3.5 h-3.5 text-brand-500 shrink-0" />
                <span>{label}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1 border-t border-gray-100 dark:border-neutral-800">
            <p className="text-[10px] text-muted">Switch accounts anytime by disconnecting and reconnecting.</p>
            <button
              type="button"
              onClick={disconnect}
              disabled={disconnecting}
              className="inline-flex items-center justify-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 px-4 py-2 rounded-xl border border-red-200/80 dark:border-red-900/40 transition-colors shrink-0"
            >
              {disconnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
              Disconnect Gmail
            </button>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`overflow-hidden rounded-2xl border border-amber-200/60 dark:border-amber-900/40 bg-white dark:bg-neutral-900 shadow-sm ${className}`}
    >
      <div className="px-5 py-4 border-b border-amber-100/80 dark:border-amber-900/30 bg-gradient-to-r from-amber-50/80 via-orange-50/30 to-white dark:from-amber-950/30 dark:via-neutral-900 dark:to-neutral-900">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <GmailMark />
            <div className="min-w-0">
              <h3 className="font-semibold text-sm text-gray-900 dark:text-gray-100">Gmail Connection</h3>
              <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5 font-medium">Required before you can send</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 shrink-0">
            Not connected
          </span>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div className="rounded-xl border border-dashed border-amber-200 dark:border-amber-900/50 bg-amber-50/30 dark:bg-amber-950/10 p-5 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 flex items-center justify-center shadow-sm mb-3">
            <Mail className="w-7 h-7 text-amber-500" />
          </div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Connect your Gmail account</p>
          <p className="text-[11px] text-muted mt-1 max-w-sm mx-auto leading-relaxed">
            Authorize once with Google OAuth. Your credentials stay secure — we never store your password.
          </p>
        </div>

        <ul className="space-y-2">
          {GMAIL_FEATURES.map(({ label, icon: Icon }) => (
            <li key={label} className="flex items-center gap-2.5 text-xs text-gray-600 dark:text-gray-300">
              <span className="w-6 h-6 rounded-lg bg-brand-50 dark:bg-brand-900/20 flex items-center justify-center shrink-0">
                <Icon className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
              </span>
              {label}
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={connect}
          disabled={connecting}
          className="w-full btn-primary text-sm py-3 rounded-xl shadow-md hover:shadow-lg"
        >
          {connecting ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Connecting…</>
          ) : (
            <><Link2 className="w-4 h-4" /> Connect with Google</>
          )}
        </button>
      </div>
    </motion.div>
  );
}
