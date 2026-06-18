import React from 'react';
import { Globe, Search } from 'lucide-react';

/** Info panel — web search tokens are only used when the user clicks Web Search on a row. */
export default function ImportWebSearchToggle({ className = '' }) {
  return (
    <div className={`rounded-xl border border-gray-200 bg-gray-50/80 dark:border-neutral-700 dark:bg-neutral-800/50 p-3 ${className}`}>
      <div className="flex items-start gap-2.5 min-w-0">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-gray-200 dark:bg-neutral-700 text-gray-500">
          <Globe className="w-4 h-4" />
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-900 dark:text-gray-100">Profile-first research (no search tokens)</p>
          <p className="text-[10px] text-muted mt-1 leading-relaxed">
            Subject keyword and interest line are built from scraped faculty page data using local combination rules — accurate and token-free.
            If a profile has no research on the page, the table shows <strong>No info on page</strong>; click <strong>Web Search</strong> on that row to search the internet (uses API tokens).
          </p>
          <p className="mt-2 text-[10px] text-sky-700 dark:text-sky-300 flex items-center gap-1">
            <Search className="w-3 h-3" /> Internet search runs only when you trigger it per professor.
          </p>
        </div>
      </div>
    </div>
  );
}
