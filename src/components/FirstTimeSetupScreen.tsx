/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Store, User, Phone, QrCode, MapPin, FileText, ArrowRight, Database, ShieldCheck } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { BrandLogo, BRAND_NAME, BRAND_TAGLINE } from './BrandLogo';

export const FirstTimeSetupScreen: React.FC = () => {
  const { completeFirstTimeSetup, setIsBackupModalOpen } = useStore();

  const [storeName, setStoreName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [upiId, setUpiId] = useState('');
  const [address, setAddress] = useState('');
  const [gstin, setGstin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSaving(true);
    try {
      const result = await completeFirstTimeSetup({
        storeName,
        ownerName,
        phone,
        upiId,
        address,
        gstin,
      });
      if (!result.success) {
        setError(result.error || 'Could not save your shop profile.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-emerald-50/70 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-3xl border border-emerald-200 dark:border-slate-800 shadow-xl overflow-hidden">
        {/* Top Green Header */}
        <div className="bg-emerald-800 dark:bg-emerald-950 text-white px-6 py-5 flex items-center gap-4">
          <BrandLogo sizeClass="w-14 h-14" roundedClass="rounded-2xl" className="shadow-md shrink-0" />
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-200">
              First-Time Shop Setup · Offline Only
            </div>
            <h1 className="text-xl font-extrabold text-white leading-tight truncate">
              Welcome to {BRAND_NAME}
            </h1>
            <p className="text-xs text-emerald-100/90 mt-0.5 truncate">{BRAND_TAGLINE}</p>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200 flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <strong className="font-bold">Clean Fresh Start:</strong> Your customer ledger, suppliers, products, sales, and cashbook start completely empty. All records stay offline on this device in IndexedDB.
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs font-semibold text-red-800 dark:text-red-200"
            >
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="sm:col-span-2">
              <label
                htmlFor="setup-store-name"
                className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1"
              >
                Shop / Store Name *
              </label>
              <div className="relative">
                <Store className="w-4 h-4 text-emerald-700 dark:text-emerald-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="setup-store-name"
                  type="text"
                  required
                  autoFocus
                  value={storeName}
                  onChange={(e) => {
                    setStoreName(e.target.value);
                    setError(null);
                  }}
                  placeholder="Enter your real shop name (e.g. Arjun Groceries)"
                  className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="setup-owner-name"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Owner Name (Optional)
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="setup-owner-name"
                  type="text"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="Your full name"
                  className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="setup-phone"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Shop Mobile Number (Optional)
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="setup-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setError(null);
                  }}
                  placeholder="10-digit mobile number"
                  className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="setup-upi-id"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Store UPI ID (Optional)
              </label>
              <div className="relative">
                <QrCode className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="setup-upi-id"
                  type="text"
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                  placeholder="e.g. yourshop@okaxis"
                  className="w-full pl-9 pr-3 py-2.5 text-sm font-mono border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="setup-gstin"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                GSTIN (Optional)
              </label>
              <div className="relative">
                <FileText className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="setup-gstin"
                  type="text"
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value)}
                  placeholder="Optional 15-digit GSTIN"
                  className="w-full pl-9 pr-3 py-2.5 text-sm font-mono uppercase border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="setup-address"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Shop Address (Optional)
              </label>
              <div className="relative">
                <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  id="setup-address"
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Shop number, market, area, city"
                  className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
            </div>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setIsBackupModalOpen(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              <Database className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
              <span>Restore Local / Cloud Backup</span>
            </button>

            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 disabled:opacity-60 text-white text-sm font-bold shadow-md cursor-pointer"
            >
              <span>{isSaving ? 'Saving Shop Profile…' : 'Save & Start My Shop'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
