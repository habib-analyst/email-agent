import db from '../db/index.js';
export { getAnalytics, getAITargetingHints, buildAITargetingHints } from './analytics.js';

export function getTopTopics(limit = 5) {
  return db.prepare('SELECT topic, positive_replies, sends FROM learning_stats ORDER BY positive_replies DESC LIMIT ?').all(limit);
}

export function getWeeklyDigest() {
  const stats = db.prepare("SELECT COUNT(*) as sent FROM sent_log WHERE sent_at >= datetime('now', '-7 days')").get();
  const replies = db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN classification='positive' THEN 1 ELSE 0 END) as positive FROM replies WHERE received_at >= datetime('now', '-7 days')").get();
  const topTopics = getTopTopics(3);
  return { sent: stats.sent, replies: replies.total, positive: replies.positive, topTopics };
}

export function runWeeklyDigest(publish) {
  const digest = getWeeklyDigest();
  db.prepare("UPDATE settings SET last_digest_sent=date('now') WHERE id=1").run();
  if (publish) publish({ type: 'weekly_digest', ...digest });
  return digest;
}
