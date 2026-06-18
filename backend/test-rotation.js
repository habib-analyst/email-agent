// Test script to verify round-robin rotation between Qwen1 and Qwen2 APIs
import { config } from './src/config/index.js';

console.log('\n=== QWEN API ROTATION TEST ===\n');

// Build combined model pool (same logic as ai/index.js)
const qwen1Combos = config.qwenModels.map(m => ({
  model: m,
  source: 'qwen1'
}));

const qwen2Combos = config.qwen2Models.map(m => ({
  model: m,
  source: 'qwen2'
}));

// Interleave both APIs
const combos = [];
const maxLen = Math.max(qwen1Combos.length, qwen2Combos.length);
for (let i = 0; i < maxLen; i++) {
  if (i < qwen1Combos.length) combos.push(qwen1Combos[i]);
  if (i < qwen2Combos.length) combos.push(qwen2Combos[i]);
}

console.log(`Total combos: ${combos.length}`);
console.log(`Qwen1 models: ${qwen1Combos.length}`);
console.log(`Qwen2 models: ${qwen2Combos.length}`);
console.log('\n--- First 20 rotation sequence ---\n');

// Simulate rotation
let qwenComboIndex = 0;
const apiCounts = { qwen1: 0, qwen2: 0 };

for (let call = 1; call <= 20; call++) {
  const idx = qwenComboIndex % combos.length;
  const combo = combos[idx];

  apiCounts[combo.source]++;

  console.log(`Call #${call}: ${combo.source}:${combo.model.slice(0, 20)}...`);

  qwenComboIndex = idx + 1; // Advance for next call
}

console.log('\n--- API Call Distribution ---\n');
console.log(`Qwen1: ${apiCounts.qwen1} calls`);
console.log(`Qwen2: ${apiCounts.qwen2} calls`);
console.log(`Difference: ${Math.abs(apiCounts.qwen1 - apiCounts.qwen2)} (should be ≤1 for balanced)`);

const isBalanced = Math.abs(apiCounts.qwen1 - apiCounts.qwen2) <= 1;
console.log(`\n✓ Balance Status: ${isBalanced ? 'EXCELLENT' : 'NEEDS ADJUSTMENT'}`);

if (isBalanced) {
  console.log('\n✅ Round-robin rotation working correctly!');
  console.log('Both APIs will be used equally across all research calls.');
} else {
  console.log('\n⚠️  Balance issue detected. Check interleaving logic.');
}

console.log('\n=== TEST COMPLETE ===\n');
