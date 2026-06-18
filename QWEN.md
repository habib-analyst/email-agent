# QWEN.md — Project Instructions Index

All instruction and documentation .md files for this project are stored in the **`.md files/`** folder at the project root.

## Canonical Paths

When an agent, tool, or instruction needs to reference project documentation, use these paths:

- **AGENTS.md** → `D:\email-agent\.md files\AGENTS.md` (also copied at root for auto-discovery)
- **CLAUDE.md** → `D:\email-agent\.md files\CLAUDE.md`
- **AGENT_FLOW.md** → `D:\email-agent\.md files\AGENT_FLOW.md`
- **COMPLETE_SYSTEM_FLOW.md** → `D:\email-agent\.md files\COMPLETE_SYSTEM_FLOW.md`
- **EMAIL_AGENT_PLAN.md** → `D:\email-agent\.md files\EMAIL_AGENT_PLAN.md`
- **INSTANT_FLOW.md** → `D:\email-agent\.md files\INSTANT_FLOW.md`
- **API_VERIFICATION_REPORT.md** → `D:\email-agent\.md files\API_VERIFICATION_REPORT.md`

## API Keys

API keys are stored in the **`API-Keys/`** folder (excluded from git):

- **Qwen** → `API-Keys/Qwen API/Qwen-API-{1,2,3}.txt`
- **Gemini** → `API-Keys/Gemini API/Geimini-API -{1,2,3}.txt`
- **OpenAI** → `API-Keys/Openapi API/Openai-API -1.txt`

The backend parses these files at startup via `backend/src/config/loadApiKeys.js`.
