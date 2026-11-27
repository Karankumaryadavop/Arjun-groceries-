import React, { useEffect, useState } from 'react';
import { StoreProvider, useStore } from './context/StoreContext';
import { Sidebar } from './components/Sidebar';
import { MobileNav } from './components/MobileNav';
import { Header } from './components/Header';
import { DashboardView } from './components/DashboardView';
import { BillsAuditView } from './components/BillsAuditView';
import { FinancialOverviewView } from './components/FinancialOverviewView';
import { CustomersView } from './components/CustomersView';
import { SuppliersView } from './components/SuppliersView';
import { SalesView } from './components/SalesView';
import { PurchasesView } from './components/PurchasesView';
import { ExpensesView } from './components/ExpensesView';
import { CashbookView } from './components/CashbookView';
import { InventoryView } from './components/InventoryView';
import { AnalyticsView } from './components/AnalyticsView';
import { ReportsView } from './components/ReportsView';
import { BillDocumentsView } from './components/BillDocumentsView';
import { WhatsAppRemindersView } from './components/WhatsAppRemindersView';
import { SettingsView } from './components/SettingsView';
import { QuickSaleModal } from './components/QuickSaleModal';
import { BackupModal } from './components/BackupModal';
import { DailyClosingReportModal } from './components/DailyClosingReportModal';
import { PinLockScreen } from './components/PinLockScreen';
import { FirstTimeSetupScreen } from './components/FirstTimeSetupScreen';
import { WelcomeScreen } from './components/WelcomeScreen';
import { LoginScreen } from './components/LoginScreen';
import { AuthSplashScreen } from './components/AuthSplashScreen';
import { CustomerPortalView } from './components/CustomerPortalView';
import { SupplierPortalView } from './components/SupplierPortalView';
import { OfflineIndicator, SafeUpdateBanner } from './components/PWAInstallButton';
import { BrandLogo } from './components/BrandLogo';
import { GlobalErrorBoundary } from './components/ErrorBoundary';

export { GlobalErrorBoundary };

const shouldSkipWelcomeOnLaunch = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('autostart') === '1';
  } catch {
    return false;
  }
};

const MainAppContent: React.FC = () => {
  const {
    profile,
    activeTab,
    setActiveTab,
    authStatus,
    authInitStage,
    authSession,
    authNotice,
    isLocked,
    dbInitError,
    needsFirstTimeSetup,
    retryDatabaseInit,
    storageStatus,
    clearStorageError,
    setIsBackupModalOpen,
  } = useStore();

  const [showLoginFromWelcome, setShowLoginFromWelcome] = useState<boolean>(() =>
    shouldSkipWelcomeOnLaunch()
  );

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [activeTab]);

  useEffect(() => {
    if (authStatus === 'authenticated') {
      setShowLoginFromWelcome(false);
    }
  }, [authStatus]);

  useEffect(() => {
    if (authNotice) {
      setShowLoginFromWelcome(true);
    }
  }, [authNotice]);

  if (dbInitError) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl border border-red-200 dark:border-red-900 shadow-lg p-6 space-y-4">
          <BrandLogo sizeClass="w-16 h-16" className="mx-auto shadow-sm" />
          <div>
            <h1 className="text-lg font-extrabold text-red-800 dark:text-red-300">
              Local Database Could Not Open
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-2 leading-relaxed">
              {dbInitError}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
              Your existing records were not overwritten or reset. Close other open tabs of this app or check device storage, then retry.
            </p>
          </div>
          <button
            type="button"
            onClick={retryDatabaseInit}
            className="w-full py-2.5 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold cursor-pointer"
          >
            Retry Opening Database
          </button>
        </div>
      </div>
    );
  }

  // Dedicated Splash Screen while transitioning out of 'auth-initializing'
  // Guarantees neither LoginScreen nor protected routes mount prematurely.
  if (authStatus === 'auth-initializing') {
    return (
      <AuthSplashScreen
        storeName={profile.storeName}
        authStatus={authStatus}
        stage={authInitStage}
      />
    );
  }

  if (authStatus === 'unauthenticated') {
    if (authNotice || showLoginFromWelcome) {
      return (
        <div data-auth-status={authStatus}>
          <LoginScreen />
        </div>
      );
    }
    return (
      <div data-auth-status={authStatus}>
        <WelcomeScreen
          isReady={true}
          storeName={profile.storeName}
          needsSetup={needsFirstTimeSetup}
          onContinue={() => setShowLoginFromWelcome(true)}
        />
      </div>
    );
  }

  // Strict role-scoped portal routing: Customers and Suppliers can ONLY view their own portal.
  if (authSession?.authMode === 'CUSTOMER') {
    return (
      <div data-auth-status={authStatus} data-portal-role="CUSTOMER">
        <CustomerPortalView />
      </div>
    );
  }

  if (authSession?.authMode === 'SUPPLIER') {
    return (
      <div data-auth-status={authStatus} data-portal-role="SUPPLIER">
        <SupplierPortalView />
      </div>
    );
  }

  if (isLocked) {
    return (
      <div data-auth-status={authStatus}>
        <PinLockScreen />
      </div>
    );
  }

  if (needsFirstTimeSetup) {
    return (
      <div data-auth-status={authStatus}>
        <FirstTimeSetupScreen />
        <BackupModal />
      </div>
    );
  }

  return (
    <div
      data-auth-status={authStatus}
      className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col lg:flex-row text-slate-800 dark:text-slate-100 antialiased font-sans transition-colors"
    >
      {/* Desktop Sidebar (hidden on mobile) */}
      <Sidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 pb-16 lg:pb-0">
        <Header />

        <OfflineIndicator />

        <SafeUpdateBanner />

        {storageStatus.storageError && (
          <div
            role="alert"
            className="mx-3.5 sm:mx-6 lg:mx-8 mt-3 p-3.5 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-300 dark:border-red-800 text-red-900 dark:text-red-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-xs"
          >
            <div>
              <strong className="font-bold block">Local Storage Warning</strong>
              <span>{storageStatus.storageError}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setIsBackupModalOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-800 text-white font-bold cursor-pointer"
              >
                Export Backup Now
              </button>
              <button
                type="button"
                onClick={clearStorageError}
                className="px-2.5 py-1.5 rounded-lg border border-red-300 dark:border-red-700 font-semibold cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <main className="flex-1 p-3.5 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          <GlobalErrorBoundary
            scope="view"
            resetKey={activeTab}
            onNavigateHome={() => setActiveTab('DASHBOARD')}
          >
            {activeTab === 'DASHBOARD' && <DashboardView />}
            {activeTab === 'BILLS_AUDIT' && <BillsAuditView />}
            {activeTab === 'FINANCIAL_OVERVIEW' && <FinancialOverviewView />}
            {activeTab === 'CUSTOMERS' && <CustomersView />}
            {activeTab === 'SUPPLIERS' && <SuppliersView />}
            {activeTab === 'SALES' && <SalesView />}
            {activeTab === 'PURCHASES' && <PurchasesView />}
            {activeTab === 'EXPENSES' && <ExpensesView />}
            {activeTab === 'CASHBOOK' && <CashbookView />}
            {activeTab === 'INVENTORY' && <InventoryView />}
            {activeTab === 'ANALYTICS' && <AnalyticsView />}
            {activeTab === 'REPORTS' && <ReportsView />}
            {activeTab === 'DOCUMENTS' && <BillDocumentsView />}
            {activeTab === 'WHATSAPP_REMINDERS' && <WhatsAppRemindersView />}
            {activeTab === 'SETTINGS' && <SettingsView />}
          </GlobalErrorBoundary>
        </main>
      </div>

      {/* Mobile Bottom Navigation (hidden on desktop) */}
      <MobileNav />

      {/* Universal Quick Sale POS Modal */}
      <QuickSaleModal />

      {/* Manual Data Backup & Restore Modal */}
      <BackupModal />

      {/* Daily End-of-Day Closing Report Modal */}
      <DailyClosingReportModal />
    </div>
  );
};

export default function App() {
  return (
    <GlobalErrorBoundary scope="app">
      <StoreProvider>
        <MainAppContent />
      </StoreProvider>
    </GlobalErrorBoundary>
  );
}
