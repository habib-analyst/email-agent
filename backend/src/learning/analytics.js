import db from '../db/index.js';

function pct(num, den) {
  if (!den) return 0;
  return Math.round((num / den) * 1000) / 10;
}

export function getAnalytics() {
  const overview = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM sent_email_history) as sent,
      (SELECT COUNT(DISTINCT professor_email) FROM sent_email_history) as uniqueSentEmails,
      (SELECT COUNT(*) FROM replies) as replied,
      (SELECT COUNT(*) FROM replies WHERE classification='positive') as positive,
      (SELECT COUNT(*) FROM queue WHERE state='sent') as queueSent,
      (SELECT COUNT(*) FROM queue WHERE state='pending') as pending
  `).get();

  overview.replyRate = pct(overview.replied, overview.sent);
  overview.positiveRate = pct(overview.positive, overview.sent);

  const replyTrend = db.prepare(`
    SELECT date(sent_at) as day,
      COUNT(*) as sent
    FROM sent_log
    WHERE sent_at >= datetime('now', '-14 days')
    GROUP BY date(sent_at)
    ORDER BY day
  `).all();

  const repliesByDay = db.prepare(`
    SELECT date(received_at) as day, COUNT(*) as replied
    FROM replies WHERE received_at >= datetime('now', '-14 days')
    GROUP BY date(received_at)
  `).all();
  const replyMap = Object.fromEntries(repliesByDay.map(r => [r.day, r.replied]));
  const trend = replyTrend.map(d => ({
    day: d.day,
    sent: d.sent,
    replied: replyMap[d.day] || 0,
    replyRate: pct(replyMap[d.day] || 0, d.sent),
  }));

  const topics = db.prepare(`
    SELECT topic, sends, replies, positive_replies as positive,
      CASE WHEN sends > 0 THEN ROUND(CAST(replies AS FLOAT) / sends * 100, 1) ELSE 0 END as replyRate
    FROM learning_stats
    WHERE sends > 0
    ORDER BY positive_replies DESC, replies DESC, sends DESC
    LIMIT 10
  `).all();

  const universities = db.prepare(`
    SELECT COALESCE(NULLIF(p.university, ''), 'Unknown') as university,
      COUNT(DISTINCT sl.id) as sent,
      COUNT(DISTINCT r.id) as replied,
      SUM(CASE WHEN r.classification='positive' THEN 1 ELSE 0 END) as positive
    FROM sent_log sl
    LEFT JOIN professors p ON p.email = sl.professor_email
    LEFT JOIN replies r ON r.professor_email = sl.professor_email
    GROUP BY COALESCE(NULLIF(p.university, ''), 'Unknown')
    HAVING sent > 0
    ORDER BY replied DESC, sent DESC
    LIMIT 12
  `).all().map(u => ({ ...u, replyRate: pct(u.replied, u.sent) }));

  const sendTimes = db.prepare(`
    SELECT CAST(strftime('%H', sl.sent_at) AS INTEGER) as hour,
      COUNT(*) as sent,
      COUNT(r.id) as replied
    FROM sent_log sl
    LEFT JOIN replies r ON r.professor_email = sl.professor_email
    GROUP BY hour
    ORDER BY hour
  `).all().map(h => ({ ...h, replyRate: pct(h.replied, h.sent) }));

  const bestHours = [...sendTimes]
    .filter(h => h.sent >= 2)
    .sort((a, b) => b.replyRate - a.replyRate || b.replied - a.replied)
    .slice(0, 5);

  const aiHints = buildAITargetingHints({ topics, universities, bestHours, sendTimes });

  return {
    overview,
    replyTrend: trend,
    topics,
    universities,
    sendTimes,
    bestHours,
    aiHints,
    note: 'Reply rate is tracked from Gmail inbox. Open rates require read-receipt tracking and are not available via Gmail API.',
  };
}

export function buildAITargetingHints({ topics, universities, bestHours }) {
  const topTopics = topics
    .filter(t => t.positive > 0 || t.replyRate > 0)
    .slice(0, 5)
    .map(t => t.topic);

  const fallbackTopics = topics.slice(0, 5).map(t => t.topic);
  const topUniversities = universities
    .filter(u => u.replied > 0)
    .slice(0, 5)
    .map(u => u.university);

  const hours = bestHours.length > 0
    ? bestHours.map(h => `${String(h.hour).padStart(2, '0')}:00 (${h.replyRate}% reply rate)`)
    : [];

  return {
    topTopics: topTopics.length ? topTopics : fallbackTopics,
    topUniversities,
    bestSendHours: hours,
    summary: [
      topTopics.length ? `Prefer topics: ${topTopics.join(', ')}` : null,
      topUniversities.length ? `Responsive universities: ${topUniversities.join(', ')}` : null,
      hours.length ? `Best send hours: ${hours.join('; ')}` : null,
    ].filter(Boolean).join('. '),
  };
}

export function getAITargetingHints() {
  return getAnalytics().aiHints;
}
