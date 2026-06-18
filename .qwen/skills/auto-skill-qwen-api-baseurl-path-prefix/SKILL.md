---
name: qwen-api-baseurl-path-prefix
description: Qwen OpenAI-compatible endpoints require the full /compatible-mode/v1 path in baseUrl — stripping it causes all model calls to 404
source: auto-skill
extracted_at: '2026-06-13T23:46:18.911Z'
---

# Qwen API BaseUrl Path Prefix — Never Strip It

When parsing Qwen API key files that contain an "OpenAI Compatible Endpoint" URL, **never strip the `/compatible-mode/v1` path prefix**. The full path is required for all chat completion calls.

## The Bug (all models returning 404)

The `parseQwenFile()` function stripped `/compatible-mode/v1` from the endpoint URL, producing a bare hostname like `https://host.aliyuncs.com`. Then `sendEmail` and all AI calls constructed URLs like `https://host.aliyuncs.com/chat/completions` — which returns 404 because the Qwen API requires the full path `https://host.aliyuncs.com/compatible-mode/v1/chat/completions`.

```js
// BROKEN — strips required path prefix:
const baseUrl = content.match(/OpenAI Compatible Endpoint:\s*(.+)/)?.[1]?.trim()?.replace('/compatible-mode/v1', '');
// Result: https://llm-k80l1ek1ahd616b9.ap-southeast-1.maas.aliyuncs.com
// API call URL: baseUrl + '/chat/completions' → 404

// CORRECT — keep full path:
const baseUrl = content.match(/OpenAI Compatible Endpoint:\s*(.+)/)?.[1]?.trim();
// Result: https://llm-k80l1ek1ahd616b9.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
// API call URL: baseUrl + '/chat/completions' → 200 OK
```

## How to Diagnose

1. All Qwen models return `Request failed with status code 404` in logs
2. Gemini/OpenAI fallbacks work (different endpoint format)
3. The `/compatible-mode/v1/models` endpoint works when called with the full URL
4. Individual chat completion calls fail with 404

## Verification

Test the endpoint directly:
```bash
curl -s "https://HOST/compatible-mode/v1/models" -H "Authorization: Bearer KEY"
# Should return model list (200)

curl -s "https://HOST/compatible-mode/v1/chat/completions" -H "Authorization: Bearer KEY" -H "Content-Type: application/json" -d '{"model":"qwen3.6-flash","messages":[{"role":"user","content":"test"}],"max_tokens":5}'
# Should return chat completion (200)
```

## Why It Happens

The Qwen Maas (Model as a Service) platform uses `/compatible-mode/v1` as a routing prefix that distinguishes OpenAI-compatible calls from their native DashScope API. Without this prefix, the request reaches the default API path which doesn't handle OpenAI-format requests.

## When to Apply

- Any Qwen/Aliyun Maas API integration
- Any OpenAI-compatible endpoint parser that might "clean up" the URL by stripping versioned paths
- After updating API key file parsers, always verify with a live curl test
