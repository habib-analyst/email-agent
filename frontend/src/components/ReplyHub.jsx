import React, { useState, useRef, useCallback } from 'react';
import {
  MessageSquare, ThumbsUp, ThumbsDown, Minus, Send, Trash2,
  Edit3, Paperclip, Loader2, X, Sparkles,
} from 'lucide-react';
import { post, put, del } from '../api.js';
import { useToast } from './Toast.jsx';

const CLASSIFICATION_COLORS = {
  positive: 'bg-emerald-100 text-emerald-700 dark:bg-neutral-800 dark:text-emerald-400',
  negative: 'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400',
  neutral: 'bg-gray-100 text-gray-700 dark:bg-neutral-900/20 dark:text-gray-400',
  auto_reply: 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
};

const CLASSIFICATION_ICONS = {
  positive: ThumbsUp,
  negative: ThumbsDown,
  neutral: Minus,
  auto_reply: MessageSquare,
};

function Badge({ cls, children }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold ${CLASSIFICATION_COLORS[cls] || CLASSIFICATION_COLORS.neutral}`}>
      {children}
    </span>
  );
}

function formatTimestamp(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return ts; }
}

function formatDuration(ms) {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export default function ReplyHub({ replies, onRefresh, embedded = false }) {
  const toast = useToast();
  const [expandedId, setExpandedId] = useState(null);
  const [suggestingId, setSuggestingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [sendingId, setSendingId] = useState(null);

  // Compose popup state
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeReply, setComposeReply] = useState(null);
  const [composeSubject, setComposeSubject] = useState('');
  const [composeHtml, setComposeHtml] = useState('');
  const [composeFile, setComposeFile] = useState(null);
  const [composeSending, setComposeSending] = useState(false);
  const [composeDrafting, setComposeDrafting] = useState(false);
  const editRef = useRef(null);

  const toggleExpand = useCallback((id) => {
    setExpandedId(prev => prev === id ? null : id);
  }, []);

  const handleSuggest = useCallback(async (id) => {
    setSuggestingId(id);
    try {
      const res = await post(`/replies/${id}/suggest`);
      onRefresh?.();
    } catch (err) {
      toast.error(err.message || 'Could not generate suggestion');
    } finally {
      setSuggestingId(null);
    }
  }, [onRefresh, toast]);

  const handleDelete = useCallback(async (id) => {
    setDeletingId(id);
    try {
      await del(`/replies/${id}`);
      onRefresh?.();
    } catch (err) {
      toast.error(err.message || 'Could not delete reply');
    } finally {
      setDeletingId(null);
    }
  }, [onRefresh, toast]);

  const openCompose = useCallback((reply) => {
    setComposeReply(reply);
    setComposeSubject(reply.reply_subject || `Re: ${reply.original_subject || ''}`);
    setComposeHtml(reply.suggested_reply || '');
    setComposeFile(null);
    setComposeOpen(true);
    // Delay setting contentEditable innerHTML so the DOM node exists first
    setTimeout(() => {
      if (editRef.current) {
        editRef.current.innerHTML = reply.suggested_reply || '';
      }
    }, 0);
  }, []);

  const closeCompose = useCallback(() => {
    setComposeOpen(false);
    setComposeReply(null);
    setComposeSubject('');
    setComposeHtml('');
    setComposeFile(null);
  }, []);

  const handleSend = useCallback(async () => {
    if (!composeReply) return;
    const html = editRef.current?.innerHTML || composeHtml;
    setComposeSending(true);
    try {
      await post(`/replies/${composeReply.id}/send`, {
        html,
        subject: composeSubject,
        attachment_path: composeFile?.name || null,
      });
      onRefresh?.();
      closeCompose();
    } catch (err) {
      toast.error(err.message || 'Could not send reply');
    } finally {
      setComposeSending(false);
    }
  }, [composeReply, composeHtml, composeSubject, composeFile, onRefresh, closeCompose, toast]);

  const handleSaveDraft = useCallback(async () => {
    if (!composeReply) return;
    const html = editRef.current?.innerHTML || composeHtml;
    setComposeDrafting(true);
    try {
      await put(`/replies/${composeReply.id}/draft`, {
        suggested_reply: html,
        reply_subject: composeSubject,
      });
      onRefresh?.();
      closeCompose();
    } catch (err) {
      toast.error(err.message || 'Could not save draft');
    } finally {
      setComposeDrafting(false);
    }
  }, [composeReply, composeHtml, composeSubject, onRefresh, closeCompose, toast]);

  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) setComposeFile(file);
  }, []);

  if (!replies?.length) {
    return (
      <div className={embedded ? 'p-6 text-center' : 'space-y-3'}>
        {!embedded && (
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <MessageSquare className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-gray-900 dark:text-white">Reply Hub</h3>
              <p className="text-[10px] text-muted">No professor replies yet</p>
            </div>
          </div>
        )}
        {embedded && (
          <p className="text-sm text-muted">No professor replies yet — analytics will appear here after replies arrive.</p>
        )}
      </div>
    );
  }

  return (
    <section className={embedded ? 'p-4 space-y-3' : 'space-y-3'}>
      {!embedded && (
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <MessageSquare className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-gray-900 dark:text-white">Reply Hub</h3>
            <p className="text-[10px] text-muted">{replies.length} professor replies — classify, suggest, respond</p>
          </div>
        </div>
      )}

      {/* Reply list */}
      {embedded ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            {['positive', 'negative', 'neutral', 'auto_reply'].map(cls => (
              <div key={cls} className="rounded-lg border border-gray-100 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2">
                <p className="text-[9px] uppercase tracking-wider font-semibold text-muted">{cls === 'auto_reply' ? 'Auto Reply' : cls}</p>
                <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{replies.filter(r => (r.classification || 'neutral') === cls).length}</p>
              </div>
            ))}
            <div className="rounded-lg border border-gray-100 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2">
              <p className="text-[9px] uppercase tracking-wider font-semibold text-muted">Replied</p>
              <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{replies.filter(r => r.reply_sent === 1).length}</p>
            </div>
            <div className="rounded-lg border border-gray-100 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2">
              <p className="text-[9px] uppercase tracking-wider font-semibold text-muted">Suggestions</p>
              <p className="text-lg font-bold tabular-nums text-gray-900 dark:text-white">{replies.filter(r => r.suggested_reply).length}</p>
            </div>
          </div>

          <div className="overflow-auto max-h-[420px] rounded-xl border border-gray-100 dark:border-neutral-800 bg-white dark:bg-neutral-900">
            <table className="w-full min-w-[920px] text-[11px]">
              <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-neutral-800 border-b border-gray-100 dark:border-neutral-700">
                <tr className="text-left text-muted">
                  <th className="px-3 py-2 font-semibold">Professor</th>
                  <th className="px-3 py-2 font-semibold">Class</th>
                  <th className="px-3 py-2 font-semibold">Summary</th>
                  <th className="px-3 py-2 font-semibold">Original Subject</th>
                  <th className="px-3 py-2 font-semibold">Received</th>
                  <th className="px-3 py-2 font-semibold text-right">Process Time</th>
                  <th className="px-3 py-2 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {replies.map(reply => {
                  const isSent = reply.reply_sent === 1;
                  const hasSuggestion = reply.suggested_reply && reply.suggested_reply.trim().length > 0;
                  return (
                    <tr key={reply.id} className="border-b border-gray-100 dark:border-neutral-800 hover:bg-gray-50/70 dark:hover:bg-neutral-800/50">
                      <td className="px-3 py-2 font-mono font-medium text-gray-800 dark:text-gray-200 truncate max-w-[190px]" title={reply.professor_email}>
                        {reply.professor_email}
                      </td>
                      <td className="px-3 py-2"><Badge cls={reply.classification}>{reply.classification || 'neutral'}</Badge></td>
                      <td className="px-3 py-2 text-muted truncate max-w-[260px]" title={reply.reply_body || reply.summary || ''}>{reply.summary || '-'}</td>
                      <td className="px-3 py-2 text-muted truncate max-w-[210px]" title={reply.original_subject || ''}>{reply.original_subject || '-'}</td>
                      <td className="px-3 py-2 text-muted whitespace-nowrap">{formatTimestamp(reply.received_at) || '-'}</td>
                      <td className="px-3 py-2 text-right text-muted tabular-nums">{formatDuration(reply.total_duration_ms || reply.draft_duration_ms || reply.research_duration_ms)}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1.5">
                          {!hasSuggestion && !isSent && (
                            <button
                              onClick={() => handleSuggest(reply.id)}
                              disabled={suggestingId === reply.id}
                              className="text-[10px] px-2 py-1 rounded-lg border border-violet-200 dark:border-violet-800 text-violet-600 dark:text-violet-400 font-medium disabled:opacity-50"
                            >
                              {suggestingId === reply.id ? '...' : 'Suggest'}
                            </button>
                          )}
                          {hasSuggestion && !isSent && (
                            <button
                              onClick={() => openCompose(reply)}
                              className="text-[10px] px-2 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 font-medium"
                            >
                              Reply
                            </button>
                          )}
                          {isSent && <span className="text-[10px] px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700 dark:bg-neutral-800 dark:text-emerald-400 font-medium">Sent</span>}
                          <button
                            onClick={() => handleDelete(reply.id)}
                            disabled={deletingId === reply.id}
                            className="text-[10px] px-2 py-1 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 font-medium disabled:opacity-50"
                          >
                            {deletingId === reply.id ? '...' : 'Delete'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
      <div className="space-y-2">
        {replies.map((reply) => {
          const Icon = CLASSIFICATION_ICONS[reply.classification] || Minus;
          const isExpanded = expandedId === reply.id;
          const isSent = reply.reply_sent === 1;
          const hasSuggestion = reply.suggested_reply && reply.suggested_reply.trim().length > 0;

          return (
            <div
              key={reply.id}
              className="rounded-xl border border-gray-100 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 space-y-2"
            >
              {/* Top row: badge + email + timestamp + sent badge */}
              <div className="flex items-center gap-2">
                <Badge cls={reply.classification}>{reply.classification || 'neutral'}</Badge>
                <Icon className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-xs font-medium text-gray-900 dark:text-white truncate max-w-[200px]">
                  {reply.professor_email}
                </span>
                <span className="text-[10px] text-muted ml-auto whitespace-nowrap">
                  {formatTimestamp(reply.received_at)}
                </span>
                {isSent && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-neutral-800 dark:text-emerald-400">
                    Sent
                  </span>
                )}
              </div>

              {/* Summary */}
              {reply.summary && (
                <p className="text-[11px] text-muted line-clamp-2">{reply.summary}</p>
              )}

              {/* Expandable suggested reply preview */}
              {hasSuggestion && (
                <div>
                  <button
                    onClick={() => toggleExpand(reply.id)}
                    className="text-[10px] text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 font-medium"
                  >
                    <Sparkles className="w-3 h-3" />
                    {isExpanded ? 'Hide suggestion' : 'Show AI suggestion'}
                  </button>
                  {isExpanded && (
                    <div
                      className="mt-2 p-3 rounded-lg bg-white border border-gray-100 dark:border-neutral-800 text-[11px] text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-[Roboto,sans-serif] leading-[1.6]"
                      style={{ fontSize: '14px' }}
                    >
                      {reply.suggested_reply}
                    </div>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center gap-1.5 pt-1">
                {!hasSuggestion && !isSent && (
                  <button
                    onClick={() => handleSuggest(reply.id)}
                    disabled={suggestingId === reply.id}
                    className="text-[10px] px-2.5 py-1.5 flex items-center gap-1.5 rounded-lg border border-violet-200 dark:border-violet-800 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors font-medium disabled:opacity-50"
                  >
                    {suggestingId === reply.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    Suggest AI Reply
                  </button>
                )}
                {hasSuggestion && !isSent && (
                  <button
                    onClick={() => openCompose(reply)}
                    className="text-[10px] px-2.5 py-1.5 flex items-center gap-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors font-medium"
                  >
                    <Edit3 className="w-3 h-3" /> Compose &amp; Send
                  </button>
                )}
                {isSent && (
                  <span className="text-[10px] px-2.5 py-1.5 flex items-center gap-1.5 rounded-lg bg-gray-50 dark:bg-neutral-800 text-gray-400 font-medium">
                    <Send className="w-3 h-3" /> Reply sent
                  </span>
                )}
                <button
                  onClick={() => handleDelete(reply.id)}
                  disabled={deletingId === reply.id}
                  className="text-[10px] px-2.5 py-1.5 flex items-center gap-1.5 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors font-medium disabled:opacity-50 ml-auto"
                >
                  {deletingId === reply.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* Compose popup modal */}
      {composeOpen && composeReply && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeCompose} />

          {/* Modal */}
          <div className="relative w-full max-w-lg mx-4 rounded-xl border border-gray-100 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xl space-y-3 p-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-emerald-600" />
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Compose Reply</h4>
                <span className="text-[10px] text-muted">{composeReply.professor_email}</span>
              </div>
              <button onClick={closeCompose} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>

            {/* Subject */}
            <div>
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 block">Subject</label>
              <input
                type="text"
                value={composeSubject}
                onChange={(e) => setComposeSubject(e.target.value)}
                className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
              />
            </div>

            {/* Editable body — visually identical to preview, just editable */}
            <div>
              <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1 block">Reply body</label>
              <div
                ref={editRef}
                contentEditable
                suppressContentEditableWarning
                className="p-3 rounded-lg bg-white border border-gray-100 dark:border-neutral-800 text-gray-700 dark:text-gray-300 whitespace-pre-wrap focus:outline-none"
                style={{
                  fontFamily: 'Roboto, sans-serif',
                  fontSize: '14px',
                  lineHeight: '1.6',
                  minHeight: '140px',
                }}
              />
            </div>

            {/* File attachment */}
            <div className="flex items-center gap-2">
              <label className="text-[10px] px-2.5 py-1.5 flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-neutral-700 text-muted hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors font-medium cursor-pointer">
                <Paperclip className="w-3 h-3" /> Attach file
                <input type="file" className="hidden" onChange={handleFileChange} />
              </label>
              {composeFile && (
                <span className="text-[10px] text-gray-500 truncate max-w-[180px]">{composeFile.name}</span>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-neutral-800">
              <button
                onClick={handleSend}
                disabled={composeSending}
                className="text-[11px] px-4 py-2 flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {composeSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Send
              </button>
              <button
                onClick={handleSaveDraft}
                disabled={composeDrafting}
                className="text-[11px] px-4 py-2 flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-neutral-700 text-muted font-medium hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors disabled:opacity-50"
              >
                {composeDrafting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Edit3 className="w-3.5 h-3.5" />}
                Save Draft
              </button>
              <button onClick={closeCompose} className="text-[11px] px-4 py-2 rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
