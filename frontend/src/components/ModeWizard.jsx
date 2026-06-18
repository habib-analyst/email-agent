import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, ChevronRight } from 'lucide-react';
import { post } from '../api.js';
import { useToast } from './Toast.jsx';

const QUESTIONS = [
  {
    id: 'size',
    prompt: 'How many professors?',
    options: [
      { id: 'small', label: '1–20 (careful, personalized)', preset: 'deep_instant', route: '/instant' },
      { id: 'large', label: '50+ (fast outreach)', preset: 'express_basic', route: '/basic-instant' },
    ],
  },
  {
    id: 'timing',
    prompt: 'When to send?',
    options: [
      { id: 'now', label: 'Immediately', route: null },
      { id: 'later', label: 'Schedule for later', preset: 'scheduled_wave', route: '/scheduled' },
    ],
  },
];

export default function ModeWizard({ className = '' }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});

  const finish = async () => {
    const size = answers.size;
    const timing = answers.timing;
    let preset = 'express_basic';
    let route = '/basic-instant';
    if (size === 'small') { preset = 'deep_instant'; route = '/instant'; }
    if (timing === 'later') { preset = 'scheduled_wave'; route = '/scheduled'; }
    try {
      await post('/campaign-presets/apply', { presetId: preset });
      toast.success('Campaign preset applied');
    } catch { /* optional */ }
    navigate(route);
    setOpen(false);
    setStep(0);
    setAnswers({});
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-500 to-violet-600 text-white text-sm font-semibold shadow-md hover:opacity-95 transition-opacity ${className}`}
      >
        <Sparkles className="w-4 h-4" /> Start wizard
      </button>
    );
  }

  const q = QUESTIONS[step];
  return (
    <div className={`card p-5 space-y-4 border-brand-200 dark:border-brand-800 ${className}`}>
      <p className="text-sm font-semibold">{q.prompt}</p>
      <div className="space-y-2">
        {q.options.map(opt => (
          <button
            key={opt.id}
            type="button"
            onClick={() => {
              const next = { ...answers, [q.id]: opt.id };
              setAnswers(next);
              if (step < QUESTIONS.length - 1) setStep(step + 1);
              else {
                setAnswers(next);
                finish();
              }
            }}
            className="w-full flex items-center justify-between p-3 rounded-xl border border-gray-200 dark:border-neutral-700 hover:border-brand-400 text-left text-sm transition-colors"
          >
            {opt.label}
            <ChevronRight className="w-4 h-4 text-gray-400" />
          </button>
        ))}
      </div>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-500">Cancel</button>
    </div>
  );
}
