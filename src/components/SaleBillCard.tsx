import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  Edit2,
  MessageCircle,
  MoreVertical,
  Paperclip,
  Phone,
  Plus,
  Printer,
  Send,
  Settings2,
  ShoppingCart,
  Store,
  Trash2,
  User,
  Wallet,
  XCircle,
  Receipt,
  Award,
} from 'lucide-react';
import { PaymentMethod, SaleItem, StoreProfile } from '../types';
import { formatINR } from '../utils/accounting';
import { BRAND_NAME, BRAND_TAGLINE } from './BrandLogo';
import {
  formatCompactBillQty,
  getProductBadgeMeta,
  SaleBillCustomerSummary,
  SaleBillFinancialSummary,
  SaleBillStatusKind,
} from '../utils/saleBillViewModel';

export interface SaleBillHeaderBarProps {
  profile: StoreProfile;
  onBack: () => void;
  onPrint?: () => void;
  canPrint?: boolean;
  onDownloadPdf?: () => void;
  canDownloadPdf?: boolean;
  onShareWhatsApp?: () => void;
  canShareWhatsApp?: boolean;
  onToggleThermalPreview?: () => void;
  showThermalPreview?: boolean;
  onCustomizePrint?: () => void;
  onFocusAttachment?: () => void;
}

export const SaleBillHeaderBar: React.FC<SaleBillHeaderBarProps> = ({
  profile,
  onBack,
  onPrint,
  canPrint = false,
  onDownloadPdf,
  canDownloadPdf = false,
  onShareWhatsApp,
  canShareWhatsApp = false,
  onToggleThermalPreview,
  showThermalPreview = false,
  onCustomizePrint,
  onFocusAttachment,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [menuOpen]);

  const storeTitle = profile.storeName?.trim() || BRAND_NAME;

  return (
    <header className="sticky top-0 z-30 bg-[#065f26] text-white px-3 sm:px-5 py-2.5 flex items-center justify-between gap-2 shadow-md rounded-b-2xl sm:rounded-b-none">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <button
          type="button"
          onClick={onBack}
          data-testid="sale-bill-back-btn"
          aria-label="Back"
          className="min-w-[44px] min-h-[44px] -ml-1 rounded-xl flex items-center justify-center text-white hover:bg-white/15 active:bg-white/20 transition-colors cursor-pointer shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="w-9 h-9 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center shrink-0">
          <ShoppingCart className="w-5 h-5 text-white" aria-hidden="true" />
        </div>

        <div className="min-w-0">
          <div className="text-base sm:text-lg font-extrabold leading-tight tracking-tight truncate">
            {storeTitle}
          </div>
          <div className="text-[11px] font-medium text-emerald-100/90 leading-tight truncate">
            {BRAND_TAGLINE}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0 relative" ref={menuRef}>
        <button
          type="button"
          onClick={onPrint}
          disabled={!canPrint || !onPrint}
          data-testid="sale-bill-header-print-btn"
          aria-label="Print Sale Bill"
          title={canPrint ? 'Print Thermal Bill' : 'Generate bill first to print'}
          className="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center text-white hover:bg-white/15 active:bg-white/20 disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          <Printer className="w-5 h-5" />
        </button>

        <button
          type="button"
          onClick={() => setMenuOpen((prev) => !prev)}
          data-testid="sale-bill-more-menu-btn"
          aria-label="More bill actions"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className="min-w-[44px] min-h-[44px] rounded-xl flex items-center justify-center text-white hover:bg-white/15 active:bg-white/20 transition-colors cursor-pointer"
        >
          <MoreVertical className="w-5 h-5" />
        </button>

        {menuOpen && (
          <div
            role="menu"
            data-testid="sale-bill-more-menu"
            className="absolute right-0 top-12 w-56 rounded-2xl bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 shadow-2xl py-1.5 z-50"
          >
            {onToggleThermalPreview && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onToggleThermalPreview();
                }}
                className="w-full px-3.5 py-2.5 text-left text-xs font-semibold flex items-center gap-2.5 hover:bg-emerald-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <Receipt className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                <span>{showThermalPreview ? 'Hide Thermal Preview' : 'Preview Thermal Receipt'}</span>
              </button>
            )}
            {onDownloadPdf && (
              <button
                type="button"
                role="menuitem"
                disabled={!canDownloadPdf}
                onClick={() => {
                  setMenuOpen(false);
                  onDownloadPdf();
                }}
                className="w-full px-3.5 py-2.5 text-left text-xs font-semibold flex items-center gap-2.5 hover:bg-emerald-50 dark:hover:bg-slate-800 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
              >
                <Download className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                <span>Download PDF Invoice</span>
              </button>
            )}
            {onShareWhatsApp && (
              <button
                type="button"
                role="menuitem"
                disabled={!canShareWhatsApp}
                onClick={() => {
                  setMenuOpen(false);
                  onShareWhatsApp();
                }}
                className="w-full px-3.5 py-2.5 text-left text-xs font-semibold flex items-center gap-2.5 hover:bg-emerald-50 dark:hover:bg-slate-800 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
              >
                <MessageCircle className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                <span>Share via WhatsApp</span>
              </button>
            )}
            {onFocusAttachment && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onFocusAttachment();
                }}
                className="w-full px-3.5 py-2.5 text-left text-xs font-semibold flex items-center gap-2.5 hover:bg-emerald-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <Paperclip className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                <span>Attach Bill Document</span>
              </button>
            )}
            {onCustomizePrint && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onCustomizePrint();
                }}
                className="w-full px-3.5 py-2.5 text-left text-xs font-semibold flex items-center gap-2.5 hover:bg-emerald-50 dark:hover:bg-slate-800 border-t border-slate-100 dark:border-slate-800 mt-1 pt-2.5 cursor-pointer"
              >
                <Settings2 className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                <span>Customize Receipt Layout</span>
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
};

export interface SaleBillSubHeaderProps {
  invoiceNo?: string | null;
  statusKind: SaleBillStatusKind;
  statusLabel: string;
  dateIso?: string;
}

export const SaleBillSubHeader: React.FC<SaleBillSubHeaderProps> = ({
  invoiceNo,
  statusKind,
  statusLabel,
  dateIso,
}) => {
  const statusStyles: Record<SaleBillStatusKind, string> = {
    COMPLETED:
      'bg-[#e1f8e7] dark:bg-emerald-950/80 text-[#0c6b2a] dark:text-emerald-300 border-[#b7ecc6] dark:border-emerald-800',
    DRAFT:
      'bg-amber-50 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    PENDING:
      'bg-amber-50 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    PARTIAL:
      'bg-sky-50 dark:bg-sky-950/70 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800',
    CANCELLED:
      'bg-red-50 dark:bg-red-950/70 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800',
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
      <div className="flex items-center gap-2.5 flex-wrap">
        <h2 className="text-2xl sm:text-[26px] font-extrabold text-slate-950 dark:text-white tracking-tight leading-none">
          Sale Bill
        </h2>
        <span
          data-testid="sale-bill-invoice-badge"
          className="inline-flex items-center px-3 py-1 rounded-xl bg-[#a5f29c] dark:bg-emerald-900/90 text-[#053b16] dark:text-emerald-100 font-extrabold text-xs sm:text-sm font-mono tabular-nums shadow-2xs"
        >
          {invoiceNo ? `#${invoiceNo}` : 'New Bill'}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {dateIso && (
          <span className="hidden sm:inline text-xs font-medium text-slate-500 dark:text-slate-400 tabular-nums">
            {new Date(dateIso).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        )}
        <span
          data-testid="sale-bill-status-badge"
          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-bold ${statusStyles[statusKind]}`}
        >
          {statusKind === 'COMPLETED' ? (
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          ) : statusKind === 'CANCELLED' ? (
            <XCircle className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <Clock className="w-3.5 h-3.5 shrink-0" />
          )}
          <span>{statusLabel}</span>
        </span>
      </div>
    </div>
  );
};

export interface SaleBillCardProps {
  profile: StoreProfile;
  items: SaleItem[];
  directAmountFallback?: number;
  notes?: string;
  financials: SaleBillFinancialSummary;
  paymentMethod: PaymentMethod;
  onSelectPaymentMethod?: (method: PaymentMethod) => void;
  customerSummary: SaleBillCustomerSummary | null;
  onOpenCustomerPicker?: () => void;
  onOpenAddItems?: () => void;
  onRemoveItem?: (index: number) => void;
  isFinalized: boolean;
  isSubmitting?: boolean;
  submitLabel?: string;
  onGenerateBill?: () => void;
  loyaltyEarned?: number;
  loyaltyRedeemed?: number;
  onPreviewThermal?: () => void;
  showThermalPreview?: boolean;
  onDownloadPdf?: () => void;
  onPrintBill?: () => void;
  onShareWhatsApp?: () => void;
  onDoneOrNewBill?: () => void;
  doneButtonLabel?: string;
}

export const SaleBillCard: React.FC<SaleBillCardProps> = ({
  profile,
  items,
  directAmountFallback = 0,
  notes,
  financials,
  paymentMethod,
  onSelectPaymentMethod,
  customerSummary,
  onOpenCustomerPicker,
  onOpenAddItems,
  onRemoveItem,
  isFinalized,
  isSubmitting = false,
  submitLabel = 'Generate Bill',
  onGenerateBill,
  loyaltyEarned = 0,
  loyaltyRedeemed = 0,
  onPreviewThermal,
  showThermalPreview = false,
  onDownloadPdf,
  onPrintBill,
  onShareWhatsApp,
  onDoneOrNewBill,
  doneButtonLabel = 'Done / Next Bill',
}) => {
  const storeName = profile.storeName?.trim() || BRAND_NAME;
  const storeSubtitle = profile.address?.trim() || 'Your Local Kirana Store';

  const normalizedMode: 'CASH' | 'UPI' | 'CREDIT' =
    paymentMethod === 'CREDIT'
      ? 'CREDIT'
      : paymentMethod === 'UPI' || paymentMethod === 'BANK'
        ? 'UPI'
        : 'CASH';

  const hasBreakdown =
    financials.totalDiscount > 0 ||
    financials.taxAmount > 0 ||
    (financials.remainingOutstanding > 0 && financials.amountPaid > 0);

  return (
    <section
      aria-label="Sale Bill Summary"
      data-testid="sale-bill-card"
      className="rounded-[26px] bg-gradient-to-b from-[#063e1a] via-[#042d13] to-[#021f0c] text-white p-4 sm:p-5 border border-[#196b37]/60 shadow-2xl shadow-emerald-950/30 space-y-4"
    >
      {/* Store Identity Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 rounded-full bg-[#179944] text-white flex items-center justify-center shadow-md shadow-black/20 shrink-0">
            <Store className="w-6 h-6" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg sm:text-xl font-extrabold tracking-tight text-white leading-tight truncate">
              {storeName}
            </h3>
            <p className="text-xs sm:text-sm text-emerald-100/80 leading-snug truncate">
              {storeSubtitle}
            </p>
          </div>
        </div>

        {!isFinalized && onOpenAddItems && (
          <button
            type="button"
            data-testid="sale-bill-add-items-btn"
            onClick={onOpenAddItems}
            className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl bg-[#136530] hover:bg-[#177a3a] border border-[#2ea057]/60 text-white text-xs font-bold transition-colors cursor-pointer shrink-0 whitespace-nowrap"
          >
            {items.length > 0 ? <Edit2 className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            <span>{items.length > 0 ? `Items (${items.length})` : 'Add Items'}</span>
          </button>
        )}
      </div>

      {/* Itemized Bill Table */}
      <div className="rounded-2xl border border-[#1f753e]/65 bg-[#052911]/85 overflow-hidden">
        <div className="overflow-x-auto">
          <table
            data-testid="sale-bill-items-table"
            className="w-full text-left border-collapse min-w-[300px]"
          >
            <thead>
              <tr className="bg-[#125d2c] text-white text-xs sm:text-[13px] font-bold">
                <th className="py-2.5 px-3 border-r border-[#1f753e]/60">Item</th>
                <th className="py-2.5 px-2.5 text-center border-r border-[#1f753e]/60 whitespace-nowrap">
                  Qty
                </th>
                <th className="py-2.5 px-2.5 text-right border-r border-[#1f753e]/60 whitespace-nowrap">
                  Rate
                </th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a6234]/55 text-xs sm:text-sm">
              {items.length > 0 ? (
                items.map((item, idx) => {
                  const badge = getProductBadgeMeta(item.productName);
                  return (
                    <tr
                      key={`${item.productId || item.productName}-${idx}`}
                      className="hover:bg-white/[0.03] transition-colors"
                    >
                      <td className="py-2.5 px-2.5 sm:px-3 border-r border-[#1a6234]/45 align-middle">
                        <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
                          <span
                            aria-hidden="true"
                            className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg ${badge.bgClass} ${badge.textClass} font-extrabold text-[10px] sm:text-[11px] flex items-center justify-center shrink-0 shadow-xs`}
                          >
                            {badge.initials}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-white leading-snug break-words">
                              {item.productName}
                            </div>
                            {Number(item.discount || 0) > 0 && (
                              <div className="text-[11px] font-semibold text-amber-300 mt-0.5 tabular-nums">
                                Discount -{formatINR(Number(item.discount))}
                              </div>
                            )}
                          </div>
                          {!isFinalized && onRemoveItem && (
                            <button
                              type="button"
                              onClick={() => onRemoveItem(idx)}
                              aria-label={`Remove ${item.productName}`}
                              className="p-1 rounded-lg text-emerald-200/70 hover:text-red-300 hover:bg-red-950/50 transition-colors cursor-pointer shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-2 sm:px-2.5 text-center text-emerald-50 font-medium border-r border-[#1a6234]/45 whitespace-nowrap tabular-nums">
                        {formatCompactBillQty(item.quantity, item.unit)}
                      </td>
                      <td className="py-2.5 px-2 sm:px-2.5 text-right text-emerald-100/90 font-medium border-r border-[#1a6234]/45 whitespace-nowrap tabular-nums">
                        {formatINR(item.rate)}
                      </td>
                      <td className="py-2.5 px-2.5 sm:px-3 text-right font-extrabold text-white whitespace-nowrap tabular-nums">
                        {formatINR(item.total)}
                      </td>
                    </tr>
                  );
                })
              ) : directAmountFallback > 0 ? (
                <tr>
                  <td className="py-3 px-3 border-r border-[#1a6234]/45">
                    <div className="flex items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="w-8 h-8 rounded-lg bg-emerald-400 text-emerald-950 font-extrabold text-[11px] flex items-center justify-center shrink-0"
                      >
                        GR
                      </span>
                      <div className="font-semibold text-white break-words">
                        {notes?.trim() || 'Counter Grocery Bill'}
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-2.5 text-center text-emerald-100 border-r border-[#1a6234]/45 whitespace-nowrap tabular-nums">
                    1 lot
                  </td>
                  <td className="py-3 px-2.5 text-right text-emerald-100 border-r border-[#1a6234]/45 whitespace-nowrap tabular-nums">
                    {formatINR(directAmountFallback)}
                  </td>
                  <td className="py-3 px-3 text-right font-extrabold text-white whitespace-nowrap tabular-nums">
                    {formatINR(directAmountFallback)}
                  </td>
                </tr>
              ) : (
                <tr>
                  <td colSpan={4} className="py-5 px-4 text-center">
                    <p className="text-xs text-emerald-100/80 mb-2.5">
                      No items added yet. Pick products with KG, GM, Litre, ML or PCS units.
                    </p>
                    {!isFinalized && onOpenAddItems && (
                      <button
                        type="button"
                        onClick={onOpenAddItems}
                        className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] rounded-xl bg-[#169b42] hover:bg-[#19ad4b] text-white text-xs font-bold transition-colors cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Add Products to Bill</span>
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Subtotal / Discounts / Grand Total */}
      <div className="space-y-1.5 pb-3.5 border-b border-[#1c6a37]/60">
        {hasBreakdown && (
          <div className="space-y-1 pb-2 text-xs text-emerald-100/85 tabular-nums">
            <div className="flex items-center justify-between">
              <span>Subtotal</span>
              <span className="font-semibold text-white">{formatINR(financials.subtotal)}</span>
            </div>
            {financials.itemDiscountTotal > 0 && (
              <div className="flex items-center justify-between text-amber-300">
                <span>Item Discounts</span>
                <span className="font-semibold">-{formatINR(financials.itemDiscountTotal)}</span>
              </div>
            )}
            {financials.loyaltyDiscount > 0 && (
              <div className="flex items-center justify-between text-[#62f08d]">
                <span>
                  Loyalty Discount
                  {loyaltyRedeemed > 0 ? ` (${loyaltyRedeemed} pts)` : ''}
                </span>
                <span className="font-semibold">-{formatINR(financials.loyaltyDiscount)}</span>
              </div>
            )}
            {financials.taxAmount > 0 && (
              <div className="flex items-center justify-between">
                <span>Tax / GST</span>
                <span className="font-semibold">{formatINR(financials.taxAmount)}</span>
              </div>
            )}
            {financials.amountPaid > 0 && financials.remainingOutstanding > 0 && (
              <>
                <div className="flex items-center justify-between text-emerald-200">
                  <span>Amount Paid</span>
                  <span className="font-semibold">{formatINR(financials.amountPaid)}</span>
                </div>
                <div className="flex items-center justify-between text-amber-300 font-bold">
                  <span>Remaining Due</span>
                  <span>{formatINR(financials.remainingOutstanding)}</span>
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
            Grand Total:
          </span>
          <span
            data-testid="sale-bill-grand-total"
            className="text-2xl sm:text-[30px] font-extrabold text-[#5ff08b] tabular-nums tracking-tight"
          >
            {formatINR(financials.grandTotal)}
          </span>
        </div>

        {loyaltyEarned > 0 && (
          <div className="flex items-center justify-end gap-1.5 text-[11px] font-semibold text-[#8cf7ad] pt-0.5">
            <Award className="w-3.5 h-3.5" />
            <span>
              {isFinalized ? `Earned +${loyaltyEarned} loyalty pts` : `Will earn +${loyaltyEarned} loyalty pts`}
            </span>
          </div>
        )}
      </div>

      {/* Payment Mode */}
      <div className="space-y-2.5">
        <div className="text-sm font-bold text-white">Payment Mode</div>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Payment Mode">
          {[
            { id: 'CASH' as const, label: 'Cash', icon: Wallet },
            { id: 'UPI' as const, label: 'Online', icon: Send },
            { id: 'CREDIT' as const, label: 'Credit', icon: User },
          ].map((option) => {
            const Icon = option.icon;
            const isSelected = normalizedMode === option.id;
            const isInteractive = !isFinalized && Boolean(onSelectPaymentMethod);
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                data-testid={`payment-mode-${option.id.toLowerCase()}`}
                disabled={!isInteractive && !isSelected}
                onClick={() => isInteractive && onSelectPaymentMethod?.(option.id)}
                className={`min-h-[46px] px-2.5 py-2.5 rounded-2xl border text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 transition-all whitespace-nowrap ${
                  isSelected
                    ? 'bg-[#179944] border-[#66f391] text-white shadow-md shadow-black/25'
                    : isInteractive
                      ? 'bg-[#052912] border-[#1d6e3a] text-emerald-100 hover:bg-[#093d1c] cursor-pointer'
                      : 'bg-[#052912]/60 border-[#18572f]/60 text-emerald-100/50 cursor-default'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{option.label}</span>
                {isSelected && (
                  <CheckCircle2
                    className="w-4 h-4 text-white fill-white/20 shrink-0 ml-0.5"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Customer Account Details (Hidden for Walk-In Sales when Finalized) */}
      {customerSummary ? (
        <div className="space-y-2" data-testid="sale-bill-account-details">
          <div className="text-sm font-bold text-white">Account Details</div>
          <div
            onClick={!isFinalized && onOpenCustomerPicker ? onOpenCustomerPicker : undefined}
            role={!isFinalized && onOpenCustomerPicker ? 'button' : undefined}
            tabIndex={!isFinalized && onOpenCustomerPicker ? 0 : undefined}
            onKeyDown={(e) => {
              if (!isFinalized && onOpenCustomerPicker && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                onOpenCustomerPicker();
              }
            }}
            className={`rounded-2xl bg-[#0a361a]/95 border border-[#246f3f] p-3.5 flex items-center justify-between gap-3 ${
              !isFinalized && onOpenCustomerPicker
                ? 'hover:bg-[#0e4321] cursor-pointer transition-colors'
                : ''
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-full bg-white/15 border border-white/15 flex items-center justify-center text-emerald-50 shrink-0">
                <User className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="font-bold text-sm sm:text-base text-white leading-tight truncate">
                  {customerSummary.name}
                </div>
                {customerSummary.phone && (
                  <div className="text-[11px] text-emerald-100/75 flex items-center gap-1 mt-0.5 tabular-nums">
                    <Phone className="w-3 h-3 shrink-0" aria-hidden="true" />
                    <span>{customerSummary.phone}</span>
                  </div>
                )}
                <div className="text-xs text-emerald-100/90 mt-1 tabular-nums flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <span className="font-bold text-[#66f391]">
                    {formatINR(customerSummary.currentBillAmount)}
                  </span>
                  {customerSummary.isCreditImpact ? (
                    <span>
                      (Prev: {formatINR(customerSummary.previousOutstanding)} →{' '}
                      <strong className="text-white">
                        New: {formatINR(customerSummary.newOutstanding)}
                      </strong>
                      {isFinalized &&
                        Math.abs(customerSummary.currentLedgerBalance - customerSummary.newOutstanding) >= 0.01 && (
                          <> · Current: <strong className="text-[#66f391]">{formatINR(customerSummary.currentLedgerBalance)}</strong></>
                        )}
                      )
                    </span>
                  ) : (
                    <span>
                      (Outstanding:{' '}
                      <strong className="text-white">
                        {formatINR(customerSummary.currentLedgerBalance)}
                      </strong>
                      )
                    </span>
                  )}
                </div>
              </div>
            </div>

            {!isFinalized && onOpenCustomerPicker && (
              <ChevronRight className="w-5 h-5 text-emerald-200/80 shrink-0" aria-hidden="true" />
            )}
          </div>
        </div>
      ) : !isFinalized && onOpenCustomerPicker ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-white">Account Details</span>
            <span className="text-[11px] font-medium text-emerald-200/75">
              {normalizedMode === 'CREDIT' ? 'Required for Credit' : 'Walk-in Customer'}
            </span>
          </div>
          <button
            type="button"
            data-testid="sale-bill-select-customer-btn"
            onClick={onOpenCustomerPicker}
            className={`w-full rounded-2xl p-3.5 border text-left flex items-center justify-between gap-3 transition-colors cursor-pointer ${
              normalizedMode === 'CREDIT'
                ? 'bg-amber-950/45 border-amber-400/70 hover:bg-amber-950/65 text-amber-100'
                : 'bg-[#0a361a]/70 border-[#246f3f]/80 hover:bg-[#0e4321] text-emerald-100'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                <User className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-white truncate">
                  {normalizedMode === 'CREDIT'
                    ? 'Select Customer for Credit (Udhar)'
                    : 'Walk-in Sale · Tap to Link Customer'}
                </div>
                <div className="text-[11px] text-emerald-100/75 truncate">
                  {normalizedMode === 'CREDIT'
                    ? 'Required to update customer Khata balance'
                    : 'Optional — earn loyalty points or track ledger'}
                </div>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 shrink-0 opacity-80" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {/* Primary Generate Bill CTA OR Completed Bill Output Actions */}
      {!isFinalized ? (
        <button
          type="button"
          disabled={isSubmitting}
          data-testid="generate-bill-btn"
          onClick={onGenerateBill}
          className="w-full min-h-[54px] py-3.5 px-6 rounded-2xl bg-[#169b42] hover:bg-[#19ad4b] active:bg-[#128036] disabled:opacity-60 disabled:cursor-not-allowed text-white font-extrabold text-base sm:text-lg shadow-lg shadow-black/25 flex items-center justify-center gap-2.5 transition-all cursor-pointer"
        >
          <CheckCircle2 className="w-6 h-6 text-white shrink-0" aria-hidden="true" />
          <span>{isSubmitting ? 'Generating Bill...' : submitLabel}</span>
        </button>
      ) : (
        <div className="space-y-2.5 pt-1" data-testid="sale-bill-output-actions">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {onPreviewThermal && (
              <button
                type="button"
                data-testid="sale-bill-preview-thermal-btn"
                onClick={onPreviewThermal}
                className="min-h-[44px] px-2.5 py-2 rounded-xl bg-[#0b3c1d] hover:bg-[#104d26] border border-[#247241] text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Receipt className="w-4 h-4 text-[#66f391] shrink-0" />
                <span>{showThermalPreview ? 'Hide Slip' : 'Preview Bill'}</span>
              </button>
            )}
            {onDownloadPdf && (
              <button
                type="button"
                data-testid="sale-bill-download-pdf-btn"
                onClick={onDownloadPdf}
                className="min-h-[44px] px-2.5 py-2 rounded-xl bg-[#0b3c1d] hover:bg-[#104d26] border border-[#247241] text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Download className="w-4 h-4 text-[#66f391] shrink-0" />
                <span>PDF</span>
              </button>
            )}
            {onPrintBill && (
              <button
                type="button"
                data-testid="sale-bill-print-btn"
                onClick={onPrintBill}
                className="min-h-[44px] px-2.5 py-2 rounded-xl bg-[#0b3c1d] hover:bg-[#104d26] border border-[#247241] text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Printer className="w-4 h-4 text-[#66f391] shrink-0" />
                <span>Print</span>
              </button>
            )}
            {onShareWhatsApp && (
              <button
                type="button"
                data-testid="sale-bill-whatsapp-btn"
                onClick={onShareWhatsApp}
                className="min-h-[44px] px-2.5 py-2 rounded-xl bg-[#0b3c1d] hover:bg-[#104d26] border border-[#247241] text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <MessageCircle className="w-4 h-4 text-[#66f391] shrink-0" />
                <span>WhatsApp</span>
              </button>
            )}
          </div>

          {onDoneOrNewBill && (
            <button
              type="button"
              data-testid="sale-bill-done-btn"
              onClick={onDoneOrNewBill}
              className="w-full min-h-[50px] py-3 px-6 rounded-2xl bg-[#169b42] hover:bg-[#19ad4b] active:bg-[#128036] text-white font-extrabold text-sm sm:text-base shadow-lg shadow-black/25 flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span>{doneButtonLabel}</span>
            </button>
          )}
        </div>
      )}
    </section>
  );
};
