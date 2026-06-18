import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Zap, Clock, Activity, TrendingUp, Mail, CheckCircle2, ArrowRight, Minimize2, BarChart3,
  Users, ShieldCheck, AlertTriangle, Database,
} from 'lucide-react';
import { get, put } from '../api.js';
import { useSession } from '../context/SessionContext.jsx';
import PageLayout from '../components/layout/PageLayout.jsx';
import ModeWizard from '../components/ModeWizard.jsx';
import CampaignPresets from '../components/CampaignPresets.jsx';

const MODE_CARDS = [
  {
    path: '/instant',
    title: 'Instant',
    desc: 'Full research, subject keyword, and interest line. Send as soon as drafts are ready.',
    icon: Zap,
    accent: 'brand',
    badge: 'Full',
  },
  {
    path: '/basic-instant',
    title: 'Basic Instant',
    desc: 'Fast outreach with last-name personalization only. Best for high-volume lists.',
    icon: Minimize2,
    accent: 'teal',
    badge: 'Basic',
  },
  {
    path: '/scheduled',
    title: 'Scheduled',
    desc: 'Prepare batches in advance and deliver at professor-friendly times.',
    icon: Clock,
    accent: 'violet',
    badge: 'Plan',
  },
];

const accentStyles = {
  brand: {
    icon: 'bg-brand-500/15 text-brand-600 dark:text-brand-400',
    hover: 'hover:border-brand-500/40',
    link: 'text-brand-600 dark:text-brand-400',
  },
  teal: {
    icon: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
    hover: 'hover:border-teal-500/40',
    link: 'text-teal-600 dark:text-teal-400',
  },
  violet: {
    icon: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
    hover: 'hover:border-violet-500/40',
    link: 'text-violet-600 dark:text-violet-400',
  },
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { auth } = useSession();
  const isAdmin = auth?.isAdmin || auth?.role === 'admin';
  const [adminData, setAdminData] = useState(null);
  const [adminUpdating, setAdminUpdating] = useState(null);
  const [stats, setStats] = useState({
    todaySent: 0,
    weekSent: 0,
    totalSent: 0,
    queueSize: 0,
    scheduledBatches: 0,
  });

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      setAdminData(null);
      return undefined;
    }
    const loadAdmin = () => get('/admin/dashboard').then(setAdminData).catch(() => {});
    loadAdmin();
    const interval = setInterval(loadAdmin, 10000);
    return () => clearInterval(interval);
  }, [isAdmin]);

  const updateUserStatus = async (user) => {
    const nextStatus = user.status === 'blocked' ? 'active' : 'blocked';
    setAdminUpdating(user.email);
    try {
      await put(`/admin/users/${encodeURIComponent(user.email)}/status`, {
        status: nextStatus,
        reason: nextStatus === 'blocked' ? 'Blocked from admin dashboard' : null,
      });
      setAdminData(await get('/admin/dashboard'));
    } finally {
      setAdminUpdating(null);
    }
  };

  const toggleUserFeature = async (user, feature) => {
    const current = user.entitlements?.features?.[feature] !== false;
    setAdminUpdating(`${user.email}:${feature}`);
    try {
      await put(`/admin/users/${encodeURIComponent(user.email)}/controls`, {
        features: { ...(user.entitlements?.features || {}), [feature]: !current },
      });
      setAdminData(await get('/admin/dashboard'));
    } finally {
      setAdminUpdating(null);
    }
  };

  const loadStats = async () => {
    try {
      const res = await get('/stats');
      setStats({
        todaySent: res.todaySent || 0,
        weekSent: res.weekSent || 0,
        totalSent: res.totalSent || 0,
        queueSize: res.queueSize || 0,
        scheduledBatches: res.scheduledBatches || 0,
      });
    } catch {
      /* keep last stats */
    }
  };

  const statCards = [
    { label: 'Today', value: stats.todaySent, sub: 'Emails sent', icon: Mail, color: 'text-brand-500' },
    { label: 'This week', value: stats.weekSent, sub: 'Emails sent', icon: TrendingUp, color: 'text-emerald-500' },
    { label: 'All time', value: stats.totalSent, sub: 'Total sent', icon: CheckCircle2, color: 'text-emerald-600' },
    { label: 'Queue', value: stats.queueSize, sub: 'Pending', icon: Activity, color: 'text-amber-500' },
    { label: 'Scheduled', value: stats.scheduledBatches, sub: 'Batches', icon: Clock, color: 'text-violet-500' },
  ];

  return (
    <PageLayout
      title={isAdmin ? 'Admin Dashboard' : 'User Dashboard'}
      subtitle={isAdmin
        ? 'Manage your outreach and monitor real-time activity across isolated user accounts.'
        : 'Your private outreach workspace, analytics, batches, and email history.'}
      badge={(
        <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full ${
          isAdmin
            ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300'
            : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
        }`}>
          {isAdmin ? 'Admin' : 'User'}
        </span>
      )}
    >
      <section className="panel">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-brand-500" />
            <span className="text-sm font-bold text-[rgb(var(--text-primary))]">Overview</span>
          </div>
        </div>
        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {statCards.map(({ label, value, sub, icon: Icon, color }) => (
            <div key={label} className="rounded-xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-muted))]/40 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="zone-label">{label}</span>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <div className="text-2xl font-bold tabular-nums text-[rgb(var(--text-primary))]">{value}</div>
              <div className="text-[10px] text-muted mt-1">{sub}</div>
            </div>
          ))}
        </div>
      </section>

      {isAdmin && (
        <AdminUsersPanel
          data={adminData}
          updating={adminUpdating}
          onStatusChange={updateUserStatus}
          onFeatureToggle={toggleUserFeature}
        />
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-bold text-[rgb(var(--text-primary))]">Launch a workflow</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {MODE_CARDS.map(({ path, title, desc, icon: Icon, accent, badge }) => {
            const styles = accentStyles[accent];
            return (
              <motion.button
                key={path}
                type="button"
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.99 }}
                onClick={() => navigate(path)}
                className={`panel p-5 text-left transition-all border-2 border-transparent ${styles.hover}`}
              >
                <div className="flex items-start gap-4">
                  <div className={`p-3 rounded-xl shrink-0 ${styles.icon}`}>
                    <Icon className="w-7 h-7" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-base font-semibold text-[rgb(var(--text-primary))]">{title}</h3>
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[rgb(var(--surface-muted))] text-muted">
                        {badge}
                      </span>
                    </div>
                    <p className="text-sm text-muted leading-relaxed mb-3">{desc}</p>
                    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${styles.link}`}>
                      Open <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      </section>

      <ModeWizard />
      <CampaignPresets />
    </PageLayout>
  );
}

function AdminUsersPanel({ data, updating, onStatusChange, onFeatureToggle }) {
  const totals = data?.totals || {};
  const users = data?.users || [];
  const cards = [
    { label: 'Accounts', value: totals.accounts || 0, icon: Users, color: 'text-brand-500' },
    { label: 'Users', value: totals.users || 0, icon: ShieldCheck, color: 'text-emerald-500' },
    { label: 'All sent', value: totals.sent || 0, icon: Mail, color: 'text-blue-500' },
    { label: 'Today sent', value: totals.todaySent || 0, icon: TrendingUp, color: 'text-teal-500' },
    { label: 'Active batches', value: totals.activeBatches || 0, icon: Clock, color: 'text-violet-500' },
    { label: 'Open failures', value: totals.failures || 0, icon: AlertTriangle, color: 'text-red-500' },
  ];

  return (
    <section className="panel">
      <div className="panel-header">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-brand-500" />
          <div>
            <h2 className="text-sm font-bold text-[rgb(var(--text-primary))]">User administration</h2>
            <p className="text-[10px] text-muted">Read-only account activity across isolated user databases</p>
          </div>
        </div>
        <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-brand-500/15 text-brand-700 dark:text-brand-300">
          Admin only
        </span>
      </div>

      <div className="p-4 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {cards.map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="rounded-lg border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-muted))]/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="zone-label">{label}</span>
                <Icon className={`w-4 h-4 ${color}`} />
              </div>
              <p className="text-xl font-bold tabular-nums mt-2 text-[rgb(var(--text-primary))]">{value}</p>
            </div>
          ))}
        </div>

        <div className="overflow-auto max-h-[420px] border border-[rgb(var(--border-subtle))] rounded-lg">
          <table className="w-full min-w-[1120px] text-[11px]">
            <thead className="sticky top-0 z-10 bg-[rgb(var(--surface-muted))] text-muted">
              <tr className="text-left">
                <th className="px-3 py-2 font-semibold">Account</th>
                <th className="px-3 py-2 font-semibold">Role</th>
                <th className="px-3 py-2 font-semibold text-right">Sent</th>
                <th className="px-3 py-2 font-semibold text-right">Today</th>
                <th className="px-3 py-2 font-semibold text-right">Contacts</th>
                <th className="px-3 py-2 font-semibold text-right">Queue</th>
                <th className="px-3 py-2 font-semibold text-right">Batches</th>
                <th className="px-3 py-2 font-semibold text-right">Replies</th>
                <th className="px-3 py-2 font-semibold text-right">Failures</th>
                <th className="px-3 py-2 font-semibold">Setup</th>
                <th className="px-3 py-2 font-semibold">Last activity</th>
                <th className="px-3 py-2 font-semibold">Last login</th>
                <th className="px-3 py-2 font-semibold text-right">Controls</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.email} className="border-t border-[rgb(var(--border-subtle))]">
                  <td className="px-3 py-2">
                    <p className="font-semibold text-[rgb(var(--text-primary))]">{user.display_name || user.email}</p>
                    <p className="text-[10px] text-muted font-mono">{user.email}</p>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-1 rounded-full text-[9px] font-bold uppercase ${user.role === 'admin' ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300' : 'bg-gray-500/10 text-muted'}`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{user.total_sent || 0}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{user.today_sent || 0}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{user.unique_contacts || 0}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{user.queue_items || 0}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{user.active_batches || 0}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{user.replies || 0}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{user.failures || 0}</td>
                  <td className="px-3 py-2 text-muted">{user.has_resume ? 'Resume' : 'No resume'} · {user.has_custom_api ? 'Custom API' : 'Default API'}</td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">
                    {user.last_sent_at
                      ? `Sent ${new Date(user.last_sent_at).toLocaleString()}`
                      : user.last_batch_at
                        ? `${user.last_batch_status || 'Batch'} ${new Date(user.last_batch_at).toLocaleString()}`
                        : 'No outreach yet'}
                  </td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">{user.last_login_at ? new Date(user.last_login_at).toLocaleString() : '-'}</td>
                  <td className="px-3 py-2">
                    {user.role === 'admin' ? (
                      <span className="block text-right text-[10px] text-muted">Protected</span>
                    ) : (
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onFeatureToggle(user, 'scheduled')}
                          disabled={!!updating}
                          className={`px-2 py-1 rounded border text-[9px] font-semibold ${
                            user.entitlements?.features?.scheduled === false
                              ? 'border-gray-300 text-muted'
                              : 'border-emerald-300 text-emerald-700 dark:text-emerald-400'
                          }`}
                        >
                          Scheduled
                        </button>
                        <button
                          type="button"
                          onClick={() => onFeatureToggle(user, 'webResearch')}
                          disabled={!!updating}
                          className={`px-2 py-1 rounded border text-[9px] font-semibold ${
                            user.entitlements?.features?.webResearch === false
                              ? 'border-gray-300 text-muted'
                              : 'border-blue-300 text-blue-700 dark:text-blue-400'
                          }`}
                        >
                          Web AI
                        </button>
                        <button
                          type="button"
                          onClick={() => onStatusChange(user)}
                          disabled={!!updating}
                          className={`px-2 py-1 rounded border text-[9px] font-semibold ${
                            user.status === 'blocked'
                              ? 'border-emerald-300 text-emerald-700 dark:text-emerald-400'
                              : 'border-red-300 text-red-700 dark:text-red-400'
                          }`}
                        >
                          {updating === user.email ? 'Saving...' : user.status === 'blocked' ? 'Activate' : 'Block'}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {!users.length && (
                <tr><td colSpan="13" className="px-3 py-8 text-center text-muted">No registered accounts yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
