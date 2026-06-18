export async function withRetry(fn, max = 2) {
  for (let i = 0; i < max; i++) {
    try { return await fn(); }
    catch (e) { if (i === max - 1) throw e; await delay(500 * 2 ** i); }
  }
}

export function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export function randomDelay(minMin, maxMin) {
  if (!minMin && !maxMin) return Promise.resolve();
  const ms = (minMin + Math.random() * Math.max(maxMin - minMin, 0)) * 60 * 1000;
  if (ms <= 0) return Promise.resolve();
  return delay(ms);
}
