import React, { useMemo, useState } from 'react';
import {
  Check,
  ClipboardList,
  Copy,
  Download,
  FileText,
  MessageCircle,
  X,
} from 'lucide-react';
import { Product, StoreProfile, Supplier } from '../types';
import { buildPurchaseOrderDraftItems, formatINR, PurchaseOrderDraftItem } from '../utils/accounting';
import { downloadPurchaseOrderPDF } from '../utils/pdfGenerator';
import { buildWhatsAppShareUrl } from '../utils/whatsappReceipt';

interface PurchaseOrderModalProps {
  products: Product[];
  suppliers: Supplier[];
  profile: StoreProfile;
  focusProductId?: string | null;
  onClose: () => void;
}

interface EditablePOItem extends PurchaseOrderDraftItem {
  selected: boolean;
  orderQty: number;
}

export const PurchaseOrderModal: React.FC<PurchaseOrderModalProps> = ({
  products,
  suppliers,
  profile,
  focusProductId,
  onClose,
}) => {
  const initialDrafts = useMemo(() => buildPurchaseOrderDraftItems(products, 2), [products]);

  const [items, setItems] = useState<EditablePOItem[]>(() =>
    initialDrafts.map((d) => ({
      ...d,
      selected: focusProductId ? d.productId === focusProductId || d.isOutOfStock : true,
      orderQty: d.suggestedQty,
    }))
  );

  const [selectedSupplierId, setSelectedSupplierId] = useState<string>(
    suppliers[0]?.id || ''
  );
  const [poNumber, setPoNumber] = useState<string>(() => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `PO-${today}-${Math.floor(100 + Math.random() * 899)}`;
  });
  const [notes, setNotes] = useState<string>('Urgent kirana stock replenishment order.');
  const [copied, setCopied] = useState(false);
  const [draftSavedNotice, setDraftSavedNotice] = useState<string | null>(null);

  const selectedSupplier = suppliers.find((s) => s.id === selectedSupplierId);

  const selectedItems = useMemo(
    () => items.filter((i) => i.selected && i.orderQty > 0),
    [items]
  );

  const estimatedGrandTotal = useMemo(
    () =>
      selectedItems.reduce(
        (sum, item) => sum + item.orderQty * item.unitCost,
        0
      ),
    [selectedItems]
  );

  const poWhatsAppMessage = useMemo(() => {
    const lines = [
      `*PURCHASE ORDER #${poNumber}*`,
      `From: *${profile.storeName}* (${profile.phone})`,
      selectedSupplier ? `To: ${selectedSupplier.name}` : `To: Wholesale Distributor`,
      `Date: ${new Date().toLocaleDateString('en-IN')}`,
      `--------------------------------`,
      `*Order Items (${selectedItems.length}):*`,
    ];

    selectedItems.forEach((it, idx) => {
      lines.push(
        `${idx + 1}. ${it.productName} — *${it.orderQty} ${it.unit}* (Est. ${formatINR(
          it.orderQty * it.unitCost
        )})`
      );
    });

    lines.push(`--------------------------------`);
    lines.push(`*Est. Order Total: ${formatINR(estimatedGrandTotal)}*`);
    if (notes.trim()) lines.push(`Note: ${notes.trim()}`);
    lines.push(`Please confirm availability & delivery time.`);
    return lines.join('\n');
  }, [poNumber, profile, selectedSupplier, selectedItems, estimatedGrandTotal, notes]);

  const toggleItem = (productId: string) => {
    setItems((prev) =>
      prev.map((it) =>
        it.productId === productId ? { ...it, selected: !it.selected } : it
      )
    );
  };

  const updateOrderQty = (productId: string, rawQty: string) => {
    const parsed = Math.max(0, Number(rawQty) || 0);
    setItems((prev) =>
      prev.map((it) =>
        it.productId === productId ? { ...it, orderQty: parsed } : it
      )
    );
  };

  const handleCopyDraft = async () => {
    try {
      await navigator.clipboard.writeText(poWhatsAppMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setDraftSavedNotice('Copy failed. Please download the PO PDF or send directly.');
    }
  };

  const handleDownloadPDF = () => {
    if (selectedItems.length === 0) return;
    downloadPurchaseOrderPDF({
      poNumber,
      poDate: new Date().toLocaleDateString('en-IN'),
      supplierName: selectedSupplier?.name || 'General Wholesale Distributor',
      supplierPhone: selectedSupplier?.phone,
      notes,
      items: selectedItems.map((it) => ({
        productName: it.productName,
        unit: it.unit,
        currentStock: it.currentStock,
        orderQty: it.orderQty,
        unitCost: it.unitCost,
        estimatedTotal: Math.round(it.orderQty * it.unitCost * 100) / 100,
      })),
      profile,
    });
    setDraftSavedNotice(`Purchase Order #${poNumber} downloaded as PDF.`);
  };

  const handleSelectAll = (checked: boolean) => {
    setItems((prev) => prev.map((it) => ({ ...it, selected: checked })));
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Create Purchase Order Draft"
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 bg-emerald-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-800">
              <ClipboardList className="w-5 h-5 text-emerald-100" />
            </div>
            <div>
              <h3 className="font-bold text-base">
                Purchase Order Draft (Low-Stock Reorder)
              </h3>
              <p className="text-xs text-emerald-100/80">
                {items.length} low-stock item(s) detected below minimum threshold
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close purchase order modal"
            className="p-1.5 rounded-lg text-emerald-100 hover:bg-emerald-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Select Supplier / Wholesaler
              </label>
              <select
                value={selectedSupplierId}
                onChange={(e) => setSelectedSupplierId(e.target.value)}
                className="w-full text-xs sm:text-sm border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 bg-white dark:bg-slate-800 font-medium text-slate-900 dark:text-slate-100"
              >
                {suppliers.map((sup) => (
                  <option key={sup.id} value={sup.id}>
                    {sup.name} ({sup.phone})
                  </option>
                ))}
                <option value="">General Wholesale Market</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                PO Draft Reference #
              </label>
              <input
                type="text"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                className="w-full text-xs sm:text-sm font-mono border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Estimated Order Total
              </label>
              <div className="px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 font-extrabold text-emerald-900 dark:text-emerald-300 text-sm tabular-nums">
                {formatINR(estimatedGrandTotal)} ({selectedItems.length} items)
              </div>
            </div>
          </div>

          {draftSavedNotice && (
            <div className="bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 text-xs text-emerald-900 dark:text-emerald-200 font-semibold flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
              <span>{draftSavedNotice}</span>
            </div>
          )}

          {/* Items Table */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="bg-slate-50 dark:bg-slate-800/80 px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
              <label className="inline-flex items-center gap-2 font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedItems.length === items.length && items.length > 0}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-600 text-emerald-700"
                />
                <span>Include All Low-Stock Items ({items.length})</span>
              </label>
              <span className="text-slate-500 dark:text-slate-400">Adjust quantities before sending PO</span>
            </div>

            {items.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                All products are currently above their minimum stock alert threshold.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 uppercase text-[10px] font-bold border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="py-2.5 px-3 w-8">Pick</th>
                      <th className="py-2.5 px-3">Product</th>
                      <th className="py-2.5 px-3 text-right">Stock / Threshold</th>
                      <th className="py-2.5 px-3 text-right">Order Qty</th>
                      <th className="py-2.5 px-3 text-right">Est. Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {items.map((item) => (
                      <tr
                        key={item.productId}
                        className={item.selected ? 'bg-red-50/40 dark:bg-red-950/20' : 'bg-white dark:bg-slate-900 opacity-60'}
                      >
                        <td className="py-2.5 px-3">
                          <input
                            type="checkbox"
                            checked={item.selected}
                            onChange={() => toggleItem(item.productId)}
                            className="rounded border-slate-300 dark:border-slate-600 text-emerald-700 cursor-pointer"
                          />
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-bold text-slate-900 dark:text-slate-100">{item.productName}</div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            Rate: {formatINR(item.unitCost)} / {item.unit}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          <span className="font-bold text-red-700 dark:text-red-400">
                            {item.currentStock} {item.unit}
                          </span>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">
                            Min: {item.minStockAlert} {item.unit}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={item.orderQty}
                              onChange={(e) => updateOrderQty(item.productId, e.target.value)}
                              className="w-20 text-right font-bold border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-2 py-1 text-xs tabular-nums"
                            />
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">{item.unit}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                          {formatINR(Math.round(item.orderQty * item.unitCost))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Delivery Instructions / Notes for Supplier
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Deliver before 11 AM tomorrow"
              className="w-full text-xs sm:text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl px-3 py-2"
            />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
          >
            Close
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopyDraft}
              disabled={selectedItems.length === 0}
              className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied PO!' : 'Copy PO Text'}</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadPDF}
              disabled={selectedItems.length === 0}
              className="px-3.5 py-2 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-900 dark:text-emerald-300 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download PO PDF</span>
            </button>

            <a
              href={buildWhatsAppShareUrl(selectedSupplier?.phone, poWhatsAppMessage)}
              target="_blank"
              rel="noopener noreferrer"
              className={`px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm ${
                selectedItems.length === 0 ? 'pointer-events-none opacity-50' : ''
              }`}
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>Send PO on WhatsApp</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
