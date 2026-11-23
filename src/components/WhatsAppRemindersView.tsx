/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { useStore } from '../context/StoreContext';
import {
  CustomerReminderItem,
  WhatsAppApiConfig,
  WhatsAppReminderBatch,
} from '../types';
import { formatINR } from '../utils/accounting';
import {
  MessageSquare,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Send,
  Eye,
  Settings,
  ShieldCheck,
  RefreshCw,
  Users,
  FileText,
  PhoneCall,
  CheckSquare,
  Square,
  Edit3,
  Calendar,
  AlertCircle,
  ExternalLink,
  Ban,
  ChevronRight,
  Filter,
  Check,
  Key,
  BarChart3,
} from 'lucide-react';
import { WhatsAppAnalyticsTab } from './WhatsAppAnalyticsTab';
import { useOnlineStatus } from './PWAInstallButton';

export const WhatsAppRemindersView: React.FC = () => {
  const {
    profile,
    whatsappBatches,
    currentBatch,
    whatsappConfig,
    whatsappAuditLogs,
    nextScheduleInfo,
    isLoadingWhatsApp,
    generateWhatsAppBatch,
    approveWhatsAppBatch,
    cancelWhatsAppBatch,
    sendApprovedWhatsAppBatch,
    updateWhatsAppConfig,
    testWhatsAppConnection,
    sendTestWhatsAppMessage,
    loadWhatsAppBatches,
    customers,
    verifyPin,
  } = useStore();

  const isOnline = useOnlineStatus();

  const [activeSubTab, setActiveSubTab] = useState<'BATCH' | 'ANALYTICS' | 'HISTORY' | 'SETTINGS'>('BATCH');
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<Set<string>>(new Set());
  const [filterEligibility, setFilterEligibility] = useState<'ALL' | 'ELIGIBLE' | 'EXCLUDED'>('ALL');
  const [previewItem, setPreviewItem] = useState<CustomerReminderItem | null>(null);
  const [editingItem, setEditingItem] = useState<CustomerReminderItem | null>(null);
  const [customMsgText, setCustomMsgText] = useState('');
  const [actionBannerError, setActionBannerError] = useState<string | null>(null);

  // Cancel Batch inline modal state
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('Discarded by store owner');

  // Confirmation Modal state
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [liveDispatchAcknowledged, setLiveDispatchAcknowledged] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sendResultSummary, setSendResultSummary] = useState<{
    sent: number;
    failed: number;
    skipped: number;
  } | null>(null);

  // Settings & Manual Test Mode form state
  const [configWabaId, setConfigWabaId] = useState(whatsappConfig?.businessAccountId || '');
  const [configPhoneId, setConfigPhoneId] = useState(whatsappConfig?.phoneNumberId || '');
  const [configToken, setConfigToken] = useState('');
  const [configWebhookToken, setConfigWebhookToken] = useState('');
  const [configTemplate, setConfigTemplate] = useState(whatsappConfig?.templateName || 'payment_reminder_weekly');
  const [configLang, setConfigLang] = useState(whatsappConfig?.templateLanguage || 'hi');
  const [configTestNumber, setConfigTestNumber] = useState(whatsappConfig?.verifiedTestNumber || '');
  const [configSandbox, setConfigSandbox] = useState(whatsappConfig?.sandboxMode ?? true);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSendingTestMsg, setIsSendingTestMsg] = useState(false);
  const [manualTestResult, setManualTestResult] = useState<{
    success: boolean;
    message: string;
    messageId?: string;
    formattedPhone?: string;
    sandboxSimulated?: boolean;
  } | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Initialize selected customers when currentBatch changes
  React.useEffect(() => {
    if (currentBatch?.items) {
      const eligibleIds = new Set(
        currentBatch.items.filter((i) => i.approved && i.eligibilityStatus === 'ELIGIBLE').map((i) => i.customerId)
      );
      setSelectedCustomerIds(eligibleIds);
    }
  }, [currentBatch?.id]);

  // Update local config form when whatsappConfig loads
  React.useEffect(() => {
    if (whatsappConfig) {
      setConfigWabaId(whatsappConfig.businessAccountId || '');
      setConfigPhoneId(whatsappConfig.phoneNumberId || '');
      setConfigTemplate(whatsappConfig.templateName || 'payment_reminder_weekly');
      setConfigLang(whatsappConfig.templateLanguage || 'hi');
      setConfigTestNumber(whatsappConfig.verifiedTestNumber || '');
      setConfigSandbox(whatsappConfig.sandboxMode);
    }
  }, [whatsappConfig]);

  const displayedBatch = currentBatch;

  // Filtered customer items
  const filteredItems = useMemo(() => {
    if (!displayedBatch?.items) return [];
    if (filterEligibility === 'ALL') return displayedBatch.items;
    if (filterEligibility === 'ELIGIBLE') {
      return displayedBatch.items.filter((i) => i.eligibilityStatus === 'ELIGIBLE');
    }
    return displayedBatch.items.filter((i) => i.eligibilityStatus !== 'ELIGIBLE');
  }, [displayedBatch?.items, filterEligibility]);

  // Calculations for selected items
  const selectedApprovedCount = selectedCustomerIds.size;
  const selectedApprovedAmount = useMemo(() => {
    if (!displayedBatch?.items) return 0;
    return displayedBatch.items
      .filter((i) => selectedCustomerIds.has(i.customerId))
      .reduce((sum, i) => sum + i.totalOutstanding, 0);
  }, [displayedBatch?.items, selectedCustomerIds]);

  // Handle Select All toggle
  const handleToggleSelectAll = () => {
    if (!displayedBatch?.items) return;
    const allEligible = displayedBatch.items.filter((i) => i.eligibilityStatus === 'ELIGIBLE');
    if (selectedCustomerIds.size === allEligible.length) {
      setSelectedCustomerIds(new Set());
    } else {
      setSelectedCustomerIds(new Set(allEligible.map((i) => i.customerId)));
    }
  };

  // Handle single customer toggle
  const handleToggleCustomer = (customerId: string) => {
    const next = new Set(selectedCustomerIds);
    if (next.has(customerId)) {
      next.delete(customerId);
    } else {
      next.add(customerId);
    }
    setSelectedCustomerIds(next);
  };

  // Open Message Preview
  const handleOpenPreview = (item: CustomerReminderItem) => {
    setPreviewItem(item);
  };

  // Open Message Editor
  const handleOpenEdit = (item: CustomerReminderItem) => {
    setEditingItem(item);
    setCustomMsgText(item.customizedMessage || item.messageText);
  };

  const handleSaveCustomMessage = () => {
    if (!editingItem || !displayedBatch) return;
    editingItem.customizedMessage = customMsgText.trim();
    setEditingItem(null);
  };

  // Approval step
  const handleInitiateApproval = () => {
    if (selectedApprovedCount === 0) {
      setActionBannerError('Please select at least one eligible customer to send payment reminders.');
      return;
    }
    setActionBannerError(null);
    setSendError(null);
    setLiveDispatchAcknowledged(false);
    setIsConfirmModalOpen(true);
    setConfirmPin('');
    setPinError('');
  };

  // Confirm and Send
  const handleConfirmAndSend = async () => {
    if (!displayedBatch) return;

    // Check PIN if enabled via salted PBKDF2 verification
    if (profile.isPinEnabled) {
      const pinValid = await verifyPin(confirmPin);
      if (!pinValid) {
        setPinError('Invalid Store PIN. Authorization failed.');
        return;
      }
    }

    const isLive = whatsappConfig ? !whatsappConfig.sandboxMode : false;
    if (isLive && !liveDispatchAcknowledged) {
      setSendError('Please confirm that you reviewed recipients before live WhatsApp dispatch.');
      return;
    }

    setIsSending(true);
    setSendError(null);
    try {
      // 1. Save approval selection to server
      const approvedIds = Array.from(selectedCustomerIds);
      await approveWhatsAppBatch(displayedBatch.id, approvedIds);

      // 2. Dispatch sending queue
      const result = await sendApprovedWhatsAppBatch(displayedBatch.id);
      setSendResultSummary({
        sent: result.sentCount,
        failed: result.failedCount,
        skipped: result.skippedCount,
      });
      setIsConfirmModalOpen(false);
    } catch (err: any) {
      setSendError(`Send failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsSending(false);
    }
  };

  // Save Config Form
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateWhatsAppConfig({
      businessAccountId: configWabaId,
      phoneNumberId: configPhoneId,
      accessToken: configToken || undefined,
      webhookVerifyToken: configWebhookToken || undefined,
      verifiedTestNumber: configTestNumber,
      templateName: configTemplate,
      templateLanguage: configLang,
      sandboxMode: configSandbox,
    });
    setSaveSuccess(true);
    setConfigToken(''); // Clear secret inputs after save
    setConfigWebhookToken('');
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  // Run Connection & Template Verification Ping
  const handleRunTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await testWhatsAppConnection();
      setTestResult(res);
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || 'Network error' });
    } finally {
      setIsTesting(false);
    }
  };

  // Run Manual Test Mode single template send
  const handleSendManualTestMessage = async () => {
    setIsSendingTestMsg(true);
    setManualTestResult(null);
    try {
      const res = await sendTestWhatsAppMessage({
        testPhoneNumber: configTestNumber,
      });
      setManualTestResult({
        success: res.success,
        message: res.message,
        messageId: res.messageId,
        formattedPhone: res.formattedPhone,
        sandboxSimulated: res.sandboxSimulated,
      });
    } catch (err: any) {
      setManualTestResult({
        success: false,
        message: err?.message || 'Failed to dispatch test message',
      });
    } finally {
      setIsSendingTestMsg(false);
    }
  };

  return (
    <div className="space-y-6 pb-12 max-w-7xl mx-auto">
      {!isOnline && (
        <div
          role="status"
          className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 px-4 py-3 text-xs text-amber-950 dark:text-amber-200 flex items-center gap-2.5"
        >
          <AlertCircle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
          <span>
            <strong>WhatsApp Reminders require internet:</strong> You are currently offline. Customer khata, sales, and purchases keep working offline, and WhatsApp dispatch resumes once internet is restored.
          </span>
        </div>
      )}
      {/* Top Banner & Header */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-6 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 rounded-xl">
              <MessageSquare className="w-5 h-5" />
            </span>
            <div>
              <div className="text-xs uppercase font-extrabold tracking-wider text-emerald-800 dark:text-emerald-400">
                Weekly Bulk WhatsApp Reminders (Bulk WhatsApp Takada)
              </div>
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-slate-100 mt-0.5">
                Payment Reminder System
              </h1>
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 max-w-2xl leading-relaxed">
            Auto-prepares unpaid invoices from the previous 7 days every Sunday at 12:00 PM IST.
            <strong className="text-slate-800 dark:text-slate-200 ml-1">Messages are never sent automatically.</strong> You must review, approve, and confirm before sending.
          </p>
        </div>

        {/* Quick Actions & Status */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => generateWhatsAppBatch(true)}
            disabled={isLoadingWhatsApp}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingWhatsApp ? 'animate-spin' : ''}`} />
            <span>Generate / Recalculate Batch</span>
          </button>
          <button
            type="button"
            onClick={() => loadWhatsAppBatches()}
            title="Refresh Status"
            className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* API Configuration Warning if unconfigured and not in Sandbox */}
      {whatsappConfig && !whatsappConfig.isConfigured && !whatsappConfig.sandboxMode && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-amber-900 dark:text-amber-200">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-bold">WhatsApp Business API is not configured</div>
              <div className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                Connect your official WhatsApp Business account or enable Sandbox mode to test reminder dispatching safely.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveSubTab('SETTINGS')}
            className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-colors shrink-0"
          >
            Configure API
          </button>
        </div>
      )}

      {/* Sub Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveSubTab('BATCH')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer shrink-0 ${
            activeSubTab === 'BATCH'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700'
          }`}
        >
          <CheckSquare className="w-4 h-4" />
          <span>Current Batch & Review</span>
          {displayedBatch && (
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                activeSubTab === 'BATCH' ? 'bg-emerald-900 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              {displayedBatch.totalEligibleCustomers}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('ANALYTICS')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer shrink-0 ${
            activeSubTab === 'ANALYTICS'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>Analytics &amp; Impact</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('HISTORY')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer shrink-0 ${
            activeSubTab === 'HISTORY'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Batch History & Logs</span>
          <span
            className={`text-[10px] px-1.5 py-0.2 rounded-full ${
              activeSubTab === 'HISTORY' ? 'bg-emerald-900 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
            }`}
          >
            {whatsappBatches.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('SETTINGS')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer shrink-0 ${
            activeSubTab === 'SETTINGS'
              ? 'bg-emerald-700 text-white shadow-xs'
              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span>Schedule & Meta API Config</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* SUB-TAB 1B: WHATSAPP ANALYTICS & RECOVERY IMPACT */}
      {/* ========================================================================= */}
      {activeSubTab === 'ANALYTICS' && <WhatsAppAnalyticsTab />}

      {/* ========================================================================= */}
      {/* SUB-TAB 1: CURRENT BATCH & APPROVAL REVIEW */}
      {/* ========================================================================= */}
      {activeSubTab === 'BATCH' && (
        <div className="space-y-6">
          {/* Batch KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">Next Scheduled</div>
              <div className="text-xs font-bold text-slate-900 dark:text-slate-100 mt-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                <span>Sunday 12:00 PM IST</span>
              </div>
              <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">Asia/Kolkata (Weekly)</div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">Batch Status</div>
              <div className="text-xs font-bold mt-1">
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-extrabold ${
                    displayedBatch?.status === 'COMPLETED'
                      ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                      : displayedBatch?.status === 'READY_FOR_REVIEW' || displayedBatch?.status === 'AWAITING_APPROVAL'
                      ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                      : displayedBatch?.status === 'SENDING'
                      ? 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {displayedBatch?.status || 'No Batch Yet'}
                </span>
              </div>
              <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">{displayedBatch?.id || 'Click Generate'}</div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">Eligible Customers</div>
              <div className="text-lg font-black text-slate-900 dark:text-slate-100 mt-0.5">
                {displayedBatch?.totalEligibleCustomers || 0}
              </div>
              <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold">Valid Phone & Consent</div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">Eligible Invoices</div>
              <div className="text-lg font-black text-slate-900 dark:text-slate-100 mt-0.5">
                {displayedBatch?.totalEligibleInvoices || 0}
              </div>
              <div className="text-[10px] text-slate-400 dark:text-slate-500">Past 7 days bills</div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">Total Outstanding</div>
              <div className="text-lg font-black text-red-600 dark:text-red-400 mt-0.5">
                {formatINR(displayedBatch?.totalOutstandingAmount || 0)}
              </div>
              <div className="text-[10px] text-slate-400 dark:text-slate-500">Total Udhar in Batch</div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">Excluded Accounts</div>
              <div className="text-lg font-black text-amber-600 dark:text-amber-400 mt-0.5">
                {displayedBatch?.excludedCustomersCount || 0}
              </div>
              <div className="text-[10px] text-slate-400 dark:text-slate-500">
                {displayedBatch?.customersWithMissingPhone || 0} No Phone · {displayedBatch?.customersWithoutConsent || 0} Opt-Out
              </div>
            </div>
          </div>

          {/* Mode & Verification Status Banner */}
          {whatsappConfig && (
            <div
              className={`rounded-2xl p-3.5 border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs ${
                whatsappConfig.sandboxMode
                  ? 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                  : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
              }`}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                    whatsappConfig.sandboxMode
                      ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                      : 'bg-emerald-700 text-white'
                  }`}
                >
                  {whatsappConfig.sandboxMode ? 'Sandbox Mode' : 'Live Meta Cloud API'}
                </span>
                <span>
                  {whatsappConfig.sandboxMode
                    ? 'Safe local simulation active — zero Meta API network calls will be executed.'
                    : `Connected to ${whatsappConfig.verifiedDisplayPhone || whatsappConfig.phoneNumberId || 'Meta Cloud API'} · Template: ${whatsappConfig.templateName} (${whatsappConfig.templateStatus || 'UNVERIFIED'})`}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setActiveSubTab('SETTINGS')}
                className="font-bold text-emerald-700 dark:text-emerald-400 hover:underline shrink-0 cursor-pointer text-left sm:text-right"
              >
                API & Test Mode
              </button>
            </div>
          )}

          {actionBannerError && (
            <div className="bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-2xl p-3.5 text-xs text-red-800 dark:text-red-200 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{actionBannerError}</span>
              </div>
              <button
                type="button"
                onClick={() => setActionBannerError(null)}
                className="font-bold cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Result Alert if sending just completed */}
          {sendResultSummary && (
            <div className="bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-4 text-emerald-900 dark:text-emerald-200 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-bold">WhatsApp Dispatch Completed!</div>
                <div className="text-xs text-emerald-800 dark:text-emerald-300 mt-1">
                  Successfully dispatched <strong>{sendResultSummary.sent}</strong> WhatsApp reminders.
                  {sendResultSummary.failed > 0 && (
                    <span className="text-red-700 dark:text-red-400 font-bold ml-1.5">({sendResultSummary.failed} failed)</span>
                  )}
                  {sendResultSummary.skipped > 0 && (
                    <span className="text-amber-700 dark:text-amber-400 font-bold ml-1.5">({sendResultSummary.skipped} skipped as already sent or settled)</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSendResultSummary(null)}
                className="text-xs font-bold text-emerald-800 dark:text-emerald-300 hover:text-emerald-950 dark:hover:text-emerald-100 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Action Toolbar & Filters */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleToggleSelectAll}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg text-xs font-bold transition-colors cursor-pointer"
              >
                {selectedCustomerIds.size > 0 && selectedCustomerIds.size === displayedBatch?.totalEligibleCustomers ? (
                  <>
                    <CheckSquare className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                    <span>Deselect All</span>
                  </>
                ) : (
                  <>
                    <Square className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                    <span>Select All Eligible ({displayedBatch?.totalEligibleCustomers || 0})</span>
                  </>
                )}
              </button>

              {/* Filter */}
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setFilterEligibility('ALL')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    filterEligibility === 'ALL' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs' : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  All ({displayedBatch?.items.length || 0})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterEligibility('ELIGIBLE')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    filterEligibility === 'ELIGIBLE' ? 'bg-white dark:bg-slate-700 text-emerald-800 dark:text-emerald-300 shadow-xs font-bold' : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Eligible ({displayedBatch?.totalEligibleCustomers || 0})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterEligibility('EXCLUDED')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    filterEligibility === 'EXCLUDED' ? 'bg-white dark:bg-slate-700 text-amber-800 dark:text-amber-300 shadow-xs font-bold' : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Excluded ({displayedBatch?.excludedCustomersCount || 0})
                </button>
              </div>
            </div>

            {/* Approval & Dispatch Trigger */}
            <div className="flex items-center gap-2">
              {displayedBatch && displayedBatch.status !== 'COMPLETED' && displayedBatch.status !== 'CANCELLED' && (
                <button
                  type="button"
                  onClick={() => {
                    setCancelReason('Discarded by store owner');
                    setIsCancelModalOpen(true);
                  }}
                  className="px-3 py-1.5 text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel Batch
                </button>
              )}

              <button
                type="button"
                onClick={handleInitiateApproval}
                disabled={selectedApprovedCount === 0 || isSending}
                className="flex items-center gap-2 px-5 py-2 bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send className="w-4 h-4" />
                <span>
                  Approve & Send to {selectedApprovedCount} Customers ({formatINR(selectedApprovedAmount)})
                </span>
              </button>
            </div>
          </div>

          {/* Customer Review Table */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">Customer Bill Breakdown & Verification</h3>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Verify individual bill numbers, paid amounts and remaining dues before approving message dispatch.
                </div>
              </div>
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                Selected: {selectedCustomerIds.size} / {displayedBatch?.totalEligibleCustomers || 0}
              </span>
            </div>

            {!displayedBatch || displayedBatch.items.length === 0 ? (
              <div className="p-12 text-center text-slate-500 dark:text-slate-400">
                <CheckCircle2 className="w-10 h-10 text-emerald-600 dark:text-emerald-400 mx-auto mb-2 opacity-80" />
                <div className="text-sm font-bold text-slate-800 dark:text-slate-100">No Pending 7-Day Unpaid Invoices</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
                  All credit invoices from the previous 7 days have either been cleared or no new credit bills were created.
                </div>
                <button
                  type="button"
                  onClick={() => generateWhatsAppBatch(true)}
                  className="mt-4 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold"
                >
                  Check Invoices Now
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-3 px-3 w-10 text-center">
                        <span className="sr-only">Select</span>
                      </th>
                      <th className="py-3 px-3">Customer & WhatsApp</th>
                      <th className="py-3 px-3">Pending Invoices (7 Days)</th>
                      <th className="py-3 px-3 text-right">Original Total</th>
                      <th className="py-3 px-3 text-right">Paid</th>
                      <th className="py-3 px-3 text-right">Outstanding</th>
                      <th className="py-3 px-3">Eligibility / Status</th>
                      <th className="py-3 px-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredItems.map((item) => {
                      const isSelected = selectedCustomerIds.has(item.customerId);
                      const isEligible = item.eligibilityStatus === 'ELIGIBLE';

                      return (
                        <tr
                          key={item.customerId}
                          className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/60 transition-colors ${
                            !isEligible ? 'bg-slate-50/40 dark:bg-slate-800/30 text-slate-400 dark:text-slate-500' : ''
                          }`}
                        >
                          {/* Checkbox */}
                          <td className="py-3 px-3 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={!isEligible}
                              onChange={() => handleToggleCustomer(item.customerId)}
                              className="w-4 h-4 text-emerald-700 rounded border-slate-300 dark:border-slate-600 focus:ring-emerald-500 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                            />
                          </td>

                          {/* Customer */}
                          <td className="py-3 px-3">
                            <div className="font-bold text-slate-900 dark:text-slate-100 text-xs">{item.customerName}</div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5">
                              <PhoneCall className="w-3 h-3 text-slate-400 dark:text-slate-500" />
                              <span>{item.phone || 'No phone recorded'}</span>
                            </div>
                            {item.lastReminderDate && (
                              <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                                Last reminder: {new Date(item.lastReminderDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                              </div>
                            )}
                          </td>

                          {/* Invoices Grouped */}
                          <td className="py-3 px-3">
                            <div className="space-y-1">
                              {item.invoices.map((inv) => (
                                <div key={inv.invoiceId} className="flex items-center gap-1.5 text-[11px]">
                                  <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 px-1 py-0.2 rounded">
                                    {inv.invoiceNo}
                                  </span>
                                  <span className="text-slate-400 dark:text-slate-500 text-[10px]">
                                    ({new Date(inv.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })})
                                  </span>
                                  <span className="font-bold text-red-600 dark:text-red-400">
                                    {formatINR(inv.outstandingAmount)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </td>

                          {/* Original Total */}
                          <td className="py-3 px-3 text-right font-medium">
                            {formatINR(item.invoices.reduce((sum, inv) => sum + inv.originalAmount, 0))}
                          </td>

                          {/* Paid */}
                          <td className="py-3 px-3 text-right font-medium text-emerald-700 dark:text-emerald-400">
                            {formatINR(item.invoices.reduce((sum, inv) => sum + inv.paidAmount, 0))}
                          </td>

                          {/* Remaining Outstanding */}
                          <td className="py-3 px-3 text-right font-black text-red-600 dark:text-red-400">
                            {formatINR(item.totalOutstanding)}
                          </td>

                          {/* Status */}
                          <td className="py-3 px-3">
                            {item.status === 'SENT' || item.status === 'ACCEPTED' || item.status === 'DELIVERED' || item.status === 'READ' ? (
                              <div className="space-y-0.5">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 rounded text-[10px] font-bold">
                                  <CheckCircle2 className="w-3 h-3" />
                                  <span>{item.status}</span>
                                </span>
                                {item.apiResponseSummary?.sandboxSimulated && (
                                  <div className="text-[10px] text-slate-500 dark:text-slate-400">Sandbox Simulated</div>
                                )}
                                {item.sentAt && (
                                  <div className="text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">
                                    {new Date(item.sentAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                                    {item.attempts ? ` · ${item.attempts} att.` : ''}
                                  </div>
                                )}
                              </div>
                            ) : item.status === 'FAILED' ? (
                              <div className="space-y-0.5">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300 rounded text-[10px] font-bold">
                                  <XCircle className="w-3 h-3" />
                                  <span>FAILED</span>
                                </span>
                                {item.errorReason && (
                                  <div className="text-[10px] text-red-600 dark:text-red-400 max-w-[160px] truncate" title={item.errorReason}>
                                    {item.errorReason}
                                  </div>
                                )}
                              </div>
                            ) : isEligible ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 rounded text-[10px] font-bold">
                                <Check className="w-3 h-3" />
                                <span>{item.status === 'APPROVED' ? 'Approved' : 'Eligible'}</span>
                              </span>
                            ) : item.eligibilityStatus === 'MISSING_PHONE' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300 rounded text-[10px] font-bold">
                                <AlertTriangle className="w-3 h-3" />
                                <span>No Valid Mobile</span>
                              </span>
                            ) : item.eligibilityStatus === 'NO_CONSENT' ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 rounded text-[10px] font-bold">
                                <Ban className="w-3 h-3" />
                                <span>Opted Out</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded text-[10px] font-bold">
                                {item.status}
                              </span>
                            )}
                            {item.wabaMessageId && (
                              <div className="text-[9px] font-mono text-slate-400 dark:text-slate-500 mt-1 truncate max-w-[135px]" title={item.wabaMessageId}>
                                {item.wabaMessageId}
                              </div>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleOpenPreview(item)}
                                title="View Message Preview"
                                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-600 dark:text-slate-400 hover:text-emerald-700 dark:hover:text-emerald-400 cursor-pointer"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenEdit(item)}
                                title="Customize Message Note"
                                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-600 dark:text-slate-400 hover:text-emerald-700 dark:hover:text-emerald-400 cursor-pointer"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 2: BATCH HISTORY & AUDIT LOGS */}
      {/* ========================================================================= */}
      {activeSubTab === 'HISTORY' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-4">
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base mb-1">Weekly Bulk Reminder Batches</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
              Historical batches generated by the Sunday 12:00 PM IST background scheduler or manual trigger.
            </p>

            {whatsappBatches.length === 0 ? (
              <div className="text-center py-10 text-slate-400 dark:text-slate-500 text-xs">
                No past batches recorded. Batches will appear here after creation.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {whatsappBatches.map((batch) => (
                  <div key={batch.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200">{batch.id}</span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-extrabold ${
                            batch.status === 'COMPLETED'
                              ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                              : batch.status === 'AWAITING_APPROVAL' || batch.status === 'READY_FOR_REVIEW'
                              ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                              : batch.status === 'SENDING'
                              ? 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {batch.status}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap gap-3">
                        <span>Window: {batch.dateWindowStart.slice(0, 10)} to {batch.dateWindowEnd.slice(0, 10)}</span>
                        <span>Customers: {batch.totalEligibleCustomers}</span>
                        <span>Amount: {formatINR(batch.totalOutstandingAmount)}</span>
                        {batch.approvedBy && <span>Approved by: {batch.approvedBy}</span>}
                      </div>
                    </div>

                    <div className="text-right text-xs text-slate-400 dark:text-slate-500">
                      <div>Created: {new Date(batch.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Audit Logs */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-4">
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base mb-1">WhatsApp Audit & Delivery Logs</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
              Real-time audit events, Meta Cloud API message IDs and delivery webhook callbacks.
            </p>

            {whatsappAuditLogs.length === 0 ? (
              <div className="text-center py-8 text-slate-400 dark:text-slate-500 text-xs">
                No WhatsApp audit logs yet.
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {whatsappAuditLogs.map((log) => (
                  <div key={log.id} className="p-2.5 bg-slate-50 dark:bg-slate-800/70 rounded-lg text-xs border border-slate-100 dark:border-slate-800">
                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="font-bold text-emerald-800 dark:text-emerald-400">{log.action}</span>
                      <span>{new Date(log.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    </div>
                    <div className="text-slate-800 dark:text-slate-200 mt-1 font-medium">{log.details}</div>
                    {log.wabaMessageId && (
                      <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500 mt-0.5">WABA ID: {log.wabaMessageId}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 3: SCHEDULE & WHATSAPP API CONFIGURATION */}
      {/* ========================================================================= */}
      {activeSubTab === 'SETTINGS' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Schedule Information + Manual Test Mode */}
          <div className="space-y-6">
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-5 space-y-4">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
                <Calendar className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Automatic Weekly Schedule</h3>
              </div>

              <div className="p-4 bg-emerald-50 dark:bg-emerald-950/50 rounded-xl border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-950 dark:text-emerald-200 space-y-2">
                <div className="font-bold text-sm text-emerald-900 dark:text-emerald-300 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                  <span>Every Sunday at 12:00 PM IST (Asia/Kolkata)</span>
                </div>
                <p className="text-emerald-800 dark:text-emerald-300/90 leading-relaxed">
                  The backend scheduler runs automatically in background every Sunday at 12:00 PM IST. It compiles all unpaid credit sales from the preceding 7 consecutive 24-hour periods.
                </p>
                <div className="pt-2 border-t border-emerald-200/80 dark:border-emerald-800 text-[11px] font-semibold text-emerald-900 dark:text-emerald-300">
                  Next scheduled batch execution: <strong>{nextScheduleInfo?.nextExecutionISO ? new Date(nextScheduleInfo.nextExecutionISO).toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' }) : 'Sunday 12:00 PM IST'}</strong>
                </div>
              </div>

              <div className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
                <div className="font-bold text-slate-800 dark:text-slate-200 text-sm">Scheduler Safety Guarantees:</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Never sends messages without explicit owner approval and review.</li>
                  <li>Uses persistent server-side idempotency locks to prevent duplicate sends.</li>
                  <li>Operates on persisted server store snapshots even when browser tabs close.</li>
                  <li>Excludes customers who opted out or have cleared balances.</li>
                </ul>
              </div>
            </div>

            {/* Manual Test Mode Card */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-5 space-y-3.5 text-xs">
              <div className="flex items-center justify-between pb-2.5 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <PhoneCall className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                  <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm">Manual Test Mode (Single Verification Send)</h3>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  {configSandbox ? 'Sandbox Simulation' : 'Live Meta API'}
                </span>
              </div>
              <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
                Send a single template verification message only to your verified test WhatsApp number. Does not affect customer balances or weekly batches.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="tel"
                  placeholder="Enter verified test number (e.g. 9876543210 or +919876543210)"
                  value={configTestNumber}
                  onChange={(e) => setConfigTestNumber(e.target.value)}
                  className="flex-1 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-3 py-2 text-xs font-mono"
                />
                <button
                  type="button"
                  onClick={handleSendManualTestMessage}
                  disabled={isSendingTestMsg}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50 shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isSendingTestMsg ? 'Sending Test...' : 'Send Single Test Message'}</span>
                </button>
              </div>
              {manualTestResult && (
                <div
                  className={`p-3 rounded-lg border font-medium ${
                    manualTestResult.success
                      ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800'
                      : 'bg-red-50 dark:bg-red-950/50 text-red-900 dark:text-red-200 border-red-200 dark:border-red-900'
                  }`}
                >
                  <div>{manualTestResult.message}</div>
                  {manualTestResult.messageId && (
                    <div className="text-[10px] font-mono mt-1 opacity-80">
                      Ref: {manualTestResult.messageId}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right: Meta WhatsApp Business Platform Config */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Meta WhatsApp Cloud API Settings</h3>
              </div>
              <div className="flex items-center gap-1.5">
                {whatsappConfig?.configuredViaEnv && (
                  <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300">
                    Env Loaded
                  </span>
                )}
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-extrabold ${
                    whatsappConfig?.isConfigured ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300' : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                  }`}
                >
                  {whatsappConfig?.isConfigured ? 'Configured' : 'Action Required'}
                </span>
              </div>
            </div>

            {/* Verified Business & Template Status Strip */}
            {whatsappConfig && (
              <div className="grid grid-cols-2 gap-2.5 p-3 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl text-xs">
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">Business Phone Verification</div>
                  <div className="font-bold text-slate-900 dark:text-slate-100 mt-0.5 truncate">
                    {whatsappConfig.verifiedDisplayPhone || whatsappConfig.verifiedBusinessName || (whatsappConfig.sandboxMode ? 'Sandbox Local' : 'Not Tested Yet')}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">Meta Template Status</div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
                        whatsappConfig.templateStatus === 'APPROVED'
                          ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                          : whatsappConfig.templateStatus === 'PENDING'
                          ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                          : whatsappConfig.templateStatus === 'REJECTED' || whatsappConfig.templateStatus === 'NOT_FOUND'
                          ? 'bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      {whatsappConfig.templateStatus || 'UNKNOWN'}
                    </span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                      ({whatsappConfig.templateLanguage})
                    </span>
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleSaveConfig} className="space-y-3.5 text-xs">
              {/* Sandbox Mode Toggle */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-800 dark:text-slate-200">Sandbox / Test Mode</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Simulate Meta API locally without calling Meta Graph API</div>
                </div>
                <input
                  type="checkbox"
                  checked={configSandbox}
                  onChange={(e) => setConfigSandbox(e.target.checked)}
                  className="w-5 h-5 text-emerald-700 rounded focus:ring-emerald-500 cursor-pointer"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">WhatsApp Business Account ID (WABA ID)</label>
                <input
                  type="text"
                  placeholder="e.g. 109823478912345"
                  value={configWabaId}
                  onChange={(e) => setConfigWabaId(e.target.value)}
                  className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2 text-xs focus:outline-emerald-600"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Phone Number ID</label>
                <input
                  type="text"
                  placeholder="e.g. 102938475610293"
                  value={configPhoneId}
                  onChange={(e) => setConfigPhoneId(e.target.value)}
                  className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2 text-xs focus:outline-emerald-600"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  System User Access Token
                  {whatsappConfig?.hasAccessToken && (
                    <span className="text-emerald-700 dark:text-emerald-400 font-bold ml-2">(Stored: {whatsappConfig.accessTokenMasked})</span>
                  )}
                </label>
                <input
                  type="password"
                  placeholder={whatsappConfig?.hasAccessToken ? '•••••••• (Enter new to replace)' : 'Paste permanent system user access token'}
                  value={configToken}
                  onChange={(e) => setConfigToken(e.target.value)}
                  className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2 text-xs focus:outline-emerald-600 font-mono"
                />
                <span className="text-[10px] text-slate-400 dark:text-slate-500">Tokens remain strictly on the backend server and are never exported or exposed to browser storage.</span>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Webhook Verify Token
                  {whatsappConfig?.hasWebhookVerifyToken && (
                    <span className="text-emerald-700 dark:text-emerald-400 font-bold ml-2">(Stored: {whatsappConfig.webhookVerifyTokenMasked})</span>
                  )}
                </label>
                <input
                  type="password"
                  placeholder={whatsappConfig?.hasWebhookVerifyToken ? '•••••••• (Enter new to update webhook secret)' : 'Enter Meta webhook verification secret'}
                  value={configWebhookToken}
                  onChange={(e) => setConfigWebhookToken(e.target.value)}
                  className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2 text-xs focus:outline-emerald-600 font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Approved Template Name</label>
                  <input
                    type="text"
                    value={configTemplate}
                    onChange={(e) => setConfigTemplate(e.target.value)}
                    className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2 text-xs focus:outline-emerald-600 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Template Language</label>
                  <select
                    value={configLang}
                    onChange={(e) => setConfigLang(e.target.value)}
                    className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg p-2 text-xs focus:outline-emerald-600"
                  >
                    <option value="hi">Hindi (hi)</option>
                    <option value="en">English (en)</option>
                    <option value="en_US">English US (en_US)</option>
                    <option value="mr">Marathi (mr)</option>
                    <option value="gu">Gujarati (gu)</option>
                  </select>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={handleRunTest}
                  disabled={isTesting}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                  <span>Verify API & Template</span>
                </button>

                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold transition-colors shadow-xs cursor-pointer"
                >
                  Save API Config
                </button>
              </div>

              {saveSuccess && (
                <div className="text-emerald-700 dark:text-emerald-400 text-xs font-bold mt-1 text-right">
                  Configuration saved securely on server.
                </div>
              )}

              {testResult && (
                <div
                  className={`p-3 rounded-lg text-xs font-medium border ${
                    testResult.success
                      ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800'
                      : 'bg-red-50 dark:bg-red-950/50 text-red-900 dark:text-red-200 border-red-200 dark:border-red-900'
                  }`}
                >
                  {testResult.message}
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: MESSAGE PREVIEW MODAL */}
      {/* ========================================================================= */}
      {previewItem && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">WhatsApp Message Preview</h3>
                <div className="text-xs text-slate-500 dark:text-slate-400">Recipient: {previewItem.customerName} ({previewItem.phone})</div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {/* Chat Bubble UI */}
            <div className="bg-[#e5ddd5] dark:bg-slate-800 p-4 rounded-xl shadow-inner min-h-[220px]">
              <div className="bg-white dark:bg-slate-900 rounded-lg p-3.5 shadow-sm max-w-[90%] text-xs text-slate-800 dark:text-slate-100 whitespace-pre-wrap leading-relaxed font-sans border border-slate-200 dark:border-slate-700">
                {previewItem.customizedMessage || previewItem.messageText}
                <div className="text-[10px] text-slate-400 dark:text-slate-500 text-right mt-2 flex items-center justify-end gap-1">
                  <span>12:00 PM</span>
                  <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-bold"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: CUSTOMIZE MESSAGE MODAL */}
      {/* ========================================================================= */}
      {editingItem && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-5 space-y-4 shadow-2xl border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Edit Reminder Message</h3>
                <div className="text-xs text-slate-500 dark:text-slate-400">Editing for {editingItem.customerName}</div>
              </div>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <textarea
              rows={8}
              value={customMsgText}
              onChange={(e) => setCustomMsgText(e.target.value)}
              className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl p-3 text-xs font-mono focus:outline-emerald-600"
            />

            <div className="text-[10px] text-slate-400 dark:text-slate-500">
              * Note: In production WhatsApp Cloud API, variables are mapped to Meta-approved template parameters.
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCustomMessage}
                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold"
              >
                Save Message
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: EXPLICIT OWNER APPROVAL & CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      {isConfirmModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl border border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-3 text-emerald-800 dark:text-emerald-300">
              <div className="p-2.5 bg-emerald-100 dark:bg-emerald-950 rounded-xl">
                <ShieldCheck className="w-6 h-6 text-emerald-800 dark:text-emerald-400" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Owner Approval Required</h3>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {whatsappConfig?.sandboxMode
                    ? 'Sandbox Simulation Mode (Zero Meta API Calls)'
                    : 'Live Meta WhatsApp Cloud API Dispatch'}
                </div>
              </div>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-800/70 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 space-y-2">
              <p className="font-medium text-slate-800 dark:text-slate-100 leading-relaxed">
                You are about to send payment reminders to <strong>{selectedApprovedCount}</strong> customers for a combined outstanding amount of <strong>{formatINR(selectedApprovedAmount)}</strong>.
              </p>
              <div className="text-[11px] text-slate-600 dark:text-slate-400 space-y-1 pt-1 border-t border-slate-200 dark:border-slate-700">
                <div>
                  Mode: <strong>{whatsappConfig?.sandboxMode ? 'SANDBOX (Local Simulation)' : 'LIVE META GRAPH API'}</strong>
                </div>
                <div>
                  Template: <strong className="font-mono">{whatsappConfig?.templateName || 'payment_reminder_weekly'} ({whatsappConfig?.templateLanguage || 'hi'})</strong>
                </div>
                <div>Invoices settled before sending are automatically excluded.</div>
              </div>
            </div>

            {sendError && (
              <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs font-semibold text-red-700 dark:text-red-300">
                {sendError}
              </div>
            )}

            {whatsappConfig && !whatsappConfig.sandboxMode && (
              <label className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-950 dark:text-amber-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={liveDispatchAcknowledged}
                  onChange={(e) => setLiveDispatchAcknowledged(e.target.checked)}
                  className="w-4 h-4 mt-0.5 text-emerald-700 rounded"
                />
                <span>
                  I confirm I have reviewed these recipients and authorize live WhatsApp template dispatch via Meta Cloud API.
                </span>
              </label>
            )}

            {/* PIN verification if enabled */}
            {profile.isPinEnabled && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Enter Store Security PIN to Confirm
                </label>
                <div className="relative">
                  <Key className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="password"
                    maxLength={6}
                    placeholder="Enter PIN (e.g. 1234)"
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value)}
                    className="w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl py-2 pl-9 pr-3 text-sm focus:outline-emerald-600 font-mono tracking-widest"
                  />
                </div>
                {pinError && <div className="text-red-600 dark:text-red-400 text-xs mt-1 font-bold">{pinError}</div>}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsConfirmModalOpen(false)}
                disabled={isSending}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmAndSend}
                disabled={isSending}
                className="flex items-center gap-2 px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer disabled:opacity-50"
              >
                {isSending ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Dispatching Queue...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>Confirm & Send Now</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: INLINE CANCEL BATCH CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      {isCancelModalOpen && displayedBatch && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Cancel Reminder Batch?</h3>
              <button
                type="button"
                onClick={() => setIsCancelModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2 text-xs">
              <label className="block font-semibold text-slate-700 dark:text-slate-300">
                Reason for Cancelling Batch
              </label>
              <input
                type="text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="w-full border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIsCancelModalOpen(false)}
                className="px-3.5 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold cursor-pointer"
              >
                Keep Batch
              </button>
              <button
                type="button"
                onClick={async () => {
                  await cancelWhatsAppBatch(
                    displayedBatch.id,
                    cancelReason.trim() || 'Discarded by store owner'
                  );
                  setIsCancelModalOpen(false);
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                Confirm Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
