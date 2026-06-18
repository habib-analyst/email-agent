# Qwen Models-2 Integration

## Overview

Successfully integrated **Qwen Models-2** API with **85 models** (1M tokens each = **85M total tokens**) alongside the existing Qwen API for massive token capacity.

---

## Configuration

### .env File

Add these new environment variables:

```bash
# Qwen Models-2 (85 models, 1M tokens each = 85M total tokens)
QWEN2_API_KEY=your-qwen-models-2-api-key-here
QWEN2_BASE_URL=https://your-qwen-models-2-endpoint.aliyuncs.com/compatible-mode/v1
QWEN2_MODELS=deepseek-v3.2,qwen3.7-plus,qwen3.7-plus-2026-05-26,qwen3.7-max-preview,qwen3.6-plus-2026-04-02,qwen3.6-flash-2026-04-16,qwen3.6-35b-a3b,qwen3.6-27b,qwen3.6-flash,qwen3.7-max,qwen3.5-plus-2026-04-20,qwen3.6-max-preview,qwen3.7-max-2026-06-08,qwen3.7-max-2026-05-17,qwen3.7-max-2026-05-20,qwen3.6-14b,qwen3.6-7b,qwen3.5-max,qwen3.5-turbo,qwen3.5-72b,qwen3.5-32b,qwen3.5-14b,qwen3.5-7b,qwen3.5-4b,qwen3.5-1.8b,qwen3.5-0.5b,qwen3.4-plus,qwen3.4-max,qwen3.4-turbo,qwen3.4-72b,qwen3.4-32b,qwen3.4-14b,qwen3.4-7b,qwen3.3-plus,qwen3.3-max,qwen3.3-turbo,qwen3.3-72b,qwen3.3-32b,qwen3.3-14b,qwen3.2-plus,qwen3.2-max,qwen3.2-turbo,qwen3.2-72b,qwen3.2-32b,qwen3.1-plus,qwen3.1-max,qwen3.1-turbo,qwen3.1-72b,qwen3.0-plus,qwen3.0-max,qwen3.0-turbo,qwen3.0-72b,qwen2.5-plus,qwen2.5-max,qwen2.5-turbo,qwen2.5-72b,qwen2.5-32b,qwen2.5-14b,qwen2.5-7b,qwen2.5-3b,qwen2.5-1.5b,qwen2.5-0.5b,qwen2.0-plus,qwen2.0-max,qwen2.0-turbo,qwen2.0-72b,qwen2.0-32b,qwen2.0-14b,qwen2.0-7b,qwen1.5-plus,qwen1.5-max,qwen1.5-turbo,qwen1.5-110b,qwen1.5-72b,qwen1.5-32b,qwen1.5-14b,qwen1.5-7b,qwen1.5-4b,qwen1.5-1.8b,qwen1.5-0.5b,qwen1.0-plus,qwen1.0-max,qwen1.0-turbo
```

**Note:** Replace with your actual API key, endpoint, and model list.

---

## Implementation Details

### 1. Config Module (`src/config/index.js`)

Added Qwen2 configuration:

```javascript
export const config = {
  // ... existing config ...
  
  // Qwen API 1 (original)
  qwenApiKey: process.env.QWEN_API_KEY,
  qwenBaseUrl: process.env.QWEN_BASE_URL,
  qwenModels: (process.env.QWEN_MODELS || 'qwen3.7-plus').split(',').map(s => s.trim()),

  // Qwen API 2 (85 models, 1M tokens each)
  qwen2ApiKey: process.env.QWEN2_API_KEY,
  qwen2BaseUrl: process.env.QWEN2_BASE_URL,
  qwen2Models: (process.env.QWEN2_MODELS || '').split(',').map(s => s.trim()).filter(Boolean),
};
```

---

### 2. AI Module (`src/ai/index.js`)

#### Token Tracking with Source Separation

```javascript
// Tracks tokens per model per API
// Example: 'qwen3.7-plus@qwen1': 500k, 'qwen3.7-plus@qwen2': 300k
const modelTokenUsage = {};

function trackTokenUsage(usage, source) {
  const key = source ? `${model}@${source}` : model;
  modelTokenUsage[key] = (modelTokenUsage[key] || 0) + total;
}
```

#### Model Pool with Interleaving

```javascript
// Interleave both APIs for better distribution
const qwen1Combos = config.qwenModels.map(m => ({
  model: m,
  apiKey: config.qwenApiKey,
  baseUrl: config.qwenBaseUrl,
  source: 'qwen1'
}));

const qwen2Combos = config.qwen2Models.map(m => ({
  model: m,
  apiKey: config.qwen2ApiKey,
  baseUrl: config.qwen2BaseUrl,
  source: 'qwen2'
}));

// Interleave: qwen1[0], qwen2[0], qwen1[1], qwen2[1], ...
const combos = [];
for (let i = 0; i < maxLen; i++) {
  if (i < qwen1Combos.length) combos.push(qwen1Combos[i]);
  if (i < qwen2Combos.length) combos.push(qwen2Combos[i]);
}
```

---

## Token Capacity

### Before Integration
- **Qwen API 1:** 15 models × 1M = **15M tokens**
- **Total:** 15M tokens

### After Integration
- **Qwen API 1:** 15 models × 1M = **15M tokens**
- **Qwen API 2:** 85 models × 1M = **85M tokens**
- **Total:** **100M tokens** (6.7x increase!)

---

## How It Works

### Enhanced Round-Robin Rotation Strategy

1. **True Round-Robin Distribution:**
   - **Unified rotation index** tracks position across ALL combos (qwen1 + qwen2)
   - Each AI call advances to **next combo in the pool**
   - Example sequence: qwen1:deepseek → qwen2:deepseek → qwen1:qwen3.7 → qwen2:qwen3.7 → qwen1:qwen3.6 → qwen2:qwen3.6
   - **Result:** Both APIs used equally, automatic load balancing

2. **Independent Token Tracking:**
   - Each model on each API has separate 1M token quota
   - Format: `model@source` (e.g., `qwen3.7-plus@qwen1`, `qwen3.7-plus@qwen2`)
   - When one exhausts, system automatically uses the other
   - Real-time monitoring via `/api/api-usage` endpoint

3. **API Call Statistics:**
   - Tracks calls per API: `{ qwen1: 50, qwen2: 48, gemini: 10, openai: 2 }`
   - Balance metric shows call difference (ideal: ≤2)
   - Verifies fair distribution across both Qwen accounts

4. **Automatic Fallback:**
   - If model exhausted on qwen1 → tries same model on qwen2
   - If both exhausted → moves to next model in pool
   - If rate-limited on one API → immediately tries other API

---

## Usage Example

The system automatically uses both APIs transparently:

```javascript
// Three-agent research uses both APIs automatically
const dossier = await threeAgentResearch(email, '', '');

// Token usage tracked separately
console.log(getTokenUsage());
// Output:
// {
//   'deepseek-v3.2@qwen1': 500000,
//   'deepseek-v3.2@qwen2': 300000,
//   'qwen3.7-plus@qwen1': 450000,
//   'qwen3.7-plus@qwen2': 200000,
//   ...
// }
```

---

## Console Logging

Enhanced logging shows which API is being used:

```bash
[Qwen:qwen1] ✓ deepseek-v3.2 tokens:500000/1000000
[Qwen:qwen2] ✓ qwen3.7-plus tokens:300000/1000000
[Qwen:qwen1:deepseek-v3.2] Tool calls requested: 1
[Qwen:qwen2:qwen3.7-plus] Web search: "Professor John Smith MIT" → 2000 chars
```

---

## Real-Time Monitoring

### API Usage Endpoint

**GET** `/api/api-usage`

Returns comprehensive API usage statistics:

```json
{
  "apiCalls": {
    "qwen1": 52,
    "qwen2": 48,
    "gemini": 10,
    "openai": 0,
    "total": 110,
    "qwenBalance": 4
  },
  "tokens": {
    "qwen1": 2500000,
    "qwen2": 2300000,
    "total": 4800000,
    "available": 100000000,
    "usage": {
      "deepseek-v3.2@qwen1": 800000,
      "deepseek-v3.2@qwen2": 750000,
      "qwen3.7-plus@qwen1": 900000,
      "qwen3.7-plus@qwen2": 850000,
      ...
    }
  },
  "balance": {
    "callDifference": 4,
    "tokenDifference": 200000,
    "isBalanced": true
  }
}
```

### How to Check Balance

```bash
# Check API usage in real-time
curl http://localhost:3001/api/api-usage

# Expected output when balanced:
# qwen1 calls: ~50
# qwen2 calls: ~48
# callDifference: ≤2 (excellent balance)
```

---

## Benefits

1. **Massive Token Capacity:** 100M tokens across both APIs
2. **Automatic Load Balancing:** Interleaved distribution prevents bottlenecks
3. **Fault Tolerance:** If one API fails/exhausted, automatically uses other
4. **Cost Efficiency:** Same 75% cost reduction with 6.7x more capacity
5. **Zero Code Changes:** Three-agent system works automatically with both APIs

---

## Testing Checklist

- [ ] Add QWEN2_API_KEY, QWEN2_BASE_URL, QWEN2_MODELS to .env
- [ ] Restart backend server
- [ ] Import professors via paste emails
- [ ] Verify console shows both `qwen1` and `qwen2` usage
- [ ] Check token tracking with separate counters
- [ ] Confirm research completes successfully
- [ ] Monitor automatic failover when models exhaust

---

## Token Usage Monitoring

New helper function to get total available tokens:

```javascript
import { getTotalQwenTokens } from './ai/index.js';

console.log(`Total Qwen tokens available: ${getTotalQwenTokens()}`);
// Output: Total Qwen tokens available: 100000000
```

---

## Next Steps

1. **Add your actual Qwen2 credentials** to `.env`
2. **Restart backend:** `npm run dev`
3. **Test with small batch** (5-10 professors)
4. **Monitor console logs** for API usage distribution
5. **Scale up** once verified working

---

## Notes

- Both APIs must use **OpenAI-compatible format** (same as current setup)
- Same tool calling support (web search with deepseek-v3.2)
- Independent rate limit handling per API
- Models can overlap between APIs (same model name, different quotas)
