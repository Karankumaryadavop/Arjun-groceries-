import React, { useState } from 'react';
import { useStore } from '../context/StoreContext';
import {
  Bell,
  Lock,
  Plus,
  Database,
  Sun,
  Moon,
  MoonStar,
  LogOut,
} from 'lucide-react';
import { NotificationModal } from './NotificationModal';
import { PWAInstallButton } from './PWAInstallButton';
import { BrandLogo, BRAND_NAME } from './BrandLogo';

export const Header: React.FC = () => {
  const {
    activeTab,
    profile,
    alerts,
    setIsQuickSaleOpen,
    setIsBackupModalOpen,
    setIsDailyClosingOpen,
    theme,
    toggleTheme,
    lockApp,
    logout,
  } = useStore();

  const [isAlertsOpen, setIsAlertsOpen] = useState(false);

  const unreadAlertsCount = alerts.filter((a) => !a.read).length;

  return (
    <header className="lg:sticky lg:top-0 z-30 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-2.5 sm:px-6 shadow-xs transition-colors">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-0 lg:gap-2.5">
        {/* Left: Store Identity & Mobile Brand */}
        <div className="flex items-center justify-between min-w-0">
          {activeTab === 'DASHBOARD' ? (
            <div className="flex items-center gap-2 min-w-0">
              <div className="hidden lg:block min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base leading-tight truncate">
                    {profile.storeName || BRAND_NAME}
                  </span>
                  <span className="hidden 2xl:inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 shrink-0">
                    Active Shop
                  </span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {profile.address ? profile.address.split(',')[0] : 'Daily Retail Ledger'} · {profile.ownerName || 'Owner'}
                </div>
              </div>
              <div className="lg:hidden flex items-center gap-2 min-w-0">
                <BrandLogo sizeClass="w-7 h-7" roundedClass="rounded-lg" />
                <span className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{BRAND_NAME}</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="lg:hidden shrink-0">
                <BrandLogo sizeClass="w-9 h-9" roundedClass="rounded-xl" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base leading-tight truncate">
                    {profile.storeName || BRAND_NAME}
                  </span>
                  <span className="hidden 2xl:inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 shrink-0">
                    Active Shop
                  </span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {profile.address ? profile.address.split(',')[0] : 'Daily Retail Ledger'} · {profile.ownerName || 'Owner'}
                </div>
              </div>
            </div>
          )}

          {/* Mobile Action icons */}
          <div className="flex items-center gap-1.5 lg:hidden shrink-0">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              className="p-2 rounded-lg text-slate-700 dark:text-amber-300 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 cursor-pointer"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={() => setIsDailyClosingOpen(true)}
              aria-label="Daily Closing Report"
              title="End Day / Daily Closing Report"
              className="p-2 rounded-lg text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 cursor-pointer"
            >
              <MoonStar className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setIsBackupModalOpen(true)}
              aria-label="Manual Data Backup"
              title="Manual Data Backup (JSON)"
              className="p-2 rounded-lg text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 border border-emerald-200 dark:border-emerald-800 cursor-pointer"
            >
              <Database className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
            </button>

            <button
              type="button"
              onClick={() => setIsAlertsOpen(true)}
              aria-label="View notifications"
              className="relative p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:text-emerald-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              <Bell className="w-5 h-5" />
              {unreadAlertsCount > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 bg-red-600 text-white rounded-full text-[10px] font-bold flex items-center justify-center">
                  {unreadAlertsCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => void logout()}
              aria-label="Log Out"
              title="Log Out"
              data-testid="mobile-header-logout-btn"
              className="p-2 rounded-lg text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/60 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Right Controls: Primary Actions */}
        <div
          className={`flex flex-wrap items-center gap-1.5 shrink-0 max-w-full ${
            activeTab !== 'DASHBOARD' || profile.isPinEnabled ? 'mt-2 lg:mt-0' : ''
          }`}
        >

          {/* Dark / Light Theme Toggle (Desktop) */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            className="hidden lg:flex items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-amber-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer"
          >
            {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>

          {/* Daily Closing Report Trigger (Desktop) */}
          <button
            type="button"
            onClick={() => setIsDailyClosingOpen(true)}
            title="View Daily Closing Report (Dukan Band Hisab)"
            className="hidden sm:flex items-center gap-1 px-2 py-1.5 text-xs text-amber-900 dark:text-amber-200 font-semibold bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 dark:hover:bg-amber-900/60 border border-amber-300/80 dark:border-amber-800 rounded-lg whitespace-nowrap transition-colors cursor-pointer shadow-2xs"
          >
            <MoonStar className="w-3.5 h-3.5 text-amber-700 dark:text-amber-300" />
            <span>End Day</span>
          </button>

          {/* Notification Alerts (Desktop) */}
          <button
            type="button"
            onClick={() => setIsAlertsOpen(true)}
            aria-label="View notifications"
            className="hidden lg:flex relative p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:text-emerald-800 dark:hover:text-emerald-300 hover:border-emerald-300 hover:bg-emerald-50 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            title="Business Alerts & Notifications"
          >
            <Bell className="w-4 h-4" />
            {unreadAlertsCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 text-white rounded-full text-[10px] font-bold flex items-center justify-center">
                {unreadAlertsCount}
              </span>
            )}
          </button>

          {/* Manual JSON Data Backup (Desktop) */}
          <button
            type="button"
            onClick={() => setIsBackupModalOpen(true)}
            title="Manual Data Backup (JSON)"
            aria-label="Open manual data backup"
            className="hidden sm:flex items-center gap-1 px-2 py-1.5 text-xs text-emerald-900 dark:text-emerald-200 font-semibold bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 border border-emerald-300/80 dark:border-emerald-800 rounded-lg whitespace-nowrap transition-colors cursor-pointer shadow-2xs"
          >
            <Database className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
            <span>Backup</span>
          </button>

          {/* Android / Desktop PWA Install Trigger */}
          <PWAInstallButton variant="header" compact />

          {/* Lock App (if PIN configured) */}
          {profile.isPinEnabled && (
            <button
              type="button"
              onClick={lockApp}
              title="Lock Screen"
              aria-label="Lock screen with PIN"
              className="p-1.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer shrink-0"
            >
              <Lock className="w-4 h-4" />
            </button>
          )}

          {/* Explicit Log Out (Desktop) */}
          <button
            type="button"
            onClick={() => void logout()}
            title="Log Out"
            aria-label="Log Out"
            data-testid="header-logout-btn"
            className="hidden lg:flex items-center gap-1 px-2 py-1.5 text-xs text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 border border-slate-200 dark:border-slate-700 hover:border-red-300 dark:hover:border-red-800 rounded-lg font-semibold whitespace-nowrap transition-colors cursor-pointer shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Log Out</span>
          </button>

          {/* Quick Sale Button */}
          <button
            type="button"
            onClick={() => setIsQuickSaleOpen(true)}
            className={`${activeTab === 'DASHBOARD' ? 'hidden lg:flex' : 'flex'} items-center gap-1 bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-sm transition-colors cursor-pointer`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Sale</span>
          </button>
        </div>
      </div>

      {/* Notifications Drawer Modal */}
      {isAlertsOpen && (
        <NotificationModal isOpen={isAlertsOpen} onClose={() => setIsAlertsOpen(false)} />
      )}
    </header>
  );
};
