import test from 'node:test';
import assert from 'node:assert/strict';
import { selectReplyStyleSamples } from '../src/gmail/sentReplyStyle.js';

function plainMessage(text) {
  return {
    payload: {
      mimeType: 'text/plain',
      body: { data: Buffer.from(text, 'utf8').toString('base64url') },
    },
  };
}

test('selectReplyStyleSamples cleans quoted history and keeps real reply text', () => {
  const message = plainMessage(
    'Dear Professor Lee,\n\nThank you so much for your reply. I would be glad to discuss my background further.\n\nBest,\nHabib\n\nOn Mon, Jan 1, 2024 wrote:\n> original cold email content here',
  );
  const [sample] = selectReplyStyleSamples([message], 3);
  assert.match(sample, /Thank you so much for your reply/);
  assert.doesNotMatch(sample, /original cold email content/);
});

test('selectReplyStyleSamples drops trivial replies and dedupes', () => {
  const messages = [
    plainMessage('ok'),
    plainMessage('Dear Professor, thank you for the update, I will follow up shortly. Best, Habib'),
    plainMessage('Dear Professor, thank you for the update, I will follow up shortly. Best, Habib'),
  ];
  const samples = selectReplyStyleSamples(messages, 3);
  assert.equal(samples.length, 1);
});

test('selectReplyStyleSamples respects the maxSamples limit', () => {
  const messages = Array.from({ length: 5 }, (_, index) =>
    plainMessage(`Dear Professor ${index}, thank you for considering my application this cycle. Best regards, Habib`));
  assert.equal(selectReplyStyleSamples(messages, 2).length, 2);
});
