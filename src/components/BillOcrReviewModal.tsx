/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { BillAttachment, BillOcrExtractedData, BillOcrItem } from '../types';
import { formatINR } from '../utils/accounting';
import {
  Sparkles,
  CheckCircle,
  X,
  Plus,
  Trash2,
  Calendar,
  Building2,
  Receipt,
  RotateCw,
  FileText,
  AlertCircle,
  HelpCircle,
  ShieldCheck,
} from 'lucide-react';

interface BillOcrReviewModalProps {
  attachment: BillAttachment;
  initialOcrData?: BillOcrExtractedData;
  billType?: 'PURCHASE' | 'EXPENSE' | 'SALE';
  isOpen: boolean;
  onClose: () => void;
  onApply: (data: BillOcrExtractedData) => void;
}

export const BillOcrReviewModal: React.FC<BillOcrReviewModalProps> = ({
  attachment,
  initialOcrData,
  billType = 'PURCHASE',
  isOpen,
  onClose,
  onApply,
}) => {
  const [partyName, setPartyName] = useState(initialOcrData?.partyName || '');
  const [billNumber, setBillNumber] = useState(initialOcrData?.billNumber || '');
  const [billDate, setBillDate] = useState(
    initialOcrData?.billDate || new Date().toISOString().split('T')[0]
  );
  const [items, setItems] = useState<BillOcrItem[]>(initialOcrData?.items || []);
  const [taxAmount, setTaxAmount] = useState(initialOcrData?.taxAmount ? String(initialOcrData.taxAmount) : '0');
  const [totalAmount, setTotalAmount] = useState(
    initialOcrData?.totalAmount ? String(initialOcrData.totalAmount) : ''
  );
  const [notes, setNotes] = useState(initialOcrData?.notes || '');
  const [rotation, setRotation] = useState(attachment.rotation || 0);

  // Sync state when initialOcrData changes
  React.useEffect(() => {
    if (initialOcrData) {
      setPartyName(initialOcrData.partyName || '');
      setBillNumber(initialOcrData.billNumber || '');
      setBillDate(initialOcrData.billDate || new Date().toISOString().split('T')[0]);
      setItems(initialOcrData.items || []);
      setTaxAmount(initialOcrData.taxAmount ? String(initialOcrData.taxAmount) : '0');
      setTotalAmount(initialOcrData.totalAmount ? String(initialOcrData.totalAmount) : '');
      setNotes(initialOcrData.notes || '');
    }
  }, [initialOcrData]);

  if (!isOpen) return null;

  const handleItemChange = (index: number, field: keyof BillOcrItem, value: any) => {
    const updated = [...items];
    const item = { ...updated[index], [field]: value };

    // Auto-calculate total if quantity or rate changed
    if (field === 'quantity' || field === 'rate') {
      const q = field === 'quantity' ? Number(value) || 0 : item.quantity;
      const r = field === 'rate' ? Number(value) || 0 : item.rate;
      item.total = Math.round(q * r * 100) / 100;
    }

    updated[index] = item;
    setItems(updated);

    // If totalAmount is empty or matches previous sum, update totalAmount
    const newItemsTotal = updated.reduce((s, it) => s + (it.total || 0), 0);
    const tax = Number(taxAmount) || 0;
    setTotalAmount(String(newItemsTotal + tax));
  };

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      {
        name: '',
        quantity: 1,
        unit: 'KG',
        rate: 0,
        total: 0,
      },
    ]);
  };

  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const calculatedItemsSum = items.reduce((sum, it) => sum + (it.total || 0), 0);
  const calculatedGrandTotal = calculatedItemsSum + (Number(taxAmount) || 0);

  const handleConfirmAndApply = (e: React.FormEvent) => {
    e.preventDefault();
    const finalAmount = Number(totalAmount) || calculatedGrandTotal;

    const confirmedData: BillOcrExtractedData = {
      partyName: partyName.trim(),
      billNumber: billNumber.trim(),
      billDate: billDate,
      items: items.filter((it) => it.name.trim().length > 0),
      subtotal: calculatedItemsSum,
      taxAmount: Number(taxAmount) || 0,
      totalAmount: finalAmount,
      notes: notes.trim(),
      extractedAt: new Date().toISOString(),
    };

    onApply(confirmedData);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-4xl w-full border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-emerald-950 via-emerald-900 to-emerald-950 text-white flex items-center justify-between shrink-0 border-b border-emerald-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-700/80 border border-emerald-600 flex items-center justify-center text-amber-300">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold">AI Bill Scanner Review (Bill Jaanch &amp; Sudhaar)</h3>
                <span className="text-[10px] font-bold bg-amber-400 text-emerald-950 px-2 py-0.5 rounded-full uppercase">
                  Verify & Confirm
                </span>
              </div>
              <p className="text-xs text-emerald-200/80 mt-0.5">
                Review and correct all scanned details before applying to accounting records.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-emerald-300 hover:text-white hover:bg-emerald-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Safety Banner */}
        <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900 px-4 py-2 flex items-center gap-2 text-xs text-amber-900 dark:text-amber-200 shrink-0">
          <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
          <span>
            <strong>Accounting Safety:</strong> Scanned data is <em>never</em> automatically saved. You can edit any field or save the photo without importing numbers.
          </span>
        </div>

        {/* Content Body: Split view (Image Preview on Left, Editable Form on Right) */}
        <form onSubmit={handleConfirmAndApply} className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 dark:divide-slate-800">
          {/* Left Column: Image / Document Viewer */}
          <div className="lg:col-span-5 p-4 bg-slate-100 dark:bg-slate-800/70 flex flex-col items-center justify-between min-h-[300px]">
            <div className="w-full flex items-center justify-between pb-2 mb-2 border-b border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200">
              <span>Attached Bill Document</span>
              <button
                type="button"
                onClick={() => setRotation((r) => (r + 90) % 360)}
                className="flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 dark:hover:text-emerald-200 bg-white dark:bg-slate-900 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 shadow-2xs"
              >
                <RotateCw className="w-3 h-3" />
                <span>Rotate 90°</span>
              </button>
            </div>

            <div className="w-full flex-1 flex items-center justify-center p-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden max-h-[460px]">
              {attachment.type === 'PDF' ? (
                <div className="text-center p-6 space-y-2">
                  <FileText className="w-16 h-16 text-purple-600 dark:text-purple-400 mx-auto" />
                  <div className="font-bold text-sm text-slate-800 dark:text-slate-100">{attachment.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">PDF Invoice attached</div>
                </div>
              ) : (
                <img
                  src={attachment.dataUrl}
                  alt="Bill Preview"
                  style={{ transform: `rotate(${rotation}deg)` }}
                  className="max-h-[420px] w-auto max-w-full object-contain rounded transition-transform duration-200"
                />
              )}
            </div>

            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 text-center">
              Compare the printed bill photo with the extracted fields on the right.
            </p>
          </div>

          {/* Right Column: Editable Extracted Fields */}
          <div className="lg:col-span-7 p-4 sm:p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                  {billType === 'PURCHASE' ? 'Wholesaler / Supplier Name' : billType === 'SALE' ? 'Customer Name' : 'Payee / Shop Name'} *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Balaji Grains & Agro"
                  value={partyName}
                  onChange={(e) => setPartyName(e.target.value)}
                  className="w-full text-xs sm:text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 focus:outline-emerald-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                  Invoice / Bill Number
                </label>
                <input
                  type="text"
                  placeholder="e.g. BLJ-4491"
                  value={billNumber}
                  onChange={(e) => setBillNumber(e.target.value)}
                  className="w-full text-xs sm:text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 focus:outline-emerald-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                  Bill Date
                </label>
                <input
                  type="date"
                  value={billDate}
                  onChange={(e) => setBillDate(e.target.value)}
                  className="w-full text-xs sm:text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 focus:outline-emerald-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                  Total Bill Amount (₹) *
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  placeholder="e.g. 1985"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value)}
                  className="w-full text-sm sm:text-base font-bold text-emerald-950 dark:text-emerald-300 border border-slate-300 dark:border-slate-700 rounded-lg p-2 focus:outline-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/40"
                />
              </div>
            </div>

            {/* Line Items Table */}
            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wide">
                    Extracted Product Line Items ({items.length})
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Correct quantities, units and rates if needed</p>
                </div>
                <button
                  type="button"
                  onClick={handleAddItem}
                  className="flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 dark:hover:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Line Item</span>
                </button>
              </div>

              {items.length === 0 ? (
                <div className="text-center py-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
                  No line items extracted. Click "+ Add Line Item" to add items or save with total amount only.
                </div>
              ) : (
                <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                  {items.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 bg-slate-50 dark:bg-slate-800/70 rounded-xl border border-slate-200 dark:border-slate-700 grid grid-cols-12 gap-2 items-center text-xs"
                    >
                      <div className="col-span-5">
                        <input
                          type="text"
                          placeholder="Item Name (Saman ka Naam)"
                          value={item.name}
                          onChange={(e) => handleItemChange(idx, 'name', e.target.value)}
                          className="w-full font-medium text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded p-1.5 focus:outline-emerald-600"
                        />
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number"
                          step="any"
                          min="0.01"
                          placeholder="Qty"
                          value={item.quantity || ''}
                          onChange={(e) => handleItemChange(idx, 'quantity', e.target.value)}
                          className="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded p-1.5 text-center focus:outline-emerald-600"
                        />
                      </div>
                      <div className="col-span-2">
                        <select
                          value={item.unit || 'KG'}
                          onChange={(e) => handleItemChange(idx, 'unit', e.target.value)}
                          className="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded p-1.5 text-center text-[11px]"
                        >
                          <option value="KG">KG</option>
                          <option value="GM">GM</option>
                          <option value="LITRE">Litre</option>
                          <option value="ML">ML</option>
                          <option value="PACKET">Pkt</option>
                          <option value="PCS">Pcs</option>
                          <option value="BOX">Box</option>
                          <option value="BAG">Bag</option>
                          <option value="TIN">Tin</option>
                        </select>
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number"
                          step="any"
                          placeholder="Rate ₹"
                          value={item.rate || ''}
                          onChange={(e) => handleItemChange(idx, 'rate', e.target.value)}
                          className="w-full bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded p-1.5 text-right font-medium focus:outline-emerald-600"
                        />
                      </div>
                      <div className="col-span-1 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(idx)}
                          className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                          title="Remove item"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Tax / GST Amount (₹)
                </label>
                <input
                  type="number"
                  step="any"
                  value={taxAmount}
                  onChange={(e) => setTaxAmount(e.target.value)}
                  className="w-full text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Remarks / Bill Notes
                </label>
                <input
                  type="text"
                  placeholder="Optional note"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2"
                />
              </div>
            </div>
          </div>
        </form>

        {/* Footer Actions */}
        <div className="p-3 sm:p-4 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-600 dark:text-slate-300">
            Total Extracted: <strong className="text-slate-900 dark:text-slate-100 font-bold">{formatINR(Number(totalAmount) || calculatedGrandTotal)}</strong>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              Keep Photo Only (Bina OCR)
            </button>
            <button
              type="button"
              onClick={handleConfirmAndApply}
              className="px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <CheckCircle className="w-4 h-4" />
              <span>Apply Verified Details to Form</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
