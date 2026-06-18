import React, { useEffect, useState } from 'react';
import { Zap, Loader2 } from 'lucide-react';
import { get, post } from '../api.js';
import { useToast } from './Toast.jsx';

export default function CampaignPresets({ onApplied, className = '' }) {
  const toast = useToast();
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(null);

  useEffect(() => {
    get('/campaign-presets').then(r => setPresets(r.presets || [])).catch(() => {});
  }, []);

  const apply = async (id) => {
    setLoading(id);
    try {
      const res = await post('/campaign-presets/apply', { presetId: id });
      toast.success(`Applied: ${res.preset?.name || id}`);
      onApplied?.(res);
    } catch (e) {
      toast.error(e.message || 'Could not apply preset');
    } finally {
      setLoading(null);
    }
  };

  if (!presets.length) return null;

  return (
    <div className={`space-y-2 ${className}`}>
      <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">Campaign presets</p>
      <div className="flex flex-wrap gap-2">
        {presets.map(p => (
          <button
            key={p.id}
            type="button"
            disabled={loading === p.id}
            onClick={() => apply(p.id)}
            title={p.description}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-neutral-700 text-[11px] font-medium hover:bg-gray-50 dark:hover:bg-neutral-800 transition-colors"
          >
            {loading === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3 text-brand-500" />}
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}
