/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BackupReconciliationReport } from '../types';
import { formatINR } from '../utils/accounting';
import { AlertTriangle, CheckCircle2, Info, Scale } from 'lucide-react';

interface BackupReconciliationCardProps {
  report?: BackupReconciliationReport;
}

export const BackupReconciliationCard: React.FC<BackupReconciliationCardProps> = ({ report }) => {
  if (!report) return null;

  const { customerSummary, supplierSummary, cashbookSummary, inventorySummary, issues } = report;
  const driftedCustomers = customerSummary.driftedCustomers || [];
  const driftedSuppliers = supplierSummary.driftedSuppliers || [];
  const hasDiscrepancies =
    report.hasDiscrepancies || driftedCustomers.length > 0 || driftedSuppliers.length > 0 || issues.length > 0;
  const totalCheckCount = issues.length + driftedCustomers.length + driftedSuppliers.length;

  return (
    <div
      data-testid="backup-reconciliation-card"
      className={`rounded-xl border p-3.5 space-y-3 text-xs ${
        hasDiscrepancies
          ? 'bg-amber-50/90 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800'
          : 'bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800'
      }`}
    >
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Scale
            className={`w-4 h-4 shrink-0 ${
              hasDiscrepancies
                ? 'text-amber-700 dark:text-amber-400'
                : 'text-emerald-700 dark:text-emerald-400'
            }`}
          />
          <div>
            <div className="font-bold text-slate-900 dark:text-slate-100">
              Pre-Restore Financial Reconciliation Report
            </div>
            <div className="text-[11px] text-slate-600 dark:text-slate-300">
              Verified from opening balances &amp; actual transaction ledgers ({inventorySummary.attachmentsTotalCount} attachment{inventorySummary.attachmentsTotalCount === 1 ? '' : 's'}) before committing changes.
            </div>
          </div>
        </div>

        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${
            hasDiscrepancies
              ? 'bg-amber-200/80 dark:bg-amber-900 text-amber-950 dark:text-amber-200'
              : 'bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200'
          }`}
        >
          {hasDiscrepancies ? (
            <>
              <AlertTriangle className="w-3 h-3" />
              <span>{totalCheckCount} Check(s) Found</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="w-3 h-3" />
              <span>All Ledgers Balanced</span>
            </>
          )}
        </span>
      </div>

      {/* 3-Column Financial Reconciliation Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="bg-white dark:bg-slate-900 rounded-lg p-2.5 border border-slate-200/80 dark:border-slate-700">
          <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">
            Customer Udhar Total
          </div>
          <div className="font-bold text-slate-900 dark:text-slate-100 mt-0.5">
            {formatINR(customerSummary.recalculatedTotalOutstanding)}
          </div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
            {driftedCustomers.length > 0 ? (
              <span className="text-amber-700 dark:text-amber-400 font-semibold">
                File stored {formatINR(customerSummary.storedTotalOutstanding)} ({driftedCustomers.length} drift)
              </span>
            ) : (
              <span>Matches stored balance cleanly</span>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-lg p-2.5 border border-slate-200/80 dark:border-slate-700">
          <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">
            Supplier Payable Total
          </div>
          <div className="font-bold text-slate-900 dark:text-slate-100 mt-0.5">
            {formatINR(supplierSummary.recalculatedTotalPayable)}
          </div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
            {driftedSuppliers.length > 0 ? (
              <span className="text-amber-700 dark:text-amber-400 font-semibold">
                File stored {formatINR(supplierSummary.storedTotalPayable)} ({driftedSuppliers.length} drift)
              </span>
            ) : (
              <span>Matches stored balance cleanly</span>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-lg p-2.5 border border-slate-200/80 dark:border-slate-700">
          <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">
            Cashbook Closing (Rokad)
          </div>
          <div className="font-bold text-slate-900 dark:text-slate-100 mt-0.5">
            {formatINR(cashbookSummary.closingBalance)}
          </div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
            Open {formatINR(cashbookSummary.openingBalance)} · +{formatINR(cashbookSummary.totalInflowsExcludingOpening)} / -{formatINR(cashbookSummary.totalOutflows)}
          </div>
        </div>
      </div>

      {/* Discrepancy & Auto-Reconciliation Details */}
      {(driftedCustomers.length > 0 || driftedSuppliers.length > 0) && (
        <div className="bg-white/90 dark:bg-slate-900/80 rounded-lg p-2.5 border border-amber-200 dark:border-amber-800 space-y-1.5">
          <div className="text-[11px] font-bold text-amber-950 dark:text-amber-200 flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span>
              Balance Drift Detected — Confirming restore will automatically recalculate these balances from ledger history:
            </span>
          </div>
          <div className="max-h-28 overflow-y-auto space-y-1 text-[11px] text-slate-700 dark:text-slate-300">
            {driftedCustomers.map((d) => (
              <div key={d.customerId} className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">Customer: {d.customerName}</span>
                <span className="font-mono text-[10px] shrink-0">
                  {formatINR(d.storedBalance)} → <strong className="text-emerald-700 dark:text-emerald-400">{formatINR(d.recalculatedBalance)}</strong>
                </span>
              </div>
            ))}
            {driftedSuppliers.map((d) => (
              <div key={d.supplierId} className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">Supplier: {d.supplierName}</span>
                <span className="font-mono text-[10px] shrink-0">
                  {formatINR(d.storedBalance)} → <strong className="text-emerald-700 dark:text-emerald-400">{formatINR(d.recalculatedBalance)}</strong>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {report.issues.length > 0 && (
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {report.issues.map((issue, idx) => (
            <div
              key={`${issue.code}-${idx}`}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] flex items-start gap-2 border ${
                issue.severity === 'CRITICAL'
                  ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200'
                  : 'bg-amber-100/70 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800 text-amber-950 dark:text-amber-200'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{issue.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
