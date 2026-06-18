import { useEffect, useRef } from 'react';

/** Scroll to the step that needs attention on page load. */
export default function useResumeStep({ duplicateCount, awaitingCount, failedCount, refs }) {
  const didScroll = useRef(false);

  useEffect(() => {
    if (didScroll.current) return;
    const { duplicateRef, templateRef, importRef, queueRef } = refs || {};
    if (duplicateCount > 0 && duplicateRef?.current) {
      duplicateRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (awaitingCount > 0 && templateRef?.current) {
      templateRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (failedCount > 0 && queueRef?.current) {
      queueRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (importRef?.current) {
      // default: stay at import if empty
    }
    didScroll.current = true;
  }, [duplicateCount, awaitingCount, failedCount, refs]);
}
