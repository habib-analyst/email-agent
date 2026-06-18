import Database from 'better-sqlite3';

const db = new Database('./data.db');

const html = `<div dir="ltr"><p>Dear Professor {{LAST_NAME}},</p><p>Greetings!</p><p>I am Habib Ur Rehman, a BS Data Analytics graduate from Government College University Faisalabad, Pakistan. My research background is in AI/ML, medical imaging, multimodal learning, deepfake detection, photovoltaic forecasting, and predictive analytics.</p><p>I am seeking an MS/PhD position relevant to my previous works:</p><p></p><ul><li style="margin-left:15px">Medical Imaging with ViT and Perceiver IO — Computational Biology and Chemistry, 2025</li><li style="margin-left:15px">GCViT and Perceiver IO for Multi-Disease Classification — Journal of Supercomputing, 2025</li><li style="margin-left:15px">Multimodal-FNet for Audio-Visual Deepfake Detection — TPAMI, 2026</li><li style="margin-left:15px">Photovoltaic Power Forecasting using Vision Transformer and Time-Series Fusion — 2026</li></ul><p></p><p>My research experiments are mainly based on CNNs, LSTM/GRU, Vision Transformers, Perceiver IO, GCViT, multimodal fusion, and time-series models using Python, PyTorch, TensorFlow, Scikit-learn, and XGBoost, as provided in my attached resume.</p><p>I am particularly interested in your work in {{INTEREST_LINE}}</p><p>I would be glad if you have any open MS/PhD or research assistant positions in your lab.</p><p>Thank you for taking the time to read this email. I look forward to your response.</p><p>Regards,<br>Habib Ur Rehman</p></div>`;

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

const subject = '[Keyword] Seeking an MS/PhD Position in Your Lab';

db.prepare(`INSERT OR REPLACE INTO template (id, raw_html, last_name_placeholder, interest_line_placeholder, instructions, sample_subject)
  VALUES (1,?,?,?,?,?)`).run(html, '{{LAST_NAME}}', '{{INTEREST_LINE}}', instructions, subject);

console.log('✓ Template updated with your content');
console.log('✓ Using exact HTML layout from your sent email');
console.log('✓ Placeholders: {{LAST_NAME}} and {{INTEREST_LINE}}');
console.log('✓ Instructions: 3 changes only (subject, last name, 3 keywords)');

db.close();
