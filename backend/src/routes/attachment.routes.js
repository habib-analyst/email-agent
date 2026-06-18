import { Router } from 'express';
import multer from 'multer';
import { extname, resolve } from 'path';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import db, { getActiveWorkspace } from '../db/index.js';
import { requireGmail } from '../middleware/requireGmail.js';
import { settingsForClient } from '../services/senderIdentity.js';
import { AuthService } from '../services/AuthService.js';

const router = Router();
const ALLOWED = new Map([
  ['application/pdf', '.pdf'],
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
]);

function uploadsDir() {
  return resolve(getActiveWorkspace().path, '..', 'uploads');
}

function adminDefaultResume() {
  const directory = resolve(import.meta.dirname, '../../../Resume');
  try {
    const files = readdirSync(directory);
    const preferred = files.find(file => /habib/i.test(file) && file.toLowerCase().endsWith('.pdf'));
    const fallback = files.find(file => file.toLowerCase().endsWith('.pdf'));
    return preferred || fallback ? resolve(directory, preferred || fallback) : null;
  } catch {
    return null;
  }
}

const storage = multer.diskStorage({
  destination(req, file, callback) {
    const dir = uploadsDir();
    mkdirSync(dir, { recursive: true });
    callback(null, dir);
  },
  filename(req, file, callback) {
    const extension = ALLOWED.get(file.mimetype) || extname(file.originalname).toLowerCase();
    callback(null, `email-attachment-${Date.now()}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(req, file, callback) {
    if (!ALLOWED.has(file.mimetype)) {
      return callback(new Error('Only PDF, PNG, JPG, JPEG, or WebP files are allowed'));
    }
    callback(null, true);
  },
});

function uploadSingle(req, res, next) {
  upload.single('file')(req, res, error => {
    if (error) return res.status(400).json({ error: error.message || 'Attachment upload failed' });
    next();
  });
}

router.post('/settings/attachment', requireGmail, uploadSingle, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a PDF or image to upload' });
  const existing = db.prepare('SELECT resume_path FROM settings WHERE id=1').get()?.resume_path;
  db.prepare('UPDATE settings SET resume_path=? WHERE id=1').run(req.file.path);
  if (existing && existing !== req.file.path && existing.startsWith(uploadsDir()) && existsSync(existing)) {
    rmSync(existing, { force: true });
  }
  const settings = db.prepare('SELECT * FROM settings WHERE id=1').get();
  res.json({ success: true, settings: settingsForClient(settings) });
});

router.delete('/settings/attachment', requireGmail, (req, res) => {
  const existing = db.prepare('SELECT resume_path FROM settings WHERE id=1').get()?.resume_path;
  if (existing && existing.startsWith(uploadsDir()) && existsSync(existing)) {
    rmSync(existing, { force: true });
  }
  const restored = AuthService.getStatus().isAdmin ? adminDefaultResume() : null;
  db.prepare('UPDATE settings SET resume_path=? WHERE id=1').run(restored);
  const settings = db.prepare('SELECT * FROM settings WHERE id=1').get();
  res.json({ success: true, settings: settingsForClient(settings) });
});

export default router;
