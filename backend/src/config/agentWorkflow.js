/** Professional outreach workflow — agent reads this via getAgentContext(). */

export const AGENT_WORKFLOWS = {
  instant: {
    steps: [
      'Import professors (URL scrape, paste, or file) — scoped to instant mode DB only',
      'Research each professor on the internet (profile scrape + web search + verify email)',
      'Extract subject keyword + 3 interest keywords ONLY from verified research (no guessing)',
      'Draft email: replace {{LAST_NAME}}, [Keyword] subject, {{INTEREST_LINE}} — template body unchanged',
      'Self-check draft; if weak, retry research or fail (never send generic keywords)',
      'Send or await approval per settings',
    ],
    selfHealing: [
      'Stuck items (>15 min in researching/drafted) reset to pending automatically (max 3 heals)',
      'Research retry up to 5 attempts before marking failed',
      'Keyword validation rejects AI terms not found in professor dossier — falls back to TF-IDF from papers',
      'verifyDraft runs before send when self-check passes',
    ],
    researchProtocol: 'Search professor by email across the web. Use REAL research_areas and publication titles. Subject = 1 broad field keyword. Interest line = exactly 3 comma-separated sub-topics from their work.',
  },
  basic_instant: {
    steps: [
      'Import professors — scoped to basic_instant mode DB only (separate from instant)',
      'Research last name from profile/web (lightweight if subject keyword OFF)',
      'If subject keyword enabled: full web research → pick 1 keyword from professor research areas',
      'Draft: replace {{LAST_NAME}} only (+ optional [Keyword] in subject) — no interest line',
      'Send or await approval',
    ],
    selfHealing: [
      'Same stuck-item healing as instant, per basic_instant queue only',
      'If last name cannot be verified, item fails (no send with guessed name)',
    ],
    researchProtocol: 'Last name from verified profile preferred. Optional subject keyword must come from professor actual research — never generic "Research" or "AI" unless in their profile.',
  },
  scheduled: {
    steps: [
      'Import batch (scheduled_* tables only — never mixes with instant/basic_instant)',
      'Research each professor — LAST NAME IS MANDATORY (fail draft if unverified)',
      'Draft: {{LAST_NAME}}, [Keyword] subject, {{INTEREST_LINE}} — template body unchanged',
      'User approves drafts (or auto-approve) — batch waits until scheduled_at UTC',
      'At send time: verifyScheduledBatchBeforeSend → Gmail send each approved draft',
    ],
    selfHealing: [
      'Batch heal_count tracks auto-recovery on stuck processing',
      'Drafts failing last-name or placeholder checks marked failed — never sent',
      'Pre-send verification blocks entire batch if any approved draft invalid',
    ],
    researchProtocol: 'Last name required from verified profile. Subject + interest keywords from real research only. Agent knows batch scheduled_at and waits until due.',
  },
  basic_scheduled: {
    steps: [
      'Import batch into scheduled_* DB — basic_scheduled template (separate from normal scheduled)',
      'LAST NAME IS MANDATORY — lightweight lookup; fail if cannot verify',
      'Optional subject keyword (settings toggle): research keyword for subject only — NO interest line ever',
      'Draft: replace {{LAST_NAME}} only (+ optional [Keyword] in subject) — fixed body',
      'Approve → wait for scheduled_at → pre-send verify → send',
    ],
    selfHealing: [
      'Same batch heal as normal scheduled',
      'Never adds interest line; keyword OFF = fixed subject',
      'Pre-send verification enforces basic rules before Gmail',
    ],
    researchProtocol: 'Last name mandatory. Subject keyword optional (settings). Never personalize interest line. Separate scheduled_template mode=basic_scheduled.',
  },
};

export function getWorkflowForMode(mode = 'instant') {
  return AGENT_WORKFLOWS[mode] || AGENT_WORKFLOWS.instant;
}
