import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calendar, Clock, Send, Loader2, CheckCircle2, Edit3, Eye, Trash2,
  Globe, Mail, Users, Play, X, Save, AlertTriangle, ChevronDown, ChevronUp,
  Upload, FileText, Download, Plus,
} from 'lucide-react';
import { get, post, put, del } from '../api.js';
import { useSession } from '../context/SessionContext.jsx';
import { useEventStream } from '../core/EventStreamProvider.jsx';
import { useToast } from '../components/Toast.jsx';
import GmailComposeChrome from '../components/GmailComposeChrome.jsx';
import LiveFeed from '../components/LiveFeed.jsx';
import RosterPanel from '../components/RosterPanel.jsx';
import BatchScrapeProgress from '../components/BatchScrapeProgress.jsx';

function DraftCard({ draft, onEdit, onApprove, onPreview }) {
  const statusColors = {
    draft: 'bg-amber-50 text-amber-700 border-amber-200',
    approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    sent: 'bg-blue-50 text-blue-700 border-blue-200',
    failed: 'bg-red-50 text-red-700 border-red-200',
    cancelled: 'bg-gray-50 text-gray-500 border-gray-200',
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-900 dark:text-white truncate">{draft.professor_email}</span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold ${statusColors[draft.status] || statusColors.draft}`}>
            {draft.status}
          </span>
          {draft.edited_by_user ? <span className="text-[9px] text-violet-500 font-medium">edited</span> : null}
        </div>
        <p className="text-[11px] text-gray-500 truncate mt-0.5">{draft.subject || 'No subject yet'}</p>
        {draft.interest_line && <p className="text-[10px] text-muted truncate">{draft.interest_line}</p>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {draft.status === 'draft' && (
          <>
            <button onClick={() => onEdit(draft)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700" title="Edit">
              <Edit3 className="w-3.5 h-3.5 text-gray-500" />
            </button>
            <button onClick={() => onApprove(draft.id)} className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20" title="Approve">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            </button>
          </>
        )}
        <button onClick={() => onPreview(draft)} className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20" title="Preview">
          <Eye className="w-3.5 h-3.5 text-blue-600" />
        </button>
      </div>
    </div>
  );
}

function DraftEditor({ draft, onSave, onClose, template }) {
  const [subject, setSubject] = useState(draft.subject || '');
  const [interestLine, setInterestLine] = useState(draft.interest_line || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await put(`/scheduled/draft/${draft.id}`, { subject, interest_line: interestLine });
      onSave();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  // Build preview
  const buildPreview = () => {
    if (!template?.raw_html) return '<em>No template loaded</em>';
    return template.raw_html
      .replace(/\{\{LAST_NAME\}\}/g, draft.last_name || '')
      .replace(/\{\{INTEREST_LINE\}\}/g, interestLine || '');
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-4xl border border-gray-200 dark:border-gray-700 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h3 className="font-semibold text-sm">Edit Draft — {draft.professor_email}</h3>
            <p className="text-[10px] text-muted mt-0.5">{draft.university} · {draft.research_areas}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-auto p-5">
          <div className="grid grid-cols-2 gap-5">
            {/* Left: Edit form */}
            <div className="space-y-4">
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Subject</label>
                <input
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/30 focus:border-[#1a73e8]"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1 block">Interest Line</label>
                <textarea
                  value={interestLine}
                  onChange={e => setInterestLine(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-[#1a73e8]/30 focus:border-[#1a73e8] resize-none"
                />
              </div>
              <div className="pt-2 text-[10px] text-gray-500 space-y-1">
                <p><strong>Template follows:</strong> Only these 2 fields change per email</p>
                <p>Body, formatting, signature stay identical to your template</p>
              </div>
            </div>

            {/* Right: Live preview */}
            <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
              <div className="bg-gray-50 dark:bg-gray-800 px-3 py-2 border-b border-gray-200 dark:border-gray-700">
                <p className="text-[10px] font-semibold text-gray-500 uppercase">Live Preview</p>
              </div>
              <iframe
                title="Live preview"
                srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:16px;font-family:'Roboto',Arial,sans-serif;font-size:14px;line-height:1.6;color:#222;}</style></head><body>${buildPreview()}</body></html>`}
                className="w-full h-[400px] border-0 bg-white dark:bg-gray-900"
                sandbox="allow-same-origin"
              />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-800">
          <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary text-xs px-4 py-2 flex items-center gap-1.5">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save Changes
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function PreviewModal({ draft, onClose }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl border border-gray-200 dark:border-gray-700 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h3 className="font-semibold text-sm">Preview — {draft.professor_email}</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">{draft.subject}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-auto p-0">
          <iframe
            title="Email preview"
            srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:20px;font-family:'Roboto',Arial,sans-serif;font-size:14px;line-height:1.6;color:#222;}</style></head><body>${draft.html_preview || '<em>No preview available</em>'}</body></html>`}
            className="w-full h-[500px] border-0"
            sandbox="allow-same-origin"
          />
        </div>
      </div>
    </motion.div>
  );
}

function BatchCard({ batch, onExpand, expanded, onApproveAll, onSendNow, onCancel, onDownloadRoster }) {
  const statusIcons = {
    pending: <Clock className="w-4 h-4 text-amber-500" />,
    processing: <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />,
    completed: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
    cancelled: <X className="w-4 h-4 text-gray-400" />,
  };

  const scheduledDate = new Date(batch.scheduled_at);
  const isPast = scheduledDate <= new Date();

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-900">
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/30" onClick={() => onExpand(batch.id)}>
        {statusIcons[batch.status] || statusIcons.pending}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold">{batch.draft_count || batch.total} professors</span>
            <span className="text-[10px] text-muted">
              {scheduledDate.toLocaleDateString()} {scheduledDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            {isPast && batch.status === 'pending' && <span className="text-[9px] text-red-500 font-medium">overdue</span>}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-500">
            <span>{batch.approved_count || 0} approved</span>
            <span>{batch.sent_count || 0} sent</span>
            {batch.source_url && <span className="truncate max-w-[200px]">{batch.source_url}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {batch.status === 'pending' && (
            <>
              <button onClick={e => { e.stopPropagation(); onDownloadRoster(batch.id); }} className="text-[10px] px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium flex items-center gap-1" title="Download roster">
                <Download className="w-3 h-3" />Excel
              </button>
              <button onClick={e => { e.stopPropagation(); onApproveAll(batch.id); }} className="text-[10px] px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-medium" title="Approve all drafts">
                Approve All
              </button>
              <button onClick={e => { e.stopPropagation(); onSendNow(batch.id); }} className="text-[10px] px-2.5 py-1 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 font-medium" title="Send now">
                <Send className="w-3 h-3 inline mr-1" />Send
              </button>
              <button onClick={e => { e.stopPropagation(); onCancel(batch.id); }} className="p-1.5 rounded-lg hover:bg-red-50" title="Cancel batch">
                <Trash2 className="w-3.5 h-3.5 text-red-500" />
              </button>
            </>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>
    </div>
  );
}

export default function Scheduled() {
  const { template, settings } = useSession();
  const { subscribe } = useEventStream();
  const toast = useToast();

  const [batches, setBatches] = useState([]);
  const [expandedBatch, setExpandedBatch] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [roster, setRoster] = useState([]);
  const [events, setEvents] = useState([]);

  // Input state
  const [urlInput, setUrlInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [mode, setMode] = useState('url');
  const [creating, setCreating] = useState(false);

  // Modals
  const [editingDraft, setEditingDraft] = useState(null);
  const [previewDraft, setPreviewDraft] = useState(null);

  // Progress
  const [batchProgress, setBatchProgress] = useState(null);

  const loadBatches = useCallback(async () => {
    try {
      const data = await get('/scheduled/batches');
      setBatches(data);
    } catch (e) {
      toast.error('Failed to load batches: ' + e.message);
    }
  }, [toast]);

  const loadDrafts = useCallback(async (batchId) => {
    try {
      const data = await get(`/scheduled/batch/${batchId}/drafts`);
      setDrafts(data);
    } catch (e) {
      toast.error('Failed to load drafts: ' + e.message);
    }
  }, [toast]);

  useEffect(() => { loadBatches(); }, [loadBatches]);

  useEffect(() => {
    if (expandedBatch) loadDrafts(expandedBatch);
  }, [expandedBatch, loadDrafts]);

  // SSE events
  useEffect(() => {
    if (!subscribe) return;
    return subscribe((data) => {
      setEvents(prev => [{ ...data, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 50));

      if (data.type === 'scheduled_draft_ready') {
        setBatchProgress(data);
        if (data.batchId === expandedBatch) loadDrafts(expandedBatch);
        toast.success(`Draft ready for ${data.professorEmail}`);
      }
      if (data.type === 'scheduled_batch_progress') {
        setBatchProgress(data);
      }
      if (data.type === 'scheduled_batch_complete') {
        setBatchProgress(null);
        loadBatches();
        if (expandedBatch) loadDrafts(expandedBatch);
        toast.success(`Batch complete: ${data.sent}/${data.total} drafts created`);
      }
      if (data.type === 'scheduled_batch_error') {
        setBatchProgress(null);
        toast.error(`Batch error: ${data.error}`);
      }
      if (data.type === 'scheduled_draft_sent') {
        if (data.batchId === expandedBatch) loadDrafts(expandedBatch);
        loadBatches();
        toast.success(`Sent to ${data.professor}`);
      }
      if (data.type === 'scheduled_draft_failed') {
        toast.error(`Failed to send: ${data.error}`);
      }
    });
  }, [subscribe, expandedBatch, loadBatches, loadDrafts, toast]);

  const handleCreate = async () => {
    if (!scheduledAt) return toast.warning('Please select a date and time');
    if (mode === 'url' && !urlInput.trim()) return toast.warning('Please enter a URL');
    if (mode === 'emails' && !emailInput.trim()) return toast.warning('Please enter emails');

    setCreating(true);
    try {
      const body = {
        scheduled_at: new Date(scheduledAt).toISOString(),
        ...(mode === 'url' ? { url: urlInput.trim() } : { emails: emailInput.trim() }),
      };
      const res = await post('/scheduled/batch', body);
      setUrlInput('');
      setEmailInput('');
      setScheduledAt('');
      setExpandedBatch(res.batchId);
      loadBatches();
      toast.success('Batch created! Agent is researching professors...');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleApproveAll = async (batchId) => {
    try {
      await post(`/scheduled/batch/${batchId}/approve-all`);
      if (expandedBatch === batchId) loadDrafts(batchId);
      loadBatches();
      toast.success('All drafts approved');
    } catch (e) {
      toast.error(e.message);
    }
  };

  const handleSendNow = async (batchId) => {
    if (!confirm('Send all approved drafts now?')) return;
    try {
      await post(`/scheduled/batch/${batchId}/send-now`);
      loadBatches();
      toast.info('Sending approved drafts...');
    } catch (e) {
      toast.error(e.message);
    }
  };

  const handleCancel = async (batchId) => {
    if (!confirm('Cancel this batch?')) return;
    try {
      await del(`/scheduled/batch/${batchId}`);
      if (expandedBatch === batchId) { setExpandedBatch(null); setDrafts([]); }
      loadBatches();
      toast.success('Batch cancelled');
    } catch (e) {
      toast.error(e.message);
    }
  };

  const handleApproveDraft = async (draftId) => {
    try {
      await post(`/scheduled/draft/${draftId}/approve`);
      if (expandedBatch) loadDrafts(expandedBatch);
      loadBatches();
      toast.success('Draft approved');
    } catch (e) {
      toast.error(e.message);
    }
  };

  const handleDownloadRoster = (batchId) => {
    // Generate roster for this batch - for now just open the global roster
    window.open('/api/roster.xlsx', '_blank');
    toast.info('Downloading roster for this batch...');
  };

  // Default time: tomorrow same time
  const getDefaultTime = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setMinutes(0, 0, 0);
    return d.toISOString().slice(0, 16);
  };

  return (
    <div className="max-w-[1600px] mx-auto p-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Batch creation + list */}
        <div className="lg:col-span-2 space-y-6">
          {/* Create Batch */}
          <div className="rounded-2xl border border-violet-200 dark:border-violet-800/50 bg-gradient-to-br from-violet-50/80 to-white dark:from-violet-950/20 dark:to-gray-900 p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 rounded-xl bg-violet-500 flex items-center justify-center shadow-md">
                <Plus className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="font-semibold text-sm">New Scheduled Batch</h2>
                <p className="text-[11px] text-gray-500">Agent researches → drafts → auto-sends at scheduled time</p>
              </div>
            </div>

            <div className="space-y-4">
              {/* Mode toggle */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMode('url')}
                  className={`flex-1 text-xs px-3 py-2.5 rounded-lg font-medium transition-all ${mode === 'url' ? 'bg-violet-600 text-white shadow-md' : 'bg-white dark:bg-gray-800 text-gray-600 border border-gray-200 dark:border-gray-700'}`}
                >
                  <Globe className="w-3.5 h-3.5 inline mr-1.5" />Faculty URL
                </button>
                <button
                  onClick={() => setMode('emails')}
                  className={`flex-1 text-xs px-3 py-2.5 rounded-lg font-medium transition-all ${mode === 'emails' ? 'bg-violet-600 text-white shadow-md' : 'bg-white dark:bg-gray-800 text-gray-600 border border-gray-200 dark:border-gray-700'}`}
                >
                  <Mail className="w-3.5 h-3.5 inline mr-1.5" />Email List
                </button>
                <button
                  onClick={() => setMode('upload')}
                  className={`flex-1 text-xs px-3 py-2.5 rounded-lg font-medium transition-all ${mode === 'upload' ? 'bg-violet-600 text-white shadow-md' : 'bg-white dark:bg-gray-800 text-gray-600 border border-gray-200 dark:border-gray-700'}`}
                >
                  <Upload className="w-3.5 h-3.5 inline mr-1.5" />Upload File
                </button>
              </div>

              {/* Input area */}
              {mode === 'url' && (
                <input
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  placeholder="https://university.edu/faculty"
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
                />
              )}
              {mode === 'emails' && (
                <textarea
                  value={emailInput}
                  onChange={e => setEmailInput(e.target.value)}
                  placeholder="prof1@uni.edu, prof2@uni.edu..."
                  rows={3}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 resize-none"
                />
              )}
              {mode === 'upload' && (
                <label className="flex items-center justify-center gap-2 w-full px-3 py-8 text-sm border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 hover:border-violet-400 cursor-pointer transition-colors">
                  <Upload className="w-5 h-5 text-gray-400" />
                  <span className="text-gray-500">Click to upload CSV/Excel file</span>
                  <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={() => toast.info('File upload coming soon')} />
                </label>
              )}

              {/* Date/time picker */}
              <div>
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2 block flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />Send Date & Time
                </label>
                <input
                  type="datetime-local"
                  value={scheduledAt || getDefaultTime()}
                  onChange={e => setScheduledAt(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500"
                />
              </div>

              <button
                onClick={handleCreate}
                disabled={creating}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold shadow-md shadow-violet-500/20 transition-colors disabled:opacity-50"
              >
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Schedule Batch
              </button>
            </div>
          </div>

          {/* Progress */}
          {batchProgress && (
            <BatchScrapeProgress progress={batchProgress} onStop={async () => { await post('/scrape/cancel'); setBatchProgress(null); }} />
          )}

          {/* Batch list */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Users className="w-4 h-4 text-violet-500" /> Scheduled Batches
              <span className="text-[10px] text-muted font-normal">{batches.length} total</span>
            </h3>

            {batches.length === 0 && !batchProgress && (
              <div className="text-center py-12 text-gray-400 card">
                <Calendar className="w-10 h-10 mx-auto mb-2 text-gray-200" />
                <p className="text-xs">No scheduled batches yet</p>
              </div>
            )}

            {batches.map(batch => (
              <div key={batch.id}>
                <BatchCard
                  batch={batch}
                  expanded={expandedBatch === batch.id}
                  onExpand={id => setExpandedBatch(expandedBatch === id ? null : id)}
                  onApproveAll={handleApproveAll}
                  onSendNow={handleSendNow}
                  onCancel={handleCancel}
                  onDownloadRoster={handleDownloadRoster}
                />
                <AnimatePresence>
                  {expandedBatch === batch.id && drafts.length > 0 && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                      <div className="border border-t-0 border-gray-200 dark:border-gray-700 rounded-b-xl bg-white dark:bg-gray-900 max-h-[400px] overflow-auto">
                        {drafts.map(d => (
                          <DraftCard
                            key={d.id}
                            draft={d}
                            onEdit={setEditingDraft}
                            onApprove={handleApproveDraft}
                            onPreview={setPreviewDraft}
                          />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </div>

        {/* Right column: Template + Activity */}
        <div className="space-y-6">
          <div className="sticky top-20">
            <GmailComposeChrome
              template={template}
              onSaveInstructions={() => {}}
              onDetect={() => {}}
              sentEmails={[]}
              onPickSent={() => {}}
              onPickLatest={() => {}}
              settings={settings}
            />

            <div className="mt-6">
              <LiveFeed events={events} connected={true} />
            </div>

            {roster.length > 0 && (
              <div className="mt-6">
                <RosterPanel rows={roster} activeEmail={null} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {editingDraft && (
        <DraftEditor
          draft={editingDraft}
          template={template}
          onSave={() => { setEditingDraft(null); if (expandedBatch) loadDrafts(expandedBatch); }}
          onClose={() => setEditingDraft(null)}
        />
      )}
      {previewDraft && (
        <PreviewModal draft={previewDraft} onClose={() => setPreviewDraft(null)} />
      )}
    </div>
  );
}
