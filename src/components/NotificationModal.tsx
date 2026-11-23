import React from 'react';
import { useStore } from '../context/StoreContext';
import {
  X,
  AlertTriangle,
  AlertCircle,
  Package,
  Clock,
  Wallet,
  CheckCircle2,
} from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const NotificationModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { alerts, markAlertRead, dismissAllAlerts, setActiveTab, setSelectedCustomerId } = useStore();

  if (!isOpen) return null;

  const handleAction = (alert: (typeof alerts)[0]) => {
    markAlertRead(alert.id);
    if (alert.type === 'OVERDUE_CREDIT') {
      if (alert.customerId) {
        setSelectedCustomerId(alert.customerId);
      }
      setActiveTab('CUSTOMERS');
    } else if (alert.type === 'LOW_STOCK' || alert.type === 'APPROACHING_REORDER') {
      setActiveTab('INVENTORY');
    } else if (alert.type === 'SUPPLIER_DUE') {
      setActiveTab('SUPPLIERS');
    } else if (alert.type === 'NEGATIVE_CASH') {
      setActiveTab('CASHBOOK');
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-lg w-full max-h-[85vh] flex flex-col border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-emerald-950 text-white rounded-t-2xl">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-800 rounded-lg text-emerald-300">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base leading-tight">Business Alerts & Reminders</h3>
              <p className="text-xs text-emerald-300/80">
                {alerts.filter((a) => !a.read).length} unread alerts requiring attention
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-emerald-300 hover:text-white hover:bg-emerald-900 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Alerts List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 divide-y divide-slate-100 dark:divide-slate-800">
          {alerts.length === 0 ? (
            <div className="text-center py-12">
              <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-2 opacity-80" />
              <p className="font-semibold text-slate-800 dark:text-slate-100">All clear!</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">No overdue balances or low-stock alerts right now.</p>
            </div>
          ) : (
            alerts.map((alert) => (
              <div
                key={alert.id}
                className={`pt-3 first:pt-0 flex items-start gap-3 p-3 rounded-xl transition-colors ${
                  alert.read
                    ? 'bg-slate-50/60 dark:bg-slate-800/40 opacity-75'
                    : 'bg-emerald-50/40 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900'
                }`}
              >
                <div className="shrink-0 mt-0.5">
                  {alert.type === 'OVERDUE_CREDIT' && (
                    <Clock className="w-5 h-5 text-amber-600" />
                  )}
                  {alert.type === 'LOW_STOCK' && (
                    <Package className="w-5 h-5 text-red-600" />
                  )}
                  {alert.type === 'APPROACHING_REORDER' && (
                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                  )}
                  {alert.type === 'SUPPLIER_DUE' && (
                    <AlertCircle className="w-5 h-5 text-blue-600" />
                  )}
                  {alert.type === 'NEGATIVE_CASH' && (
                    <Wallet className="w-5 h-5 text-red-600" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-semibold text-slate-900 dark:text-slate-100 text-sm">{alert.title}</h4>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        alert.severity === 'HIGH'
                          ? 'bg-red-100 dark:bg-red-900/70 text-red-700 dark:text-red-200'
                          : alert.severity === 'MEDIUM'
                          ? 'bg-amber-100 dark:bg-amber-900/70 text-amber-800 dark:text-amber-200'
                          : 'bg-blue-100 dark:bg-blue-900/70 text-blue-800 dark:text-blue-200'
                      }`}
                    >
                      {alert.severity}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">{alert.message}</p>
                  <div className="flex items-center gap-3 mt-2.5">
                    <button
                      type="button"
                      onClick={() => handleAction(alert)}
                      className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 hover:text-emerald-950 underline cursor-pointer"
                    >
                      View & Resolve &rarr;
                    </button>
                    {!alert.read && (
                      <button
                        type="button"
                        onClick={() => markAlertRead(alert.id)}
                        className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/80 rounded-b-2xl flex items-center justify-between">
          <button
            type="button"
            onClick={dismissAllAlerts}
            className="text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white font-medium cursor-pointer"
          >
            Mark all as read
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
