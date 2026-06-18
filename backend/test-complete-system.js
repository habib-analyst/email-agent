// Complete System Test
import { config } from './src/config/index.js';
import { callAI } from './src/ai/index.js';
import { threeAgentResearch } from './src/research/threeAgentResearch.js';
import { importEmailsToSheet, verifySheetComplete } from './src/workflow/sheetWorkflow.js';
import { readRosterExcel } from './src/learning/rosterExcel.js';

console.log('\n' + '='.repeat(70));
console.log('  COMPLETE SYSTEM TEST');
console.log('='.repeat(70) + '\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`❌ FAIL: ${name}`);
    console.error(`   Error: ${e.message}`);
    failed++;
  }
}

console.log('--- 1. Configuration Tests ---\n');

test('Config loaded', () => {
  if (!config) throw new Error('Config is undefined');
  if (!config.qwenApiKey) throw new Error('Qwen API key missing');
  if (!config.qwen2ApiKey) throw new Error('Qwen2 API key missing');
});

test('Qwen API 1 configured', () => {
  if (!config.qwenModels || config.qwenModels.length === 0) {
    throw new Error('No Qwen1 models configured');
  }
  if (!config.qwenModels.includes('deepseek-v3.2')) {
    throw new Error('deepseek-v3.2 not in Qwen1 models');
  }
});

test('Qwen API 2 configured', () => {
  if (!config.qwen2Models || config.qwen2Models.length === 0) {
    throw new Error('No Qwen2 models configured');
  }
});

console.log('\n--- 2. Module Import Tests ---\n');

test('callAI exported', () => {
  if (typeof callAI !== 'function') {
    throw new Error('callAI is not a function');
  }
});

test('threeAgentResearch exported', () => {
  if (typeof threeAgentResearch !== 'function') {
    throw new Error('threeAgentResearch is not a function');
  }
});

test('importEmailsToSheet exported', () => {
  if (typeof importEmailsToSheet !== 'function') {
    throw new Error('importEmailsToSheet is not a function');
  }
});

test('verifySheetComplete exported', () => {
  if (typeof verifySheetComplete !== 'function') {
    throw new Error('verifySheetComplete is not a function');
  }
});

test('readRosterExcel exported', () => {
  if (typeof readRosterExcel !== 'function') {
    throw new Error('readRosterExcel is not a function');
  }
});

console.log('\n--- 3. Excel Sheet Tests ---\n');

test('Excel sheet can be read', () => {
  const sheet = readRosterExcel();
  if (!Array.isArray(sheet)) {
    throw new Error('Sheet is not an array');
  }
  console.log(`   Current rows: ${sheet.length}`);
});

test('Sheet verification works', () => {
  const result = verifySheetComplete();
  if (!result || typeof result !== 'object') {
    throw new Error('verifySheetComplete returned invalid result');
  }
  if (typeof result.total !== 'number') {
    throw new Error('Result missing total count');
  }
  console.log(`   Total: ${result.total}, Complete: ${result.complete}, Incomplete: ${result.incomplete}`);
});

console.log('\n--- 4. API Assignment Tests ---\n');

test('deepseek on Qwen API 1', () => {
  const qwen1Models = config.qwenModels;
  if (!qwen1Models.includes('deepseek-v3.2')) {
    throw new Error('deepseek-v3.2 not assigned to Qwen API 1');
  }
  console.log('   Agent 1: deepseek-v3.2 on Qwen API 1 ✓');
});

test('Qwen 3.7 models on Qwen API 2', () => {
  const qwen2Models = config.qwen2Models;
  const hasQwen37 = qwen2Models.some(m => m.includes('qwen3.7') || m.includes('qwen3.6'));
  if (!hasQwen37) {
    throw new Error('No Qwen 3.7/3.6 models on Qwen API 2');
  }
  console.log('   Agent 2: Qwen 3.7 models on Qwen API 2 ✓');
});

console.log('\n' + '='.repeat(70));
console.log('  TEST RESULTS');
console.log('='.repeat(70) + '\n');

console.log(`Total Tests: ${passed + failed}`);
console.log(`Passed: ${passed} ✅`);
console.log(`Failed: ${failed} ❌`);
console.log(`Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%\n`);

if (failed === 0) {
  console.log('🎉 ALL TESTS PASSED! 🎉\n');
  console.log('System is ready for use.\n');
  console.log('Next steps:');
  console.log('1. Start backend: npm run dev');
  console.log('2. Test import: POST /api/sheet/import-emails');
  console.log('3. Monitor sheet: GET /api/sheet/status\n');
} else {
  console.log('⚠️  SOME TESTS FAILED ⚠️\n');
  console.log('Please review the failed tests above.\n');
  process.exit(1);
}

console.log('='.repeat(70) + '\n');
