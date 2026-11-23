import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../context/StoreContext';
import { Customer, PaymentMethod, SaleItem, BillAttachment } from '../types';
import { FileAttachment } from './FileAttachment';
import { AddItemsModal } from './AddItemsModal';
import {
  X,
  Search,
  Phone,
  UserCheck,
  Mic,
  MicOff,
  Award,
  AlertCircle,
  CheckCircle2,
  Plus,
  ShoppingBag,
  ChevronDown,
  ChevronUp,
  UserX,
} from 'lucide-react';
import { formatINR } from '../utils/accounting';
import { normalizeUnit } from '../utils/units';
import {
  resolveBaseQuantity,
  resolveProductUnitCostAtSale,
  validateSaleStock,
} from '../utils/inventoryEngine';
import { filterCustomersForQuickSale } from '../utils/customerSearch';
import { useTrackActiveTransaction } from './PWAInstallButton';
import { ThermalReceiptPreview, triggerCustomThermalPrint } from './ThermalReceiptPreview';
import { buildThermalReceiptFromSale } from '../utils/thermalPrint';
import { downloadSaleInvoicePDF } from '../utils/pdfGenerator';
import { WhatsAppReceiptModal } from './WhatsAppReceiptModal';
import {
  buildCustomerLoyaltyLedger,
  calculateLoyaltyRedemption,
  calculatePointsEarned,
  resolveLoyaltyConfig,
} from '../utils/loyalty';
import {
  buildSaleBillCustomerSummary,
  buildSaleBillFinancialSummary,
  resolveSaleBillStatus,
} from '../utils/saleBillViewModel';
import {
  SaleBillCard,
  SaleBillHeaderBar,
  SaleBillSubHeader,
} from './SaleBillCard';

const MAX_VISIBLE_CUSTOMER_RESULTS = 80;

function getCategoryBadgeClasses(category: Customer['category']): string {
  switch (category) {
    case 'OVERDUE':
      return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950/70 dark:text-red-300 dark:border-red-800';
    case 'HIGH_CREDIT':
      return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800';
    case 'CLEARED':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-800';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
  }
}

export const QuickSaleModal: React.FC = () => {
  const {
    isQuickSaleOpen,
    setIsQuickSaleOpen,
    customers,
    customerTransactions,
    products,
    sales,
    recordSale,
    profile,
    openThermalPrintSettings,
  } = useStore();

  useTrackActiveTransaction('quick-sale', isQuickSaleOpen);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [customerSearchQuery, setCustomerSearchQuery] = useState<string>('');
  const [isCustomerPickerOpen, setIsCustomerPickerOpen] = useState<boolean>(false);
  const [directAmount, setDirectAmount] = useState<string>('');
  const [cartItems, setCartItems] = useState<SaleItem[]>([]);
  const [notes, setNotes] = useState<string>('');
  const [attachments, setAttachments] = useState<BillAttachment[]>([]);
  const [selectedProductToAdd, setSelectedProductToAdd] = useState<string>('');
  const [addQty, setAddQty] = useState<number>(1);
  const [lastCompletedSaleId, setLastCompletedSaleId] = useState<string | null>(null);
  const [lastCompletedLoyalty, setLastCompletedLoyalty] = useState<{
    earned: number;
    redeemed: number;
    discount: number;
    grossAmount: number;
    netAmount: number;
    invoiceNo?: string;
  } | null>(null);
  const [loyaltyPointsToRedeem, setLoyaltyPointsToRedeem] = useState<string>('');
  const [isAddItemsOpen, setIsAddItemsOpen] = useState<boolean>(false);
  const [showThermalPreview, setShowThermalPreview] = useState<boolean>(false);
  const [isWhatsAppModalOpen, setIsWhatsAppModalOpen] = useState<boolean>(false);
  const [showExtrasSection, setShowExtrasSection] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionSuccessBanner, setActionSuccessBanner] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isListeningVoice, setIsListeningVoice] = useState<boolean>(false);
  const [voiceFeedback, setVoiceFeedback] = useState<string | null>(null);
  const [saleIdempotencyKey, setSaleIdempotencyKey] = useState<string>(
    () => `sale-req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  );

  const submitLockRef = useRef<boolean>(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const customerSectionRef = useRef<HTMLDivElement | null>(null);
  const attachmentSectionRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop?.();
      } catch {
        // ignore cleanup errors
      }
    };
  }, []);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );

  const matchingCustomers = useMemo(
    () => filterCustomersForQuickSale(customers, customerSearchQuery),
    [customers, customerSearchQuery]
  );

  const loyaltyConfig = useMemo(() => resolveLoyaltyConfig(profile), [profile]);

  const selectedCustomerLoyalty = useMemo(() => {
    if (!selectedCustomer) return null;
    return buildCustomerLoyaltyLedger(selectedCustomer, sales, loyaltyConfig);
  }, [selectedCustomer, sales, loyaltyConfig]);

  const completedSale = useMemo(
    () => (lastCompletedSaleId ? sales.find((s) => s.id === lastCompletedSaleId) || null : null),
    [lastCompletedSaleId, sales]
  );

  if (!isQuickSaleOpen) return null;

  const activeProducts = products.filter((p) => !p.isArchived);
  const isFinalized = Boolean(lastCompletedSaleId);

  // Existing calculation logic preserved verbatim
  const cartTotal = cartItems.reduce((sum, item) => sum + item.total, 0);
  const grossTotal = cartItems.length > 0 ? cartTotal : Number(directAmount) || 0;

  const requestedRedeemPoints = Math.max(0, Math.floor(Number(loyaltyPointsToRedeem) || 0));
  const loyaltyRedemption =
    selectedCustomer && selectedCustomerLoyalty && loyaltyConfig.enabled && grossTotal > 0
      ? calculateLoyaltyRedemption({
          availablePoints: selectedCustomerLoyalty.availablePoints,
          requestedPoints: requestedRedeemPoints,
          grossBillAmount: grossTotal,
          config: loyaltyConfig,
        })
      : {
          valid: true,
          pointsToRedeem: 0,
          discountAmount: 0,
          netPayableAmount: grossTotal,
          maxRedeemablePoints: 0,
          maxDiscountAmount: 0,
        };

  const finalTotal = loyaltyRedemption.valid ? loyaltyRedemption.netPayableAmount : grossTotal;
  const projectedPointsEarned =
    selectedCustomer && loyaltyConfig.enabled && finalTotal > 0
      ? calculatePointsEarned(finalTotal, loyaltyConfig)
      : 0;

  const visibleCustomers = matchingCustomers.slice(0, MAX_VISIBLE_CUSTOMER_RESULTS);

  const activeItems = completedSale ? completedSale.items : cartItems;
  const activePaymentMethod = completedSale ? completedSale.paymentMethod : paymentMethod;
  const activeCustomer = completedSale
    ? customers.find((c) => c.id === completedSale.customerId) || null
    : selectedCustomer;

  const financials = buildSaleBillFinancialSummary({
    items: activeItems,
    grossAmount: completedSale
      ? completedSale.grossAmount ?? completedSale.amount
      : grossTotal,
    netTotal: completedSale
      ? completedSale.amount
      : lastCompletedLoyalty?.netAmount ?? finalTotal,
    loyaltyDiscount: completedSale
      ? completedSale.loyaltyDiscountAmount || 0
      : loyaltyRedemption.discountAmount,
    paymentMethod: activePaymentMethod,
    isCredit: completedSale ? completedSale.isCredit : paymentMethod === 'CREDIT',
    isCancelled: completedSale
      ? completedSale.status === 'CANCELLED' || completedSale.status === 'REVERSED'
      : false,
  });

  const customerSummary = buildSaleBillCustomerSummary({
    customer: activeCustomer,
    billAmount: financials.grandTotal,
    paymentMethod: activePaymentMethod,
    isCredit: completedSale ? completedSale.isCredit : paymentMethod === 'CREDIT',
    isFinalized,
    isCancelled: completedSale
      ? completedSale.status === 'CANCELLED' || completedSale.status === 'REVERSED'
      : false,
    invoiceNo: completedSale?.invoiceNo || lastCompletedLoyalty?.invoiceNo || undefined,
    customerTransactions,
  });

  const statusMeta = resolveSaleBillStatus({
    isFinalized,
    sale: completedSale,
    paymentStatus: completedSale
      ? completedSale.isCredit || completedSale.paymentMethod === 'CREDIT'
        ? 'UNPAID'
        : 'PAID'
      : undefined,
  });

  const resolvedInvoiceNo = completedSale?.invoiceNo || lastCompletedLoyalty?.invoiceNo || null;

  const activeReceiptData = completedSale
    ? buildThermalReceiptFromSale(completedSale, activeCustomer?.currentBalance)
    : {
        invoiceNo: resolvedInvoiceNo || 'DRAFT',
        dateIso: new Date().toISOString(),
        paymentMethod: activePaymentMethod,
        customerName: activeCustomer?.name,
        customerBalanceAfter: customerSummary?.newOutstanding,
        items: activeItems.map((item) => ({
          productName: item.productName,
          quantity: item.quantity,
          unit: item.unit,
          rate: item.rate,
          discount: item.discount,
          total: item.total,
        })),
        grossAmount: financials.subtotal,
        loyaltyDiscountAmount: financials.loyaltyDiscount,
        loyaltyPointsRedeemed: isFinalized
          ? lastCompletedLoyalty?.redeemed ?? 0
          : loyaltyRedemption.pointsToRedeem,
        loyaltyPointsEarned: isFinalized
          ? lastCompletedLoyalty?.earned ?? 0
          : projectedPointsEarned,
        totalAmount: financials.grandTotal,
      };

  const handleSelectCustomer = (customer: Customer) => {
    setSelectedCustomerId(customer.id);
    setLoyaltyPointsToRedeem('');
    setIsCustomerPickerOpen(false);
    setFormError(null);
  };

  const handleClearCustomer = () => {
    setSelectedCustomerId('');
    setLoyaltyPointsToRedeem('');
    setFormError(null);
  };

  const handleOpenCustomerPicker = () => {
    setIsCustomerPickerOpen(true);
    setTimeout(() => {
      customerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      searchInputRef.current?.focus();
    }, 40);
  };

  const handleSelectPaymentMethod = (method: PaymentMethod) => {
    setPaymentMethod(method);
    setFormError(null);
    if (method === 'CREDIT' && !selectedCustomerId) {
      setIsCustomerPickerOpen(true);
      setTimeout(() => {
        customerSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        searchInputRef.current?.focus();
      }, 40);
    }
  };

  const handleAddProductToCart = () => {
    if (!selectedProductToAdd) return;
    const prod = activeProducts.find((p) => p.id === selectedProductToAdd);
    if (!prod) return;

    const qty = Number(addQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      setFormError('Quantity must be greater than zero.');
      return;
    }

    const existingSameUnitIndex = cartItems.findIndex(
      (item) =>
        item.productId === prod.id &&
        normalizeUnit(item.unit) === normalizeUnit(prod.unit)
    );

    let nextCart: SaleItem[];
    if (existingSameUnitIndex > -1) {
      nextCart = cartItems.map((item, idx) => {
        if (idx !== existingSameUnitIndex) return item;
        const newQty = Math.round((item.quantity + qty) * 10000) / 10000;
        const newBaseQty = resolveBaseQuantity(newQty, prod.unit, prod.unit);
        return {
          ...item,
          quantity: newQty,
          baseUnit: prod.unit,
          baseQuantity: newBaseQty,
          total: Math.round(newQty * item.rate * 100) / 100,
        };
      });
    } else {
      const baseQty = resolveBaseQuantity(qty, prod.unit, prod.unit);
      const costSnapshot = resolveProductUnitCostAtSale(prod);
      const newItem: SaleItem = {
        productId: prod.id,
        productName: prod.name,
        quantity: qty,
        unit: prod.unit,
        baseUnit: prod.unit,
        baseQuantity: baseQty,
        unitCostAtSale: costSnapshot.unitCostAtSale,
        costSnapshotSource: costSnapshot.costSnapshotSource,
        costCapturedAt: new Date().toISOString(),
        rate: prod.sellingPrice,
        total: Math.round(qty * prod.sellingPrice * 100) / 100,
      };
      nextCart = [...cartItems, newItem];
    }

    const stockCheck = validateSaleStock({
      items: nextCart,
      products,
      allowNegativeStock: Boolean(profile.allowNegativeStock),
    });
    if (!stockCheck.valid) {
      setFormError(stockCheck.error || 'Insufficient stock available.');
      return;
    }

    setCartItems(nextCart);
    setSelectedProductToAdd('');
    setAddQty(1);
    setDirectAmount('');
    setFormError(null);
  };

  const handleRemoveCartItem = (index: number) => {
    setCartItems(cartItems.filter((_, i) => i !== index));
    setFormError(null);
  };

  const executeGenerateBill = () => {
    if (submitLockRef.current || isSubmitting || isFinalized) return;

    if (grossTotal <= 0) {
      setFormError('Please add at least one product or enter a valid direct bill amount.');
      return;
    }

    if (requestedRedeemPoints > 0 && !loyaltyRedemption.valid) {
      setFormError(loyaltyRedemption.error || 'Invalid loyalty point redemption amount.');
      return;
    }

    if (cartItems.length > 0) {
      const stockCheck = validateSaleStock({
        items: cartItems,
        products,
        allowNegativeStock: Boolean(profile.allowNegativeStock),
      });
      if (!stockCheck.valid) {
        setFormError(stockCheck.error || 'Insufficient stock to complete this sale.');
        return;
      }
    }

    const validCustomer = customers.find((c) => c.id === selectedCustomerId);
    if (paymentMethod === 'CREDIT' && !validCustomer) {
      setFormError('Please select a customer for Credit (Udhar) sale.');
      handleOpenCustomerPicker();
      return;
    }

    setFormError(null);
    submitLockRef.current = true;
    setIsSubmitting(true);

    try {
      const res = recordSale({
        amount: finalTotal,
        grossAmount: grossTotal,
        loyaltyPointsRedeemed:
          validCustomer && loyaltyRedemption.pointsToRedeem > 0
            ? loyaltyRedemption.pointsToRedeem
            : undefined,
        paymentMethod,
        customerId: validCustomer ? validCustomer.id : undefined,
        customerName: validCustomer ? validCustomer.name : undefined,
        items: cartItems,
        notes,
        isCredit: paymentMethod === 'CREDIT',
        attachments,
        idempotencyKey: saleIdempotencyKey,
      });

      if (!res.success || !res.saleId) {
        setFormError(res.error || 'Unable to record sale due to stock or validation error.');
        return;
      }

      setLastCompletedLoyalty({
        earned: res.loyaltyPointsEarned || 0,
        redeemed: res.loyaltyPointsRedeemed || 0,
        discount: res.loyaltyDiscountAmount || 0,
        grossAmount: grossTotal,
        netAmount: finalTotal,
        invoiceNo: res.invoiceNo,
      });
      setLastCompletedSaleId(res.saleId);
      setIsCustomerPickerOpen(false);
      setActionSuccessBanner(
        `Bill #${res.invoiceNo} generated successfully (${formatINR(finalTotal)} · ${
          paymentMethod === 'UPI' ? 'Online / UPI' : paymentMethod === 'CREDIT' ? 'Credit (Udhar)' : 'Cash'
        }).`
      );
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  const stopVoiceSearch = () => {
    try {
      recognitionRef.current?.stop?.();
    } catch {
      // ignore stop errors
    }
    setIsListeningVoice(false);
  };

  const handleToggleVoiceSearch = () => {
    if (isListeningVoice) {
      stopVoiceSearch();
      return;
    }

    const SpeechRecognitionCtor =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;

    if (!SpeechRecognitionCtor) {
      setVoiceFeedback(
        'Voice search requires Chrome/Edge or Android WebView speech recognition support.'
      );
      return;
    }

    try {
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = 'en-IN';
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognitionRef.current = recognition;
      setVoiceFeedback('Listening... speak customer name');
      setIsListeningVoice(true);

      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results || [])
          .map((res: any) => res?.[0]?.transcript || '')
          .join(' ')
          .trim();

        if (transcript) {
          setCustomerSearchQuery(transcript);
          setIsCustomerPickerOpen(true);
          if (paymentMethod !== 'CREDIT') {
            const matched = filterCustomersForQuickSale(customers, transcript);
            if (matched.length > 0) {
              setSelectedCustomerId(matched[0].id);
              setVoiceFeedback(`Matched customer "${matched[0].name}" from "${transcript}"`);
            } else {
              setVoiceFeedback(`Heard "${transcript}" — no matching customer found`);
            }
          } else {
            setVoiceFeedback(`Heard: "${transcript}"`);
          }
          searchInputRef.current?.focus();
        }
      };

      recognition.onerror = (event: any) => {
        setIsListeningVoice(false);
        const errCode = event?.error;
        if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
          setVoiceFeedback('Microphone permission denied. Please allow mic access or type name.');
        } else if (errCode === 'no-speech') {
          setVoiceFeedback('No speech detected. Tap the mic and speak clearly.');
        } else {
          setVoiceFeedback('Could not capture voice search. Please try again or type.');
        }
      };

      recognition.onend = () => {
        setIsListeningVoice(false);
      };

      recognition.start();
    } catch {
      setIsListeningVoice(false);
      setVoiceFeedback('Unable to start microphone voice search on this device.');
    }
  };

  const resetForNextBill = () => {
    stopVoiceSearch();
    setCartItems([]);
    setDirectAmount('');
    setSelectedCustomerId('');
    setCustomerSearchQuery('');
    setIsCustomerPickerOpen(false);
    setPaymentMethod('CASH');
    setNotes('');
    setAttachments([]);
    setLastCompletedSaleId(null);
    setLastCompletedLoyalty(null);
    setLoyaltyPointsToRedeem('');
    setShowThermalPreview(false);
    setIsWhatsAppModalOpen(false);
    setShowExtrasSection(false);
    setFormError(null);
    setActionSuccessBanner(null);
    setVoiceFeedback(null);
    setIsSubmitting(false);
    submitLockRef.current = false;
    setSaleIdempotencyKey(`sale-req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  };

  const handleResetAndClose = () => {
    resetForNextBill();
    setIsQuickSaleOpen(false);
  };

  const handlePrintThermal = () => {
    void triggerCustomThermalPrint({
      profile,
      receipt: activeReceiptData,
    });
  };

  const handleDownloadPdf = () => {
    if (!completedSale) return;
    downloadSaleInvoicePDF(completedSale, profile, activeCustomer || undefined);
  };

  const handleFocusAttachments = () => {
    setShowExtrasSection(true);
    setTimeout(() => {
      attachmentSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Arjun Groceries Sale Bill"
      data-testid="sale-bill-screen"
      className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center sm:p-4 overflow-hidden"
    >
      <div className="w-full h-full sm:h-auto sm:max-h-[94vh] sm:max-w-5xl bg-[#f4f7f4] dark:bg-slate-950 sm:rounded-[28px] sm:shadow-2xl sm:border sm:border-emerald-900/20 dark:sm:border-emerald-800/40 flex flex-col overflow-hidden">
        {/* Top Dark Green Arjun Groceries Header Bar */}
        <SaleBillHeaderBar
          profile={profile}
          onBack={handleResetAndClose}
          onPrint={handlePrintThermal}
          canPrint={isFinalized || financials.grandTotal > 0}
          onDownloadPdf={handleDownloadPdf}
          canDownloadPdf={Boolean(completedSale)}
          onShareWhatsApp={() => {
            if (completedSale) setIsWhatsAppModalOpen(true);
          }}
          canShareWhatsApp={Boolean(completedSale)}
          onToggleThermalPreview={() => setShowThermalPreview((v) => !v)}
          showThermalPreview={showThermalPreview}
          onFocusAttachment={!isFinalized ? handleFocusAttachments : undefined}
          onCustomizePrint={() => {
            handleResetAndClose();
            openThermalPrintSettings();
          }}
        />

        {/* Scrollable Workspace Body */}
        <div className="flex-1 overflow-y-auto px-3.5 sm:px-6 py-4 sm:py-5 space-y-4">
          {/* Sale Bill Sub-Header (Title + Invoice Badge + Status) */}
          <SaleBillSubHeader
            invoiceNo={resolvedInvoiceNo}
            statusKind={statusMeta.kind}
            statusLabel={statusMeta.label}
            dateIso={completedSale?.date}
          />

          {/* Feedback Banners */}
          {formError && (
            <div
              role="alert"
              data-testid="sale-bill-error-banner"
              className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-2xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-xs sm:text-sm font-semibold text-red-700 dark:text-red-300"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}

          {actionSuccessBanner && (
            <div
              role="status"
              data-testid="sale-bill-success-banner"
              className="flex items-start justify-between gap-2.5 px-3.5 py-2.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-xs sm:text-sm font-semibold text-emerald-900 dark:text-emerald-200"
            >
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
                <span>{actionSuccessBanner}</span>
              </div>
              <button
                type="button"
                onClick={resetForNextBill}
                className="text-xs font-extrabold text-emerald-800 dark:text-emerald-300 underline underline-offset-2 cursor-pointer shrink-0 whitespace-nowrap"
              >
                + New Bill
              </button>
            </div>
          )}

          {/* Responsive Grid: Mobile single-column matching reference; Desktop 2-column with side tools */}
          <div
            className={
              isFinalized && !showThermalPreview
                ? 'max-w-lg mx-auto w-full'
                : 'grid grid-cols-1 lg:grid-cols-12 gap-4 items-start'
            }
          >
            {/* Primary Signature Sale Bill Card */}
            <div className={isFinalized && !showThermalPreview ? 'w-full' : 'lg:col-span-7 space-y-4'}>
              <SaleBillCard
                profile={profile}
                items={activeItems}
                directAmountFallback={
                  activeItems.length === 0 ? Number(directAmount) || completedSale?.amount || 0 : 0
                }
                notes={completedSale ? completedSale.notes : notes}
                financials={financials}
                paymentMethod={activePaymentMethod}
                onSelectPaymentMethod={!isFinalized ? handleSelectPaymentMethod : undefined}
                customerSummary={customerSummary}
                onOpenCustomerPicker={!isFinalized ? handleOpenCustomerPicker : undefined}
                onOpenAddItems={!isFinalized ? () => setIsAddItemsOpen(true) : undefined}
                onRemoveItem={!isFinalized ? handleRemoveCartItem : undefined}
                isFinalized={isFinalized}
                isSubmitting={isSubmitting}
                submitLabel="Generate Bill"
                onGenerateBill={executeGenerateBill}
                loyaltyEarned={
                  isFinalized
                    ? completedSale?.loyaltyPointsEarned ?? lastCompletedLoyalty?.earned ?? 0
                    : projectedPointsEarned
                }
                loyaltyRedeemed={
                  isFinalized
                    ? completedSale?.loyaltyPointsRedeemed ?? lastCompletedLoyalty?.redeemed ?? 0
                    : loyaltyRedemption.pointsToRedeem
                }
                onPreviewThermal={() => setShowThermalPreview((v) => !v)}
                showThermalPreview={showThermalPreview}
                onDownloadPdf={completedSale ? handleDownloadPdf : undefined}
                onPrintBill={handlePrintThermal}
                onShareWhatsApp={completedSale ? () => setIsWhatsAppModalOpen(true) : undefined}
                onDoneOrNewBill={handleResetAndClose}
                doneButtonLabel="Done / Back to Store"
              />
            </div>

            {/* Side / Secondary Panel: Thermal Receipt Preview (when toggled) OR Draft Controls */}
            {showThermalPreview && isFinalized ? (
              <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
                  <span className="text-xs font-extrabold text-slate-900 dark:text-white">
                    Thermal Print Receipt Preview
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowThermalPreview(false)}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                  >
                    Hide
                  </button>
                </div>
                <ThermalReceiptPreview profile={profile} receipt={activeReceiptData} />
              </div>
            ) : !isFinalized ? (
              <div className="lg:col-span-5 space-y-3.5">
                {/* 1. Quick Item Picker & Direct Counter Amount */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-xs font-extrabold text-slate-800 dark:text-slate-100 uppercase tracking-wide">
                      Add Products or Quick Total
                    </h4>
                    <button
                      type="button"
                      onClick={() => setIsAddItemsOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition-colors cursor-pointer"
                    >
                      <ShoppingBag className="w-3.5 h-3.5" />
                      <span>{cartItems.length > 0 ? `Edit Items (${cartItems.length})` : 'Open Catalog'}</span>
                    </button>
                  </div>

                  {/* Quick single-item dropdown */}
                  <div className="flex gap-2">
                    <select
                      aria-label="Quick Choose Product"
                      value={selectedProductToAdd}
                      onChange={(e) => setSelectedProductToAdd(e.target.value)}
                      className="flex-1 min-w-0 text-xs border border-slate-300 dark:border-slate-700 rounded-xl px-2.5 py-2.5 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-emerald-600"
                    >
                      <option value="">-- Quick Add Product --</option>
                      {activeProducts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.unit}) · {formatINR(p.sellingPrice)} (Stock: {p.stockQty})
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min="0.1"
                      step="any"
                      aria-label="Quick Add Quantity"
                      value={addQty}
                      onChange={(e) => setAddQty(parseFloat(e.target.value) || 1)}
                      className="w-16 text-center text-xs font-bold border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl p-2 tabular-nums"
                    />
                    <button
                      type="button"
                      data-testid="quick-add-product-btn"
                      onClick={handleAddProductToCart}
                      disabled={!selectedProductToAdd}
                      className="px-3.5 py-2 min-h-[40px] bg-emerald-700 hover:bg-emerald-800 disabled:opacity-45 text-white rounded-xl text-xs font-bold cursor-pointer flex items-center gap-1 shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add</span>
                    </button>
                  </div>

                  {/* Direct Counter Amount Fallback */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                      Or Enter Direct Counter Amount (₹)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                        ₹
                      </span>
                      <input
                        type="number"
                        min="1"
                        step="any"
                        aria-label="Direct Sale Amount"
                        placeholder={
                          cartItems.length > 0
                            ? 'Calculated automatically from items'
                            : 'e.g. 250 (without itemized list)'
                        }
                        value={cartItems.length > 0 ? cartTotal : directAmount}
                        onChange={(e) => {
                          setDirectAmount(e.target.value);
                          if (formError) setFormError(null);
                        }}
                        disabled={cartItems.length > 0}
                        className="w-full text-sm font-bold pl-7 pr-3 py-2.5 border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-emerald-600 disabled:opacity-60 tabular-nums"
                      />
                    </div>
                  </div>
                </div>

                {/* 2. Customer Account Picker (Expandable or Auto-open on Credit) */}
                <div
                  ref={customerSectionRef}
                  className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setIsCustomerPickerOpen((v) => !v)}
                      className="flex items-center gap-2 text-xs font-extrabold text-slate-800 dark:text-slate-100 uppercase tracking-wide cursor-pointer"
                    >
                      <span>
                        Customer Account {paymentMethod === 'CREDIT' ? '(Required)' : '(Optional)'}
                      </span>
                      {isCustomerPickerOpen ? (
                        <ChevronUp className="w-4 h-4 text-slate-500" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-500" />
                      )}
                    </button>

                    {selectedCustomer && (
                      <button
                        type="button"
                        onClick={handleClearCustomer}
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 cursor-pointer"
                      >
                        <UserX className="w-3.5 h-3.5" />
                        <span>Walk-in</span>
                      </button>
                    )}
                  </div>

                  {selectedCustomer && !isCustomerPickerOpen && (
                    <div
                      data-testid="selected-customer-summary-pill"
                      className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <UserCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 dark:text-white truncate">
                            {selectedCustomer.name}
                          </div>
                          <div className="text-[11px] text-slate-600 dark:text-slate-400 tabular-nums">
                            {selectedCustomer.phone || 'No mobile'} · Ledger:{' '}
                            {formatINR(selectedCustomer.currentBalance)}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsCustomerPickerOpen(true)}
                        className="text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer shrink-0"
                      >
                        Change
                      </button>
                    </div>
                  )}

                  {(isCustomerPickerOpen || (paymentMethod === 'CREDIT' && !selectedCustomer)) && (
                    <div className="space-y-2">
                      <div className="relative">
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
                        <input
                          ref={searchInputRef}
                          type="search"
                          value={customerSearchQuery}
                          onChange={(e) => {
                            setCustomerSearchQuery(e.target.value);
                            if (voiceFeedback) setVoiceFeedback(null);
                          }}
                          placeholder="Search customer by name or mobile..."
                          aria-label="Search customer by name or mobile number"
                          className="w-full pl-9 pr-20 py-2.5 text-sm rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                        />
                        <div className="absolute right-1.5 top-1.5 flex items-center gap-1">
                          {customerSearchQuery && (
                            <button
                              type="button"
                              onClick={() => {
                                setCustomerSearchQuery('');
                                setVoiceFeedback(null);
                                searchInputRef.current?.focus();
                              }}
                              aria-label="Clear customer search"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={handleToggleVoiceSearch}
                            aria-label={
                              isListeningVoice
                                ? 'Stop voice customer search'
                                : 'Search customer by voice'
                            }
                            aria-pressed={isListeningVoice}
                            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                              isListeningVoice
                                ? 'bg-red-600 text-white'
                                : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100'
                            }`}
                          >
                            {isListeningVoice ? (
                              <MicOff className="w-4 h-4" />
                            ) : (
                              <Mic className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>

                      {voiceFeedback && (
                        <div
                          role="status"
                          className="text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                        >
                          {voiceFeedback}
                        </div>
                      )}

                      {matchingCustomers.length === 0 ? (
                        <div className="rounded-xl p-3.5 text-center border border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
                          No customer matches &ldquo;{customerSearchQuery}&rdquo;.
                        </div>
                      ) : (
                        <div
                          role="listbox"
                          aria-label="Matching customers"
                          className="max-h-48 overflow-y-auto space-y-1.5 pr-0.5"
                        >
                          {visibleCustomers.map((c) => {
                            const isSelected = c.id === selectedCustomerId;
                            return (
                              <button
                                key={c.id}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                onClick={() => handleSelectCustomer(c)}
                                className={`w-full text-left p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-2 ${
                                  isSelected
                                    ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-500 ring-1 ring-emerald-500'
                                    : 'bg-slate-50/70 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700 hover:border-emerald-400 hover:bg-emerald-50/40'
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-bold text-xs text-slate-900 dark:text-slate-100 truncate">
                                      {c.name}
                                    </span>
                                    <span
                                      className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${getCategoryBadgeClasses(
                                        c.category
                                      )}`}
                                    >
                                      {c.category}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1">
                                    <Phone className="w-3 h-3" />
                                    <span>{c.phone || 'No mobile'}</span>
                                  </div>
                                </div>
                                <div className="text-right shrink-0">
                                  <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                    Outstanding
                                  </div>
                                  <div
                                    className={`text-xs font-extrabold tabular-nums ${
                                      c.currentBalance > 0
                                        ? 'text-red-700 dark:text-red-400'
                                        : 'text-emerald-700 dark:text-emerald-400'
                                    }`}
                                  >
                                    {formatINR(c.currentBalance)}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 3. Loyalty Points Earn & Redemption (when customer selected) */}
                {selectedCustomer && selectedCustomerLoyalty && loyaltyConfig.enabled && (
                  <div
                    data-testid="quicksale-loyalty-panel"
                    className="p-3.5 rounded-2xl bg-emerald-50/90 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-emerald-700 text-white">
                          <Award className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-emerald-950 dark:text-emerald-200">
                            Loyalty Rewards · {selectedCustomer.name}
                          </div>
                          <div className="text-[11px] text-emerald-800 dark:text-emerald-300 tabular-nums">
                            Available: <strong>{selectedCustomerLoyalty.availablePoints} pts</strong> (
                            {formatINR(selectedCustomerLoyalty.redeemableValueRs)})
                          </div>
                        </div>
                      </div>
                      {projectedPointsEarned > 0 && (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg bg-white dark:bg-emerald-900/70 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-700 tabular-nums">
                          +{projectedPointsEarned} pts
                        </span>
                      )}
                    </div>

                    {selectedCustomerLoyalty.availablePoints >= loyaltyConfig.minRedeemPoints &&
                    grossTotal > 0 &&
                    loyaltyRedemption.maxRedeemablePoints >= loyaltyConfig.minRedeemPoints ? (
                      <div className="space-y-1.5 pt-1 border-t border-emerald-200/70 dark:border-emerald-800/60">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="0"
                            max={loyaltyRedemption.maxRedeemablePoints}
                            step="1"
                            aria-label="Redeem loyalty points"
                            placeholder={`Redeem pts (max ${loyaltyRedemption.maxRedeemablePoints})`}
                            value={loyaltyPointsToRedeem}
                            onChange={(e) => {
                              setLoyaltyPointsToRedeem(e.target.value);
                              setFormError(null);
                            }}
                            className="flex-1 text-xs font-bold p-2 rounded-xl border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 tabular-nums"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setLoyaltyPointsToRedeem(String(loyaltyRedemption.maxRedeemablePoints))
                            }
                            className="px-2.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-bold cursor-pointer whitespace-nowrap"
                          >
                            Use Max
                          </button>
                          {requestedRedeemPoints > 0 && (
                            <button
                              type="button"
                              onClick={() => setLoyaltyPointsToRedeem('')}
                              className="px-2 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-[11px] font-bold cursor-pointer"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                        {!loyaltyRedemption.valid && loyaltyRedemption.error && (
                          <div className="text-[11px] font-semibold text-red-700 dark:text-red-300">
                            {loyaltyRedemption.error}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                )}

                {/* 4. Notes & Attach Bill Document (Collapsible to keep screen tidy) */}
                <div
                  ref={attachmentSectionRef}
                  className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3"
                >
                  <button
                    type="button"
                    onClick={() => setShowExtrasSection((v) => !v)}
                    className="w-full flex items-center justify-between text-xs font-extrabold text-slate-700 dark:text-slate-200 cursor-pointer"
                  >
                    <span>
                      Bill Note &amp; Photo Attachment
                      {attachments.length > 0 ? ` (${attachments.length} attached)` : ''}
                    </span>
                    {showExtrasSection ? (
                      <ChevronUp className="w-4 h-4 text-slate-500" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-500" />
                    )}
                  </button>

                  {showExtrasSection && (
                    <div className="space-y-3 pt-1">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                          Bill Note / Remark
                        </label>
                        <input
                          type="text"
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder="e.g. Monthly grocery pack, delivered home"
                          className="w-full text-xs border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl p-2.5 focus:outline-emerald-600"
                        />
                      </div>

                      <FileAttachment
                        attachments={attachments}
                        onChange={setAttachments}
                        billType="SALE"
                        label="Attach Signed Slip / Payment Screenshot"
                        helperText="Optional paper bill photo or UPI payment confirmation"
                        onOcrExtracted={(data) => {
                          if (data.totalAmount) setDirectAmount(String(data.totalAmount));
                          if (data.partyName) {
                            const match = customers.find((c) =>
                              c.name.toLowerCase().includes(data.partyName!.toLowerCase())
                            );
                            if (match) {
                              setSelectedCustomerId(match.id);
                            } else {
                              setNotes((prev) =>
                                prev ? `${prev} | Customer: ${data.partyName}` : `Customer: ${data.partyName}`
                              );
                            }
                          }
                          if (data.notes) setNotes(data.notes);
                          if (data.items && data.items.length > 0) {
                            const converted = data.items.map((it) => ({
                              productName: it.name,
                              quantity: it.quantity,
                              unit: it.unit,
                              rate: it.rate,
                              total: it.total,
                            }));
                            setCartItems(converted);
                          }
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Inline Thermal Preview while drafting if user selected Preview from More menu */}
                {showThermalPreview && (
                  <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
                        Draft Thermal Receipt Preview
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowThermalPreview(false)}
                        className="text-xs font-semibold text-slate-500 cursor-pointer"
                      >
                        Hide
                      </button>
                    </div>
                    <ThermalReceiptPreview profile={profile} receipt={activeReceiptData} />
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {/* Add Items Modal (Existing smart units & item discounts preserved verbatim) */}
        {isAddItemsOpen && (
          <AddItemsModal
            isOpen={isAddItemsOpen}
            onClose={() => setIsAddItemsOpen(false)}
            products={activeProducts}
            initialItems={cartItems}
            allowNegativeStock={Boolean(profile.allowNegativeStock)}
            onConfirmItems={(items) => {
              setCartItems(items);
              setFormError(null);
              if (items.length > 0) {
                setDirectAmount('');
              }
            }}
            allowCustomItem={true}
          />
        )}

        {/* WhatsApp Share Modal for Completed Sale */}
        {isWhatsAppModalOpen && completedSale && (
          <WhatsAppReceiptModal
            sale={completedSale}
            profile={profile}
            customer={activeCustomer || undefined}
            onClose={() => setIsWhatsAppModalOpen(false)}
          />
        )}
      </div>
    </div>
  );
};
