/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { useStore } from '../context/StoreContext';
import { BillAttachment } from '../types';
import { formatINR } from '../utils/accounting';
import { downloadDataUrlAsBlobFile } from '../utils/androidDownload';
import { formatFileSize } from '../utils/documentStorage';
import { BillViewerModal } from './BillViewerModal';
import {
  FileText,
  Image as ImageIcon,
  Search,
  Filter,
  Download,
  Eye,
  Calendar,
  FolderOpen,
  ArrowUpRight,
  ArrowDownLeft,
  ShoppingCart,
  Truck,
  Wallet,
  Users,
} from 'lucide-react';

interface UnifiedDocument {
  id: string;
  attachment: BillAttachment;
  category: 'SALE' | 'PURCHASE' | 'EXPENSE' | 'PAYMENT' | 'CASHBOOK';
  title: string;
  partyName: string;
  date: string;
  amount?: number;
  invoiceNo?: string;
  allAttachments: BillAttachment[];
}

export const BillDocumentsView: React.FC = () => {
  const {
    sales,
    customerTransactions,
    supplierTransactions,
    expenses,
    cashbookEntries,
    customers,
    suppliers,
    billDocuments,
  } = useStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'SALE' | 'PURCHASE' | 'EXPENSE' | 'PAYMENT'>('ALL');
  const [activeViewer, setActiveViewer] = useState<{
    attachments: BillAttachment[];
    title: string;
    subtitle: string;
  } | null>(null);

  // Aggregate all attachments across the store database + standalone billDocuments
  const allDocuments = useMemo<UnifiedDocument[]>(() => {
    const docs: UnifiedDocument[] = [];
    const billDocMap = new Map<string, BillAttachment>();
    for (const bd of billDocuments || []) {
      if (bd && bd.id) {
        billDocMap.set(bd.id, bd);
      }
    }

    const resolveAttachment = (att: BillAttachment): BillAttachment => {
      if (att.dataUrl && att.dataUrl.trim().length > 0) return att;
      const fromVault = billDocMap.get(att.id);
      return fromVault && fromVault.dataUrl ? { ...att, dataUrl: fromVault.dataUrl } : att;
    };

    const resolveList = (list?: BillAttachment[]): BillAttachment[] =>
      (list || []).map(resolveAttachment);

    const seenAttachmentIds = new Set<string>();

    // 1. Sales attachments
    sales.forEach((s) => {
      if (s.attachments && s.attachments.length > 0) {
        const hydratedList = resolveList(s.attachments);
        hydratedList.forEach((att) => {
          seenAttachmentIds.add(att.id);
          docs.push({
            id: `${s.id}-${att.id}`,
            attachment: att,
            category: 'SALE',
            title: `Sale Bill #${s.invoiceNo}`,
            partyName: s.customerName || 'Walk-in Customer',
            date: s.date,
            amount: s.amount,
            invoiceNo: s.invoiceNo,
            allAttachments: hydratedList,
          });
        });
      }
    });

    // 2. Customer payment attachments
    customerTransactions.forEach((ct) => {
      if (ct.attachments && ct.attachments.length > 0) {
        const cust = customers.find((c) => c.id === ct.customerId);
        const hydratedList = resolveList(ct.attachments);
        hydratedList.forEach((att) => {
          seenAttachmentIds.add(att.id);
          docs.push({
            id: `${ct.id}-${att.id}`,
            attachment: att,
            category: ct.type === 'PAYMENT' ? 'PAYMENT' : 'SALE',
            title: ct.type === 'PAYMENT' ? 'Customer Payment Jama' : 'Udhar Sale Slip',
            partyName: cust?.name || 'Customer',
            date: ct.date,
            amount: ct.amount,
            invoiceNo: ct.invoiceNo,
            allAttachments: hydratedList,
          });
        });
      }
    });

    // 3. Supplier purchase & payment attachments
    supplierTransactions.forEach((st) => {
      if (st.attachments && st.attachments.length > 0) {
        const supp = suppliers.find((sp) => sp.id === st.supplierId);
        const hydratedList = resolveList(st.attachments);
        hydratedList.forEach((att) => {
          seenAttachmentIds.add(att.id);
          docs.push({
            id: `${st.id}-${att.id}`,
            attachment: att,
            category: st.type === 'PURCHASE' ? 'PURCHASE' : 'PAYMENT',
            title: st.type === 'PURCHASE' ? `Supplier Purchase Bill` : `Supplier Payout Slip`,
            partyName: supp?.name || 'Supplier',
            date: st.date,
            amount: st.amount,
            invoiceNo: st.invoiceNo,
            allAttachments: hydratedList,
          });
        });
      }
    });

    // 4. Expenses attachments
    expenses.forEach((e) => {
      if (e.attachments && e.attachments.length > 0) {
        const hydratedList = resolveList(e.attachments);
        hydratedList.forEach((att) => {
          seenAttachmentIds.add(att.id);
          docs.push({
            id: `${e.id}-${att.id}`,
            attachment: att,
            category: 'EXPENSE',
            title: `Expense Receipt: ${e.title}`,
            partyName: e.category,
            date: e.date,
            amount: e.amount,
            allAttachments: hydratedList,
          });
        });
      }
    });

    // 5. Cashbook attachments
    cashbookEntries.forEach((cb) => {
      if (cb.attachments && cb.attachments.length > 0) {
        const hydratedList = resolveList(cb.attachments);
        hydratedList.forEach((att) => {
          if (!seenAttachmentIds.has(att.id)) {
            seenAttachmentIds.add(att.id);
            docs.push({
              id: `${cb.id}-${att.id}`,
              attachment: att,
              category: 'CASHBOOK',
              title: `Rokad Voucher: ${cb.description}`,
              partyName: cb.category,
              date: cb.date,
              amount: cb.amount,
              allAttachments: hydratedList,
            });
          }
        });
      }
    });

    // 6. Standalone or restored vault documents not linked directly to an active transaction
    (billDocuments || []).forEach((bd) => {
      if (!bd || !bd.id || seenAttachmentIds.has(bd.id)) return;
      seenAttachmentIds.add(bd.id);
      const mappedCategory: UnifiedDocument['category'] =
        bd.transactionType === 'PURCHASE'
          ? 'PURCHASE'
          : bd.transactionType === 'EXPENSE'
          ? 'EXPENSE'
          : bd.transactionType === 'CUSTOMER_PAYMENT' || bd.transactionType === 'SUPPLIER_PAYMENT'
          ? 'PAYMENT'
          : bd.transactionType === 'CASHBOOK'
          ? 'CASHBOOK'
          : 'SALE';
      docs.push({
        id: `vault-${bd.id}`,
        attachment: bd,
        category: mappedCategory,
        title: bd.name || 'Archived Bill Document',
        partyName: bd.ocrData?.partyName || 'Vault Archive',
        date: (bd.uploadedAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
        amount: bd.ocrData?.totalAmount,
        invoiceNo: bd.ocrData?.billNumber,
        allAttachments: [bd],
      });
    });

    // Sort newest first
    return docs.sort(
      (a, b) =>
        new Date(b.attachment.uploadedAt || b.date).getTime() -
        new Date(a.attachment.uploadedAt || a.date).getTime()
    );
  }, [sales, customerTransactions, supplierTransactions, expenses, cashbookEntries, customers, suppliers, billDocuments]);

  // Filter documents
  const filteredDocs = useMemo(() => {
    return allDocuments.filter((doc) => {
      if (typeFilter !== 'ALL' && doc.category !== typeFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = doc.title.toLowerCase().includes(q);
        const matchParty = doc.partyName.toLowerCase().includes(q);
        const matchInvoice = doc.invoiceNo ? doc.invoiceNo.toLowerCase().includes(q) : false;
        const matchFileName = doc.attachment.name.toLowerCase().includes(q);
        if (!matchTitle && !matchParty && !matchInvoice && !matchFileName) return false;
      }
      return true;
    });
  }, [allDocuments, typeFilter, searchQuery]);

  return (
    <div className="space-y-4 pb-12">
      {/* Top Header */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        <div>
          <div className="text-xs uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wide flex items-center gap-1.5">
            <FolderOpen className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
            <span>Digital Bill &amp; Document Management (Bill Receipt &amp; Parchi)</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-0.5">
            Bill Documents Archive
          </h2>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Search, preview, zoom, rotate and download physical bills, supplier invoices and payment receipts attached to your transactions.
          </div>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <span className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs font-bold border border-emerald-200 dark:border-emerald-800">
            {allDocuments.length} Bills Archived
          </span>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by customer, supplier, bill # or file name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {[
            { id: 'ALL', label: 'All Bills' },
            { id: 'SALE', label: 'Sales' },
            { id: 'PURCHASE', label: 'Purchases' },
            { id: 'EXPENSE', label: 'Expenses' },
            { id: 'PAYMENT', label: 'Payments' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTypeFilter(tab.id as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                typeFilter === tab.id
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Documents Grid */}
      {filteredDocs.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-12 text-center border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 flex items-center justify-center mx-auto">
            <FolderOpen className="w-6 h-6" />
          </div>
          <h4 className="font-bold text-slate-900 dark:text-slate-100 text-base">No Bill Documents Found</h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            {allDocuments.length === 0
              ? 'You have not attached any bill photos or PDFs yet. When adding a Sale, Purchase, Expense, or Payment, click "Take Photo" or "Upload Bill" to attach receipts!'
              : 'No documents match your active search or category filter. Try clearing your search.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredDocs.map((doc) => {
            const att = doc.attachment;
            const categoryBadge = {
              SALE: { bg: 'bg-emerald-50 dark:bg-emerald-950/90 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800', label: 'Sale Bill' },
              PURCHASE: { bg: 'bg-blue-50 dark:bg-blue-950/90 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800', label: 'Purchase' },
              EXPENSE: { bg: 'bg-amber-50 dark:bg-amber-950/90 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800', label: 'Expense' },
              PAYMENT: { bg: 'bg-purple-50 dark:bg-purple-950/90 text-purple-800 dark:text-purple-300 border-purple-200 dark:border-purple-800', label: 'Payment' },
              CASHBOOK: { bg: 'bg-teal-50 dark:bg-teal-950/90 text-teal-800 dark:text-teal-300 border-teal-200 dark:border-teal-800', label: 'Cashbook' },
            }[doc.category];

            return (
              <div
                key={doc.id}
                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs hover:shadow-md hover:border-emerald-300 dark:hover:border-emerald-700 transition-all flex flex-col justify-between group"
              >
                {/* Thumbnail Viewport */}
                <div
                  onClick={() =>
                    setActiveViewer({
                      attachments: doc.allAttachments,
                      title: doc.title,
                      subtitle: `${doc.partyName} · ${doc.date}`,
                    })
                  }
                  className="h-44 bg-slate-100 dark:bg-slate-800 flex items-center justify-center overflow-hidden cursor-pointer relative"
                >
                  {att.type === 'IMAGE' ? (
                    <img
                      src={att.dataUrl}
                      alt={att.name}
                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-purple-700 dark:text-purple-300">
                      <FileText className="w-10 h-10" />
                      <span className="text-[11px] font-bold mt-1.5 uppercase">PDF Document</span>
                    </div>
                  )}

                  {/* Top Badges */}
                  <div className="absolute top-2 left-2 flex items-center gap-1.5">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border shadow-2xs ${categoryBadge.bg}`}
                    >
                      {categoryBadge.label}
                    </span>
                    {att.type === 'PDF' && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-900 text-white">
                        PDF
                      </span>
                    )}
                  </div>

                  {/* Hover Overlay */}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white gap-2">
                    <span className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-bold text-xs flex items-center gap-1.5 shadow-lg">
                      <Eye className="w-3.5 h-3.5" />
                      <span>View &amp; Zoom</span>
                    </span>
                  </div>
                </div>

                {/* Card Info Body */}
                <div className="p-3.5 space-y-2 flex-1 flex flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between gap-1">
                      <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-snug truncate" title={doc.title}>
                        {doc.title}
                      </h4>
                      {doc.amount !== undefined && (
                        <span className="text-xs font-bold text-emerald-800 dark:text-emerald-400 shrink-0">
                          {formatINR(doc.amount)}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 truncate">
                      {doc.partyName}
                    </div>
                    <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-slate-400 dark:text-slate-500" />
                      <span>{doc.date}</span>
                      <span>·</span>
                      <span>{formatFileSize(att.size)}</span>
                    </div>
                  </div>

                  {/* Card Bottom Actions */}
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() =>
                        setActiveViewer({
                          attachments: doc.allAttachments,
                          title: doc.title,
                          subtitle: `${doc.partyName} · ${doc.date}`,
                        })
                      }
                      className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 flex items-center gap-1 cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Preview</span>
                    </button>

                    <button
                      type="button"
                      disabled={!att.dataUrl}
                      onClick={() =>
                        downloadDataUrlAsBlobFile(
                          att.dataUrl,
                          att.name || `bill-${att.id}`,
                          att.type === 'PDF' ? 'application/pdf' : 'image/jpeg'
                        )
                      }
                      className="p-1 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded transition-colors disabled:opacity-40 cursor-pointer"
                      aria-label={`Download ${att.name}`}
                      title="Download file"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bill Viewer Modal */}
      {activeViewer && (
        <BillViewerModal
          isOpen={true}
          onClose={() => setActiveViewer(null)}
          attachments={activeViewer.attachments}
          title={activeViewer.title}
          subtitle={activeViewer.subtitle}
        />
      )}
    </div>
  );
};
