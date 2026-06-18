/** Built-in campaign presets — saved to settings.campaign_presets JSON. */
export const DEFAULT_CAMPAIGN_PRESETS = [
  {
    id: 'express_basic',
    name: 'Express Basic',
    description: 'Last name only, auto-send, skip recent duplicates',
    mode: 'basic_instant',
    approval_mode: 'auto',
    auto_send: 1,
    basic_subject_keyword: 0,
    duplicate_policy: 'skip_within_days',
    duplicate_cooldown_days: 30,
    auto_advance_queue: 1,
  },
  {
    id: 'deep_instant',
    name: 'Deep Instant',
    description: 'Full personalization with manual review on first batch',
    mode: 'instant',
    approval_mode: 'manual',
    auto_send: 0,
    duplicate_policy: 'review_always',
    auto_advance_queue: 1,
  },
  {
    id: 'scheduled_wave',
    name: 'Scheduled Wave',
    description: 'Basic scheduled, 50/day waves, smart timezone',
    mode: 'basic_scheduled',
    batch_mode: 'basic_scheduled',
    auto_approve: 1,
    skip_duplicates: 1,
    duplicate_policy: 'skip_within_days',
    duplicate_cooldown_days: 30,
    wave_batch_size: 50,
    draft_first: 1,
  },
];

export function parseCampaignPresets(settingsRow) {
  try {
    const raw = settingsRow?.campaign_presets;
    if (!raw) return DEFAULT_CAMPAIGN_PRESETS;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_CAMPAIGN_PRESETS;
  } catch {
    return DEFAULT_CAMPAIGN_PRESETS;
  }
}

export function serializeCampaignPresets(presets) {
  return JSON.stringify(presets || DEFAULT_CAMPAIGN_PRESETS);
}
