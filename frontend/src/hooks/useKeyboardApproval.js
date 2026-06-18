import { useEffect } from 'react';

/** A = approve, R = reject, ArrowRight = next — when approval panel focused. */
export default function useKeyboardApproval({ items, onApprove, onReject, onNext, enabled = true }) {
  useEffect(() => {
    if (!enabled || !items?.length) return;

    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      const item = items[0];
      if (!item) return;

      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        onApprove?.(item);
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        onReject?.(item);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        onNext?.();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [items, onApprove, onReject, onNext, enabled]);
}
