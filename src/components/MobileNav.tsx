import React, { useState } from 'react';
import { useStore } from '../context/StoreContext';
import { NavTab } from '../types';
import {
  Home,
  Users,
  ShoppingCart,
  Wallet,
  Menu,
  X,
  Truck,
  PackageCheck,
  Receipt,
  Boxes,
  TrendingUp,
  FileSpreadsheet,
  FileText,
  Settings,
  Plus,
  MessageSquare,
  BarChart3,
} from 'lucide-react';

export const MobileNav: React.FC = () => {
  const { activeTab, setActiveTab, setIsQuickSaleOpen } = useStore();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const primaryMobileTabs: { id: NavTab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'DASHBOARD',
      label: 'Home',
      icon: <Home className="w-5 h-5" />,
    },
    {
      id: 'BILLS_AUDIT',
      label: 'Bills',
      icon: <FileText className="w-5 h-5" />,
    },
    {
      id: 'CASHBOOK',
      label: 'Cashbook',
      icon: <Wallet className="w-5 h-5" />,
    },
    {
      id: 'INVENTORY',
      label: 'Inventory',
      icon: <Boxes className="w-5 h-5" />,
    },
  ];

  const secondaryTabs: { id: NavTab; label: string; hindi: string; icon: React.ReactNode; featured?: boolean }[] = [
    { id: 'FINANCIAL_OVERVIEW', label: 'Financial Overview & Alerts', hindi: 'P&L, Cash Flow, Dues & Insights', icon: <BarChart3 className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />, featured: true },
    { id: 'CUSTOMERS', label: 'Customer Ledger (Khata)', hindi: 'Grahak Khata (Udhar)', icon: <Users className="w-5 h-5 text-emerald-700 dark:text-emerald-400" /> },
    { id: 'SALES', label: 'Daily Sales & POS', hindi: 'Bikri (Counter)', icon: <ShoppingCart className="w-5 h-5 text-emerald-700 dark:text-emerald-400" /> },
    { id: 'SUPPLIERS', label: 'Suppliers (Vyaapari)', hindi: 'Vyapari Khata', icon: <Truck className="w-5 h-5 text-emerald-700 dark:text-emerald-400" /> },
    { id: 'PURCHASES', label: 'Purchases (Stock In)', hindi: 'Maal Kharid Bill', icon: <PackageCheck className="w-5 h-5 text-emerald-700 dark:text-emerald-400" /> },
    { id: 'EXPENSES', label: 'Expenses & Drawings', hindi: 'Dukan Kharch', icon: <Receipt className="w-5 h-5 text-emerald-700 dark:text-emerald-400" /> },
    { id: 'ANALYTICS', label: 'Business Analytics', hindi: 'Munafa & Analytics', icon: <TrendingUp className="w-5 h-5 text-emerald-700 dark:text-emerald-400" /> },
    { id: 'REPORTS', label: 'Reports & Export', hindi: 'Reports & Parchi', icon: <FileSpreadsheet className="w-5 h-5 text-emerald-700 dark:text-emerald-400" /> },
    { id: 'DOCUMENTS', label: 'Bill Documents', hindi: 'Bill & Receipt Photo', icon: <FileText className="w-5 h-5 text-emerald-700 dark:text-emerald-400" /> },
    { id: 'WHATSAPP_REMINDERS', label: 'Bulk WhatsApp', hindi: 'Bulk WhatsApp Takada', icon: <MessageSquare className="w-5 h-5 text-emerald-700 dark:text-emerald-400" /> },
    { id: 'SETTINGS', label: 'Store Settings', hindi: 'Settings & Backup', icon: <Settings className="w-5 h-5 text-emerald-700 dark:text-emerald-400" /> },
  ];

  const handleSelectTab = (tab: NavTab) => {
    setActiveTab(tab);
    setIsDrawerOpen(false);
  };

  return (
    <>
      {/* Bottom Navigation Bar on Mobile */}
      <nav aria-label="Mobile Bottom Navigation" className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 shadow-lg grid grid-cols-5 items-center px-1.5">
        {primaryMobileTabs.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelectTab(item.id)}
              className={`flex flex-col items-center justify-center py-1.5 px-2 rounded-lg text-xs font-medium transition-colors min-h-[44px] cursor-pointer ${
                isActive ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span className={isActive ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}>
                {item.icon}
              </span>
              <span className="mt-1 text-[11px] whitespace-nowrap">{item.label}</span>
            </button>
          );
        })}

        {/* More Drawer Trigger */}
        <button
          type="button"
          onClick={() => setIsDrawerOpen(true)}
          className={`flex flex-col items-center justify-center py-1.5 px-2 rounded-lg text-xs font-medium transition-colors min-h-[44px] cursor-pointer ${
            isDrawerOpen || (activeTab !== 'DASHBOARD' && activeTab !== 'BILLS_AUDIT' && activeTab !== 'CASHBOOK' && activeTab !== 'INVENTORY')
              ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Menu className="w-5 h-5" />
          <span className="mt-1 text-[11px] whitespace-nowrap">More</span>
        </button>
      </nav>

      {/* Drawer Overlay for Mobile */}
      {isDrawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex flex-col justify-end">
          <div className="bg-white dark:bg-slate-900 rounded-t-3xl p-4 max-h-[82vh] overflow-y-auto shadow-2xl animate-in slide-in-from-bottom duration-200 border-t border-slate-200 dark:border-slate-800">
            <div className="w-10 h-1 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mb-3" />
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">All Kirana Modules</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Select any section to manage</p>
              </div>
              <button
                type="button"
                aria-label="Close modules drawer"
                onClick={() => setIsDrawerOpen(false)}
                className="p-2 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setIsDrawerOpen(false);
                setIsQuickSaleOpen(true);
              }}
              className="mt-3 w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-bold shadow-xs cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>New Quick Sale (Naya Bill)</span>
            </button>

            <div className="py-2 space-y-1">
              {secondaryTabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectTab(item.id)}
                  className={`w-full flex items-center justify-between p-3 rounded-xl text-left transition-colors cursor-pointer ${
                    activeTab === item.id
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200 font-semibold border border-emerald-200 dark:border-emerald-800'
                      : item.featured
                      ? 'bg-emerald-50/60 dark:bg-emerald-950/35 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 text-emerald-950 dark:text-emerald-100 border border-emerald-200/80 dark:border-emerald-800/70 mb-1'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="p-2 bg-emerald-50 dark:bg-emerald-950/60 rounded-lg">{item.icon}</span>
                    <div>
                      <div className="text-sm font-medium">{item.label}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{item.hindi}</div>
                    </div>
                  </div>
                  <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Open &rarr;</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
