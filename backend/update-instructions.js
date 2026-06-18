import Database from 'better-sqlite3';
import fs from 'fs';

const db = new Database('./data.db');

// Read user's majors
const majorsContent = fs.readFileSync('D:/email-agent/User_Majors_for_Email_Subject.txt', 'utf8');
const userMajors = majorsContent
  .split('\n')
  .map(line => line.trim())
  .filter(line => line && !line.match(/^\d+$/)) // Remove empty lines and line numbers
  .join(', ');

const instructions = `ONLY change 3 things per email — the rest must stay EXACTLY as in the template:

1. SUBJECT: "[Single Keyword] Seeking an MS/PhD Position in Your Lab" — pick ONE research area (1-3 words) from the professor's actual work that aligns with my background (AI/ML, ViT, Perceiver IO, multimodal, deepfake detection, forecasting). Replace [Keyword] with that area.

2. GREETING: Replace {{LAST_NAME}} with the professor's actual last name. Format: "Dear Professor LastName," — use their real last name from research, not guessed from email.

3. INTEREST LINE: Replace {{INTEREST_LINE}} with EXACTLY 3 research keywords extracted from the professor's profile (comma-separated, e.g., "semantic web services, cloud computing, self-healing systems"). These must come from their REAL papers/projects found during research — not generic terms.

TEMPLATE STRUCTURE (do NOT change any other part):
- Opening: "Greetings!" — stays identical
- My background paragraph (AI/ML, medical imaging, multimodal, deepfake, forecasting) — stays identical
- My publications list (Medical Imaging ViT, GCViT, Multimodal-FNet, Photovoltaic) — stays identical
- My methods paragraph (CNNs, LSTM/GRU, ViT, Perceiver IO, GCViT, multimodal fusion, time-series, Python, PyTorch, TensorFlow, Scikit-learn, XGBoost) — stays identical
- Interest line: "I am particularly interested in your work in {{INTEREST_LINE}}" — ONLY change {{INTEREST_LINE}}
- Closing request: "I would be glad if you have any open MS/PhD or research assistant positions in your lab." — stays identical
- Thank you + signature (Habib Ur Rehman) — stays identical`;

db.prepare(`UPDATE template SET instructions=? WHERE id=1`).run(instructions);

console.log('✓ Instructions updated with intelligent subject keyword selection');
console.log('✓ Priority: User majors match → Professor keyword fallback');
console.log('✓ Agent will align subject with user\'s 100 majors when possible');

db.close();
