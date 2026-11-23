/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, LifeBuoy } from 'lucide-react';

export const ExternalRecoveryGuide: React.FC = () => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-emerald-200/80 dark:border-emerald-900/60 bg-white dark:bg-slate-900 overflow-hidden">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full px-4 py-3 flex items-center justify-between gap-2 text-left hover:bg-emerald-50/50 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2 text-xs font-bold text-emerald-950 dark:text-emerald-100">
          <LifeBuoy className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
          <span>Phone &amp; Browser Data Recovery Guide (If Android Site Data Is Cleared)</span>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-3.5 pt-1 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-300 space-y-2 leading-relaxed">
          <p>
            <strong className="text-slate-800 dark:text-slate-100">1. Keep an external copy:</strong> Save a{' '}
            <code className="font-mono text-emerald-800 dark:text-emerald-300">.json</code> or{' '}
            <code className="font-mono text-emerald-800 dark:text-emerald-300">.skbackup.json</code> Full Recovery
            file regularly to Google Drive, Downloads, or your WhatsApp Saved Messages using{' '}
            <strong>Share (Android)</strong>. Clearing Android Chrome site data or uninstalling removes local IndexedDB data.
          </p>
          <p>
            <strong className="text-slate-800 dark:text-slate-100">2. Restore after data loss or phone change:</strong>{' '}
            Open <strong>Settings → Backup &amp; Local DB → Choose Full Backup (.json)</strong>, select your latest saved{' '}
            <code className="font-mono">.json</code> or <code className="font-mono">.skbackup.json</code> archive, review
            the Pre-Restore Reconciliation Report, and tap <strong>Confirm Restore</strong>. All customers, Udhar, inventory,
            cashbook entries, and bill photos/PDFs restore immediately.
          </p>
          <p>
            <strong className="text-slate-800 dark:text-slate-100">3. Security PIN note:</strong> Plaintext PINs are never
            exported inside backup files. If you restore onto a fresh phone with Screen Lock enabled, Arjun Groceries will
            ask you to set a new 4-digit PIN right away.
          </p>
        </div>
      )}
    </div>
  );
};
