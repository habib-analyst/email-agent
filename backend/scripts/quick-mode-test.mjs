/**
 * Quick Instant + Basic mode feature smoke test (max 5 emails).
 * Uses manual approval — does NOT auto-send emails.
 */
const BASE = 'http://localhost:3001/api';
const TEST_EMAILS = [
  'smith@cs.stanford.edu',
  'jones@mit.edu',
  'wang@berkeley.edu',
  'kim@cmu.edu',
  'lee@gatech.edu',
];
const INSTANT_EMAILS = TEST_EMAILS.slice(0, 3);
const BASIC_EMAILS = TEST_EMAILS.slice(3, 5);

const results = [];
const log = (mode, feature, ok, detail = '') => {
  const row = { mode, feature, ok, detail };
  results.push(row);
  console.log(`${ok ? 'PASS' : 'FAIL'} [${mode}] ${feature}${detail ? ` — ${detail}` : ''}`);
};

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${method} ${path} → ${res.status}`);
  return data;
}

async function waitForQueue(mode, predicate, label, maxMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const queue = await api('GET', `/queue?mode=${mode}`);
    if (predicate(queue)) return queue;
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`Timeout waiting for ${label}`);
}

async function testModeSetup(mode) {
  await api('POST', '/reset', { mode });
  log(mode, 'reset', true);

  const boot = await api('GET', `/bootstrap?mode=${mode}`);
  log(mode, 'bootstrap', !!boot.settings && boot.stats !== undefined, `queue=${boot.queue?.length ?? 0}`);

  const tpl = await api('GET', `/template?mode=${mode}`);
  log(mode, 'template', !!tpl?.raw_html, tpl?.sample_subject || 'no subject');

  const ctx = await api('GET', `/agent-context?mode=${mode}`);
  log(mode, 'agent-context', ctx.mode === mode, ctx.draftRules?.slice(0, 50));

  const stats = await api('GET', `/stats?mode=${mode}`);
  log(mode, 'stats', stats.total === 0, `total=${stats.total}`);

  return boot;
}

async function testInstant() {
  const mode = 'instant';
  console.log('\n=== INSTANT MODE ===');
  await api('PUT', '/settings', { approval_mode: 'manual', auto_send: 0 });

  await testModeSetup(mode);

  const imp = await api('POST', '/professors', {
    mode,
    emails: INSTANT_EMAILS.join('\n'),
    max_professors: 3,
  });
  log(mode, 'import (3 emails)', imp.added >= 1, `added=${imp.added} skipped=${imp.skipped}`);

  const roster = await api('GET', `/roster?mode=${mode}`);
  log(mode, 'roster', Array.isArray(roster), `${roster.length} rows`);

  try {
    const queue = await waitForQueue(
      mode,
      q => q.some(i => ['drafted', 'verified', 'awaiting_proceed', 'sent', 'failed'].includes(i.state)),
      'draft or terminal state',
      90000,
    );
    const states = queue.map(i => `${i.professor_email}:${i.state}`).join(', ');
    log(mode, 'pipeline draft', queue.some(i => ['drafted', 'verified', 'awaiting_proceed'].includes(i.state)), states);

    const drafted = queue.find(i => ['drafted', 'verified', 'awaiting_proceed'].includes(i.state));
    if (drafted?.subject) {
      log(mode, 'subject keyword', /^\[.+]/.test(drafted.subject), drafted.subject);
    }
    if (drafted?.interest_line) {
      log(mode, 'interest line', drafted.interest_line.length > 0, drafted.interest_line.slice(0, 60));
    }
  } catch (e) {
    log(mode, 'pipeline draft', false, e.message);
  }

  const tplPut = await api('PUT', '/template/instructions', {
    mode,
    instructions: 'Test instructions instant',
    sample_subject: '[Keyword] Seeking an MS/PhD Position in Your Lab',
  });
  log(mode, 'save template instructions', tplPut.success, tplPut.template?.sample_subject);
}

async function testBasic() {
  const mode = 'basic_instant';
  console.log('\n=== BASIC INSTANT MODE ===');

  await testModeSetup(mode);

  // keyword OFF
  let kw = await api('POST', '/settings/basic-subject-keyword', { enabled: false });
  log(mode, 'subject keyword toggle OFF', kw.basic_subject_keyword === 0, kw.template?.sample_subject);

  kw = await api('POST', '/settings/basic-subject-keyword', { enabled: true });
  log(mode, 'subject keyword toggle ON', kw.basic_subject_keyword === 1, kw.template?.sample_subject);

  const ctxOn = await api('GET', '/agent-context?mode=basic_instant');
  log(mode, 'agent subjectKeyword flag', ctxOn.personalize?.subjectKeyword === true, ctxOn.subjectPattern);

  await api('PUT', '/settings', { approval_mode: 'manual', auto_send: 0 });

  const imp = await api('POST', '/professors', {
    mode,
    emails: BASIC_EMAILS.join('\n'),
    max_professors: 2,
  });
  log(mode, 'import (2 emails)', imp.added >= 1, `added=${imp.added} skipped=${imp.skipped}`);

  try {
    const queue = await waitForQueue(
      mode,
      q => q.some(i => ['drafted', 'verified', 'awaiting_proceed', 'sent', 'failed'].includes(i.state)),
      'draft or terminal state',
      90000,
    );
    const states = queue.map(i => `${i.professor_email}:${i.state}`).join(', ');
    log(mode, 'pipeline draft', queue.some(i => ['drafted', 'verified', 'awaiting_proceed'].includes(i.state)), states);

    const drafted = queue.find(i => ['drafted', 'verified', 'awaiting_proceed'].includes(i.state));
    if (drafted?.subject) {
      log(mode, 'subject with keyword', /^\[.+]/.test(drafted.subject), drafted.subject);
    }
    if (drafted && !drafted.interest_line) {
      log(mode, 'no interest line', true, 'empty as expected');
    }
  } catch (e) {
    log(mode, 'pipeline draft', false, e.message);
  }

  const repair = await api('POST', '/template/repair-basic');
  log(mode, 'repair-basic template', repair.success, repair.reason || 'ok');
}

async function main() {
  console.log('Quick mode test — max 5 emails, manual approval (no auto-send)\n');
  const t0 = Date.now();
  try {
    const health = await api('GET', '/health');
    log('system', 'health', health.status === 'ok', `gmail=${health.authenticated}`);
  } catch (e) {
    console.error('Backend not reachable:', e.message);
    process.exit(1);
  }

  await testInstant();
  await testBasic();

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok);
  console.log(`\n=== SUMMARY: ${passed}/${results.length} passed (${Math.round((Date.now() - t0) / 1000)}s) ===`);
  if (failed.length) {
    console.log('Failed:');
    failed.forEach(f => console.log(`  - [${f.mode}] ${f.feature}: ${f.detail}`));
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Test crashed:', e.message);
  process.exit(1);
});
