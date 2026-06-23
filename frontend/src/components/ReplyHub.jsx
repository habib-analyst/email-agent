import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2, ChevronDown, ChevronUp, Edit3, FilePlus2, Loader2,
  Mail, MessageSquare, Plus, Save, Send, X, XCircle,
} from 'lucide-react';
import { get, post, put } from '../api.js';
import { useToast } from './Toast.jsx';
import { formatDateTime12 } from '../utils/dateTime.js';

const COLORS = {
  positive: 'bg-emerald-100 text-emerald-700 dark:bg-neutral-800 dark:text-emerald-400',
  negative: 'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400',
  neutral: 'bg-gray-100 text-gray-700 dark:bg-neutral-800 dark:text-gray-300',
  auto_reply: 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
};

function Badge({ children, className = '' }) {
  return <span className={`inline-flex rounded px-2 py-1 text-[10px] font-semibold ${className}`}>{children}</span>;
}

function formatTime(value) {
  return formatDateTime12(value, '-');
}

function scenarioHtml(template, lastName) {
  const body = String(template || '').replace(/\[Last Name\]|\{\{LAST_NAME\}\}/gi, lastName || '');
  return body.split(/\n{2,}/).map(block => `<p>${block.replace(/\n/g, '<br>')}</p>`).join('');
}

export default function ReplyHub({ replies = [], onRefresh, embedded = false, filter = 'all', onClearFilter }) {
  const toast = useToast();
  const editorRef = useRef(null);
  const [scenarios, setScenarios] = useState([]);
  const [expandedScenario, setExpandedScenario] = useState(null);
  const [editingScenario, setEditingScenario] = useState(null);
  const [scenarioForm, setScenarioForm] = useState(null);
  const [showNewScenario, setShowNewScenario] = useState(false);
  const [newScenario, setNewScenario] = useState({ name: '', description: '', body_template: '' });
  const [working, setWorking] = useState('');
  const [compose, setCompose] = useState(null);
  const [localReplies, setLocalReplies] = useState(replies);

  const loadScenarios = useCallback(async () => {
    try {
      setScenarios(await get('/reply-scenarios'));
    } catch (error) {
      toast.error(error.message || 'Could not load reply scenarios');
    }
  }, [toast]);

  useEffect(() => { loadScenarios(); }, [loadScenarios]);
  useEffect(() => { setLocalReplies(replies); }, [replies]);

  const refresh = useCallback(async () => {
    await Promise.all([loadScenarios(), onRefresh?.()]);
  }, [loadScenarios, onRefresh]);

  const filteredReplies = useMemo(() => localReplies.filter(reply => {
    if (!filter || filter === 'all') return true;
    if (filter === 'answered') return !!reply.replied_by_user;
    return reply.classification === filter;
  }), [localReplies, filter]);

  const groups = useMemo(() => {
    const map = new Map();
    for (const reply of filteredReplies) {
      const key = reply.scenario_name || 'Unclassified / Needs Review';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(reply);
    }
    return [...map.entries()];
  }, [filteredReplies]);

  const openCompose = useCallback((reply, htmlOverride) => {
    setCompose(reply);
    const html = htmlOverride || reply.suggested_reply || (
      reply.scenario_body_template
        ? scenarioHtml(reply.scenario_body_template, reply.professor_last_name)
        : ''
    );
    setTimeout(() => { if (editorRef.current) editorRef.current.innerHTML = html; }, 0);
  }, []);

  const assignScenario = async (reply, scenarioId, shouldCompose = false) => {
    setWorking(`assign-${reply.id}`);
    try {
      const result = await put(`/replies/${reply.id}/scenario`, { scenario_id: Number(scenarioId) });
      const selectedScenario = scenarios.find(item => item.id === Number(scenarioId));
      const updatedReply = {
        ...reply,
        ...result.reply,
        scenario_id: Number(scenarioId),
        scenario_name: selectedScenario?.name || reply.scenario_name,
        scenario_body_template: selectedScenario?.body_template || reply.scenario_body_template,
      };
      setLocalReplies(current => current.map(item => item.id === reply.id ? updatedReply : item));
      if (shouldCompose) openCompose(updatedReply, result.reply.suggested_reply);
      await refresh();
    } catch (error) {
      toast.error(error.message || 'Could not assign scenario');
    } finally {
      setWorking('');
    }
  };

  const prepareReply = async reply => {
    if (reply.suggested_reply) return openCompose(reply);
    if (reply.scenario_id) return assignScenario(reply, reply.scenario_id, true);
    toast.error('Choose a reply scenario first');
  };

  const saveLocalDraft = async () => {
    const html = editorRef.current?.innerHTML || '';
    setWorking('save-draft');
    try {
      const result = await put(`/replies/${compose.id}/draft`, { suggested_reply: html });
      setLocalReplies(current => current.map(item => item.id === compose.id ? { ...item, ...result.reply } : item));
      toast.success('Reply draft saved');
      setCompose(null);
      await refresh();
    } catch (error) {
      toast.error(error.message || 'Could not save draft');
    } finally {
      setWorking('');
    }
  };

  const saveGmailDraft = async () => {
    const html = editorRef.current?.innerHTML || '';
    setWorking('gmail-draft');
    try {
      await post(`/replies/${compose.id}/gmail-draft`, { html });
      toast.success('Draft saved in Gmail');
      setCompose(null);
      await refresh();
    } catch (error) {
      toast.error(error.message || 'Could not create Gmail draft');
    } finally {
      setWorking('');
    }
  };

  const sendReply = async () => {
    const html = editorRef.current?.innerHTML || '';
    if (!window.confirm(`Send this reply manually to ${compose.professor_email}?`)) return;
    setWorking('send-reply');
    try {
      await post(`/replies/${compose.id}/send`, { html });
      toast.success('Reply sent');
      setCompose(null);
      await refresh();
    } catch (error) {
      toast.error(error.message || 'Could not send reply');
    } finally {
      setWorking('');
    }
  };

  const rejectReply = async reply => {
    if (!window.confirm(`Reject this reply record for ${reply.professor_email}? It will remain in history.`)) return;
    setWorking(`reject-${reply.id}`);
    try {
      await post(`/replies/${reply.id}/reject`);
      await refresh();
    } catch (error) {
      toast.error(error.message || 'Could not reject reply');
    } finally {
      setWorking('');
    }
  };

  const resendOriginal = async reply => {
    if (!window.confirm(`Resend the original outreach to ${reply.professor_email}? This is allowed only once for this reply.`)) return;
    setWorking(`resend-${reply.id}`);
    try {
      await post(`/replies/${reply.id}/resend-original`, { confirm: true }, { timeout: 120000 });
      toast.success('Original outreach resent once');
      await refresh();
    } catch (error) {
      toast.error(error.message || 'Could not resend original outreach');
    } finally {
      setWorking('');
    }
  };

  const saveScenario = async scenario => {
    setWorking(`scenario-${scenario.id}`);
    try {
      await put(`/reply-scenarios/${scenario.id}`, scenarioForm);
      setEditingScenario(null);
      setScenarioForm(null);
      await loadScenarios();
    } catch (error) {
      toast.error(error.message || 'Could not save scenario');
    } finally {
      setWorking('');
    }
  };

  const createScenario = async () => {
    setWorking('new-scenario');
    try {
      await post('/reply-scenarios', newScenario);
      setShowNewScenario(false);
      setNewScenario({ name: '', description: '', body_template: '' });
      await loadScenarios();
    } catch (error) {
      toast.error(error.message || 'Could not create scenario');
    } finally {
      setWorking('');
    }
  };

  const composeFromScenario = scenario => {
    const reply = localReplies.find(item =>
      item.scenario_id === scenario.id && !['sending', 'sent', 'rejected'].includes(item.workflow_status)
    );
    if (!reply) return toast.error('No open reply currently matches this scenario');
    assignScenario(reply, scenario.id, true);
  };

  const counts = {
    auto: localReplies.filter(reply => reply.classification === 'auto_reply').length,
    positive: localReplies.filter(reply => reply.classification === 'positive').length,
    negative: localReplies.filter(reply => reply.classification === 'negative').length,
    answered: localReplies.filter(reply => reply.replied_by_user).length,
  };

  return (
    <section className={embedded ? 'p-4 space-y-5' : 'space-y-5'}>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Replies scenarios drafts</h3>
            <p className="text-[10px] text-muted">Reusable manual drafts. Classification never sends email.</p>
          </div>
          <button onClick={() => setShowNewScenario(value => !value)} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-[10px] font-semibold">
            <Plus className="h-3 w-3" /> New scenario
          </button>
        </div>

        {showNewScenario && (
          <div className="grid gap-2 rounded-xl border border-gray-200 p-3 dark:border-neutral-700">
            <input className="rounded-lg border bg-transparent px-3 py-2 text-xs" placeholder="Scenario name" value={newScenario.name} onChange={e => setNewScenario({ ...newScenario, name: e.target.value })} />
            <input className="rounded-lg border bg-transparent px-3 py-2 text-xs" placeholder="Description used for classification" value={newScenario.description} onChange={e => setNewScenario({ ...newScenario, description: e.target.value })} />
            <textarea className="min-h-32 rounded-lg border bg-transparent px-3 py-2 text-xs" placeholder="Use [Last Name] in the greeting" value={newScenario.body_template} onChange={e => setNewScenario({ ...newScenario, body_template: e.target.value })} />
            <button onClick={createScenario} disabled={working === 'new-scenario'} className="w-fit rounded-lg bg-emerald-600 px-3 py-2 text-[10px] font-semibold text-white disabled:opacity-50">Save scenario</button>
          </div>
        )}

        <div className="max-h-[560px] overflow-y-auto pr-1">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {scenarios.map(scenario => {
            const editing = editingScenario === scenario.id;
            const expanded = expandedScenario === scenario.id;
            return (
              <div key={scenario.id} className="rounded-xl border border-gray-100 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
                {editing ? (
                  <div className="space-y-2">
                    <input className="w-full rounded border bg-transparent px-2 py-1 text-xs" value={scenarioForm.name} onChange={e => setScenarioForm({ ...scenarioForm, name: e.target.value })} />
                    <input className="w-full rounded border bg-transparent px-2 py-1 text-xs" value={scenarioForm.description || ''} onChange={e => setScenarioForm({ ...scenarioForm, description: e.target.value })} />
                    <textarea className="min-h-36 w-full rounded border bg-transparent px-2 py-1 text-xs" value={scenarioForm.body_template} onChange={e => setScenarioForm({ ...scenarioForm, body_template: e.target.value })} />
                    <div className="flex gap-2">
                      <button onClick={() => saveScenario(scenario)} className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600"><Save className="h-3 w-3" /> Save</button>
                      <button onClick={() => setEditingScenario(null)} className="text-[10px] text-muted">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-gray-900 dark:text-white">{scenario.name}</p>
                        <p className="mt-1 text-[10px] text-muted">{scenario.description}</p>
                      </div>
                      <Badge className="bg-gray-100 text-gray-600 dark:bg-neutral-800 dark:text-gray-300">{scenario.reply_count || 0}</Badge>
                    </div>
                    {expanded && (
                      <div className="gmail-chrome-compose mt-3 overflow-hidden rounded-lg border border-gray-200 dark:border-neutral-700">
                        <div className="gmail-chrome-header">
                          <span className="gmail-chrome-header-title">Reply</span>
                          <div className="gmail-chrome-window-btns"><X className="h-3 w-3" /></div>
                        </div>
                        <div className="gmail-chrome-row gmail-chrome-row-to">
                          <span className="gmail-chrome-label">To</span>
                          <span className="gmail-chrome-recipients flex-1">professor@university.edu</span>
                        </div>
                        <div className="gmail-chrome-row">
                          <span className="gmail-chrome-label">Last name</span>
                          <span className="gmail-chrome-recipients">[Last Name]</span>
                        </div>
                        <div className="max-h-52 overflow-y-auto bg-white px-4 py-3 text-[12px] leading-5 text-[#202124]">
                          <div dangerouslySetInnerHTML={{ __html: scenarioHtml(scenario.body_template, '[Last Name]') }} />
                        </div>
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={() => setExpandedScenario(expanded ? null : scenario.id)} className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-600">{expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />} View</button>
                      <button onClick={() => { setEditingScenario(scenario.id); setScenarioForm({ ...scenario }); }} className="inline-flex items-center gap-1 text-[10px] font-semibold text-violet-600"><Edit3 className="h-3 w-3" /> Edit</button>
                      <button onClick={() => composeFromScenario(scenario)} className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600"><Mail className="h-3 w-3" /> Gmail compose</button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {[
          ['All replies', localReplies.length],
          ['Positive', counts.positive],
          ['Negative', counts.negative],
          ['Auto replies', counts.auto],
          ['Reply by Yes', counts.answered],
        ].map(([label, count]) => (
          <div key={label} className="rounded-lg border border-gray-100 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-muted">{label}</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">{count}</p>
          </div>
        ))}
      </div>
      {filter !== 'all' && (
        <div className="flex items-center justify-between rounded-lg border border-brand-200 bg-brand-50/50 px-3 py-2 text-xs dark:border-brand-900/40 dark:bg-brand-950/10">
          <span>Showing reply filter: <strong>{filter.replace(/_/g, ' ')}</strong></span>
          <button type="button" onClick={onClearFilter} className="font-semibold text-brand-600 hover:underline">Clear filter</button>
        </div>
      )}

      {!filteredReplies.length ? (
        <div className="p-6 text-center text-sm text-muted">No replies found in Gmail yet.</div>
      ) : groups.map(([groupName, rows]) => (
        <div key={groupName} className="overflow-hidden rounded-xl border border-gray-100 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 dark:border-neutral-800">
            <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
            <h4 className="text-xs font-semibold text-gray-900 dark:text-white">{groupName}</h4>
            <Badge className="ml-auto bg-gray-100 text-gray-600 dark:bg-neutral-800 dark:text-gray-300">{rows.length}</Badge>
          </div>
          <div className="max-h-[440px] overflow-auto">
            <table className="w-full min-w-[1150px] text-[11px]">
              <thead className="bg-gray-50 text-left text-muted dark:bg-neutral-800">
                <tr>
                  <th className="px-3 py-2">Professor</th>
                  <th className="px-3 py-2">Class</th>
                  <th className="px-3 py-2">Summary</th>
                  <th className="px-3 py-2">Received</th>
                  <th className="px-3 py-2">Reply by</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Scenario</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(reply => {
                  const terminal = ['sending', 'sent', 'rejected'].includes(reply.workflow_status);
                  return (
                    <tr key={reply.id} className="border-t border-gray-100 align-top dark:border-neutral-800">
                      <td className="max-w-[190px] truncate px-3 py-2 font-mono" title={reply.professor_email}>{reply.professor_email}</td>
                      <td className="px-3 py-2"><Badge className={COLORS[reply.classification] || COLORS.neutral}>{reply.classification || 'neutral'}</Badge></td>
                      <td className="max-w-[260px] truncate px-3 py-2 text-muted" title={reply.reply_body || reply.summary}>{reply.summary || '-'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted">{formatTime(reply.received_at)}</td>
                      <td className="px-3 py-2">
                        {reply.replied_by_user
                          ? <Badge className="bg-emerald-100 text-emerald-700"><CheckCircle2 className="mr-1 h-3 w-3" />Yes</Badge>
                          : <Badge className="bg-gray-100 text-gray-600"><XCircle className="mr-1 h-3 w-3" />No</Badge>}
                      </td>
                      <td className="px-3 py-2"><Badge className="bg-gray-100 text-gray-700 dark:bg-neutral-800 dark:text-gray-300">{reply.workflow_status || 'new'}</Badge></td>
                      <td className="px-3 py-2">
                        <select
                          value={String(reply.scenario_id || '')}
                          onChange={e => assignScenario(reply, e.target.value)}
                          disabled={working === `assign-${reply.id}`}
                          className="max-w-[220px] rounded border bg-white px-2 py-1 text-[10px] dark:bg-neutral-900 disabled:opacity-60"
                          title={terminal ? 'Change classification only; status remains unchanged' : 'Change reply scenario'}
                        >
                          <option value="" disabled>Needs Review</option>
                          {scenarios.filter(item => item.active).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1.5">
                          <button onClick={() => window.alert(reply.reply_body || reply.summary || 'No body')} className="rounded border px-2 py-1 text-[10px]">View</button>
                          {!terminal && <button onClick={() => prepareReply(reply)} disabled={working === `assign-${reply.id}`} className="rounded border border-emerald-200 px-2 py-1 text-[10px] text-emerald-700">Scenario reply</button>}
                          {reply.classification === 'auto_reply' && !reply.original_resent_at && !terminal && (
                            <button onClick={() => resendOriginal(reply)} disabled={working === `resend-${reply.id}`} className="rounded border border-amber-200 px-2 py-1 text-[10px] text-amber-700">Original resend</button>
                          )}
                          {reply.original_resent_at && <Badge className="bg-amber-100 text-amber-700">Resent</Badge>}
                          {!terminal && <button onClick={() => rejectReply(reply)} disabled={working === `reject-${reply.id}`} className="rounded border border-red-200 px-2 py-1 text-[10px] text-red-600">Reject</button>}
                          {reply.workflow_status === 'sent' && <Badge className="bg-emerald-100 text-emerald-700">Sent {formatTime(reply.reply_sent_at)}</Badge>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {compose && createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/45 p-3 backdrop-blur-[2px] sm:p-6">
          <button type="button" aria-label="Close reply composer" className="absolute inset-0 cursor-default" onClick={() => setCompose(null)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Reply to ${compose.professor_email}`}
            className="relative flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_24px_80px_rgba(0,0,0,0.35)] dark:border-neutral-700 dark:bg-neutral-900"
          >
            <div className="flex shrink-0 items-center justify-between bg-[#40464f] px-4 py-3 text-white">
              <div className="flex min-w-0 items-center gap-2.5">
                <MessageSquare className="h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">Reply in Gmail conversation</p>
                  <p className="truncate text-[10px] text-gray-300">Your reply will appear after the professor’s latest message</p>
                </div>
              </div>
              <button type="button" onClick={() => setCompose(null)} className="rounded-md p-1.5 text-gray-200 hover:bg-white/10 hover:text-white" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="shrink-0 border-b border-gray-200 bg-white px-5 py-3 dark:border-neutral-700 dark:bg-neutral-900">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                  {(compose.professor_email || 'P').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Replying to</p>
                  <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{compose.professor_email}</p>
                </div>
                <Badge className="shrink-0 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">Existing thread</Badge>
              </div>
            </div>

            {(compose.reply_body || compose.summary) && (
              <div className="shrink-0 border-b border-gray-100 bg-gray-50/80 px-5 py-3 dark:border-neutral-800 dark:bg-neutral-800/50">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Professor’s latest reply</p>
                <p className="line-clamp-2 text-xs leading-5 text-gray-600 dark:text-gray-300">{compose.reply_body || compose.summary}</p>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto bg-white px-5 py-4 dark:bg-neutral-900">
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                className="min-h-64 text-[14px] leading-6 text-[#202124] outline-none dark:text-gray-100 [&_p]:mb-4"
                data-placeholder="Write your reply..."
              />
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-gray-200 bg-gray-50 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800">
              <button onClick={sendReply} disabled={working === 'send-reply'} className="inline-flex items-center gap-2 rounded-full bg-[#0b57d0] px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#0842a0] disabled:opacity-50">
                {working === 'send-reply' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Send
              </button>
              <button onClick={saveLocalDraft} disabled={working === 'save-draft'} className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-3.5 py-2 text-[11px] font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-gray-200">
                <Save className="h-3.5 w-3.5" /> Save draft
              </button>
              <button onClick={saveGmailDraft} disabled={working === 'gmail-draft'} className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-3.5 py-2 text-[11px] font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-gray-200">
                <FilePlus2 className="h-3.5 w-3.5" /> Save to Gmail
              </button>
              {working && working !== 'send-reply' && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
              <span className="ml-auto hidden text-[10px] text-gray-400 sm:block">Sent inside the same Gmail thread</span>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}
