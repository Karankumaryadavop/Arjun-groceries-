import React, { useState } from 'react';
import { Calendar } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { DateFilterRange } from '../types';

export interface CustomDateRangeValue {
  startDate: string;
  endDate: string;
}

export const DATE_FILTER_OPTIONS: { id: DateFilterRange; label: string }[] = [
  { id: 'TODAY', label: 'Today' },
  { id: 'YESTERDAY', label: 'Yesterday' },
  { id: 'LAST_7_DAYS', label: '7 Days' },
  { id: 'LAST_30_DAYS', label: '30 Days' },
  { id: 'THIS_MONTH', label: 'This Month' },
  { id: 'LAST_MONTH', label: 'Last Month' },
  { id: 'CUSTOM', label: 'Custom' },
];

export function getDateFilterLabel(
  dateFilter: DateFilterRange,
  customDateRange?: CustomDateRangeValue
): string {
  if (dateFilter === 'CUSTOM' && customDateRange?.startDate && customDateRange?.endDate) {
    return `${customDateRange.startDate} to ${customDateRange.endDate}`;
  }
  return DATE_FILTER_OPTIONS.find((opt) => opt.id === dateFilter)?.label || 'This Month';
}

interface PeriodFilterBarProps {
  label?: string;
  className?: string;
}

export const PeriodFilterBar: React.FC<PeriodFilterBarProps> = ({
  label = 'Data Period',
  className = '',
}) => {
  const { dateFilter, setDateFilter, customDateRange, setCustomDateRange } = useStore();
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [tempStart, setTempStart] = useState(customDateRange.startDate);
  const [tempEnd, setTempEnd] = useState(customDateRange.endDate);

  const handleFilterClick = (id: DateFilterRange) => {
    if (id === 'CUSTOM') {
      setTempStart(customDateRange.startDate);
      setTempEnd(customDateRange.endDate);
      setShowCustomModal(true);
    } else {
      setDateFilter(id);
    }
  };

  const applyCustomRange = () => {
    setCustomDateRange({ startDate: tempStart, endDate: tempEnd });
    setDateFilter('CUSTOM');
    setShowCustomModal(false);
  };

  const activeLabel = getDateFilterLabel(dateFilter, customDateRange);

  return (
    <>
      <div
        className={`bg-white dark:bg-slate-900 rounded-xl px-3 py-2.5 border border-slate-200 dark:border-slate-800 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-2 ${className}`}
      >
        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 shrink-0">
          <Calendar className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
          <span className="font-semibold text-slate-700 dark:text-slate-200">{label}:</span>
          <span className="font-bold text-emerald-800 dark:text-emerald-300 tabular-nums">
            {activeLabel}
          </span>
        </div>

        <div
          role="group"
          aria-label="Select data time period"
          className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200/80 dark:border-slate-700 overflow-x-auto max-w-full"
        >
          {DATE_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              aria-pressed={dateFilter === opt.id}
              onClick={() => handleFilterClick(opt.id)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md whitespace-nowrap transition-colors cursor-pointer ${
                dateFilter === opt.id
                  ? 'bg-white dark:bg-slate-900 text-emerald-950 dark:text-emerald-300 shadow-xs font-semibold'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {showCustomModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl max-w-sm w-full p-5 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
              <Calendar className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
              <h3 className="font-bold text-slate-900 dark:text-slate-100">Custom Date Range</h3>
            </div>
            <div className="py-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Start Date (From)
                </label>
                <input
                  type="date"
                  value={tempStart}
                  onChange={(e) => setTempStart(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-emerald-600"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  End Date (To)
                </label>
                <input
                  type="date"
                  value={tempEnd}
                  onChange={(e) => setTempEnd(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-emerald-600"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowCustomModal(false)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyCustomRange}
                className="px-4 py-1.5 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg cursor-pointer"
              >
                Apply Range
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
