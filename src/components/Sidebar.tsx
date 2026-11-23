import React from 'react';
import { useStore } from '../context/StoreContext';
import { NavTab } from '../types';
import {
  LayoutDashboard,
  Users,
  Truck,
  ShoppingCart,
  PackageCheck,
  Receipt,
  Wallet,
  Boxes,
  TrendingUp,
  FileSpreadsheet,
  FileText,
  Settings,
  PlusCircle,
  Lock,
  MessageSquare,
  BarChart3,
  FileCheck2,
  LogOut,
} from 'lucide-react';
import { BrandLogo, BRAND_NAME } from './BrandLogo';

export const Sidebar: React.FC = () => {
  const { activeTab, setActiveTab, profile, setIsQuickSaleOpen, lockApp, logout } = useStore();

  const navItems: { id: NavTab; label: string; hindiLabel: string; icon: React.ReactNode }[] = [
    {
      id: 'DASHBOARD',
      label: 'Dashboard',
      hindiLabel: 'Home & Shortcuts',
      icon: <LayoutDashboard className="w-5 h-5" />,
    },
    {
      id: 'BILLS_AUDIT',
      label: 'Bills & Audit',
      hindiLabel: 'Sale, Purchase & GST Audit',
      icon: <FileCheck2 className="w-5 h-5" />,
    },
    {
      id: 'FINANCIAL_OVERVIEW',
      label: 'Financial Overview',
      hindiLabel: 'P&L, Cash Flow & Alerts',
      icon: <BarChart3 className="w-5 h-5" />,
    },
    {
      id: 'CUSTOMERS',
      label: 'Customer Ledger',
      hindiLabel: 'Grahak Khata (Udhar)',
      icon: <Users className="w-5 h-5" />,
    },
    {
      id: 'SALES',
      label: 'Daily Sales & POS',
      hindiLabel: 'Bikri (Counter)',
      icon: <ShoppingCart className="w-5 h-5" />,
    },
    {
      id: 'CASHBOOK',
      label: 'Cashbook (Rokad)',
      hindiLabel: 'Rokad Bahi',
      icon: <Wallet className="w-5 h-5" />,
    },
    {
      id: 'SUPPLIERS',
      label: 'Suppliers (Vyaapari)',
      hindiLabel: 'Vyapari Khata',
      icon: <Truck className="w-5 h-5" />,
    },
    {
      id: 'PURCHASES',
      label: 'Stock Purchases',
      hindiLabel: 'Kharid / Maal Aavak',
      icon: <PackageCheck className="w-5 h-5" />,
    },
    {
      id: 'EXPENSES',
      label: 'Expenses & Kharcha',
      hindiLabel: 'Dukan Kharch',
      icon: <Receipt className="w-5 h-5" />,
    },
    {
      id: 'INVENTORY',
      label: 'Inventory & Stock',
      hindiLabel: 'Stock / Maal Suchi',
      icon: <Boxes className="w-5 h-5" />,
    },
    {
      id: 'ANALYTICS',
      label: 'Business Analytics',
      hindiLabel: 'Munafa & Analytics',
      icon: <TrendingUp className="w-5 h-5" />,
    },
    {
      id: 'REPORTS',
      label: 'Reports & Export',
      hindiLabel: 'Reports & Parchi',
      icon: <FileSpreadsheet className="w-5 h-5" />,
    },
    {
      id: 'DOCUMENTS',
      label: 'Bill Documents',
      hindiLabel: 'Bill & Receipt Photo',
      icon: <FileText className="w-5 h-5" />,
    },
    {
      id: 'WHATSAPP_REMINDERS',
      label: 'WhatsApp Reminders',
      hindiLabel: 'Bulk WhatsApp Takada',
      icon: <MessageSquare className="w-5 h-5 text-emerald-400" />,
    },
    {
      id: 'SETTINGS',
      label: 'Store Settings',
      hindiLabel: 'Settings & Backup',
      icon: <Settings className="w-5 h-5" />,
    },
  ];

  return (
    <aside className="hidden lg:flex flex-col w-64 bg-emerald-950 dark:bg-slate-900 text-white shrink-0 border-r border-emerald-900 dark:border-slate-800 select-none h-screen sticky top-0 overflow-y-auto">
      {/* Brand & Store Header */}
      <div className="p-4 border-b border-emerald-900/80 dark:border-slate-800 bg-emerald-950/60 dark:bg-slate-900/90">
        <div className="flex items-center gap-3">
          <BrandLogo
            sizeClass="w-11 h-11"
            roundedClass="rounded-xl"
            className="shadow-md shadow-emerald-950/40"
          />
          <div className="min-w-0 flex-1">
            <h1 className="font-bold text-white text-base leading-tight truncate">
              {profile.storeName || BRAND_NAME}
            </h1>
            <p className="text-xs text-emerald-300/80 truncate">
              {profile.ownerName ? `${profile.ownerName} · Owner` : BRAND_NAME}
            </p>
          </div>
        </div>

        {/* Quick Sale Primary Action */}
        <button
          type="button"
          onClick={() => setIsQuickSaleOpen(true)}
          className="mt-3.5 w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-emerald-950 font-semibold text-sm py-2 px-3 rounded-lg shadow-sm transition-colors cursor-pointer"
        >
          <PlusCircle className="w-4 h-4 text-emerald-950" />
          <span>New Quick Sale (Naya Bill)</span>
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        <div className="px-2 py-1 text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">
          Main Modules
        </div>
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-medium transition-all cursor-pointer ${
                isActive
                  ? 'bg-emerald-800 dark:bg-emerald-900/60 text-white shadow-sm ring-1 ring-emerald-600/40 dark:ring-emerald-500/40'
                  : 'text-emerald-100/80 dark:text-slate-300 hover:bg-emerald-900/60 dark:hover:bg-slate-800 hover:text-white'
              }`}
            >
              <span className={isActive ? 'text-emerald-300' : 'text-emerald-400'}>
                {item.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="leading-tight truncate">{item.label}</div>
                <div className="text-[10px] text-emerald-400/80 dark:text-slate-400 truncate font-normal">
                  {item.hindiLabel}
                </div>
              </div>
              {isActive && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Bottom Store Status, Lock & Log Out */}
      <div className="p-3 border-t border-emerald-900/80 dark:border-slate-800 bg-emerald-950/80 dark:bg-slate-900/95 flex items-center justify-between text-xs text-emerald-300/80 dark:text-slate-400">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>Shop Counter Online</span>
        </div>
        <div className="flex items-center gap-1">
          {profile.isPinEnabled && (
            <button
              type="button"
              onClick={lockApp}
              title="Lock Counter with PIN"
              aria-label="Lock Counter with PIN"
              className="p-1.5 hover:bg-emerald-900 rounded-md text-emerald-300 hover:text-white transition-colors cursor-pointer"
            >
              <Lock className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => void logout()}
            title="Log Out"
            aria-label="Log Out"
            data-testid="sidebar-logout-btn"
            className="p-1.5 hover:bg-red-900/60 rounded-md text-emerald-300 hover:text-red-200 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
};
