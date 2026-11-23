import React, { useState, useMemo, useEffect } from 'react';
import { useStore } from '../context/StoreContext';
import { ExpenseCategory, BillAttachment, RecurringExpenseFrequency } from '../types';
import { formatINR, getDueRecurringExpenses } from '../utils/accounting';
import {
  EXPENSE_CATEGORY_ICON_PRESETS,
  resolveExpenseCategoryMeta,
} from '../utils/expenseCategories';
import { FileAttachment } from './FileAttachment';
import { BillViewerModal } from './BillViewerModal';
import { MonthlyExpensesBarChart } from './MonthlyExpensesBarChart';
import { PeriodFilterBar } from './PeriodFilterBar';
import { ExpenseCategoryManagerModal } from './ExpenseCategoryManagerModal';
import { useTrackActiveTransaction } from './PWAInstallButton';
import {
  Plus,
  Trash2,
  X,
  Paperclip,
  Eye,
  Repeat,
  Play,
  Pause,
  Clock,
  SlidersHorizontal,
} from 'lucide-react';

export const ExpensesView: React.FC = () => {
  const {
    expenses,
    filteredExpenses,
    expenseCategories,
    addExpense,
    deleteExpense,
    addExpenseCategory,
    recurringExpenses,
    addRecurringExpense,
    updateRecurringExpense,
    deleteRecurringExpense,
    generateDueRecurringExpense,
  } = useStore();

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isCategoryManagerOpen, setIsCategoryManagerOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('SHOP');
  const [amount, setAmount] = useState('');
  const [isPersonalWithdrawal, setIsPersonalWithdrawal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'UPI' | 'BANK'>('CASH');
  const [notes, setNotes] = useState('');
  const [expenseAttachments, setExpenseAttachments] = useState<BillAttachment[]>([]);
  const [viewingAttachment, setViewingAttachment] = useState<{
    attachment: BillAttachment;
    title: string;
    details?: string;
  } | null>(null);

  // Inline Quick Custom Category inside Add Expense Modal
  const [showInlineAddCategory, setShowInlineAddCategory] = useState(false);
  const [inlineCatLabel, setInlineCatLabel] = useState('');
  const [inlineCatIcon, setInlineCatIcon] = useState('🛍️');
  const [inlineCatDrawing, setInlineCatDrawing] = useState(false);
  const [inlineCatError, setInlineCatError] = useState<string | null>(null);

  // Recurring Expenses Modal & Feedback State
  const [isAddRecurringOpen, setIsAddRecurringOpen] = useState(false);
  useTrackActiveTransaction('expenses-modal', isAddModalOpen || isAddRecurringOpen);
  const [recTitle, setRecTitle] = useState('');
  const [recCategory, setRecCategory] = useState<ExpenseCategory>('SHOP');
  const [recAmount, setRecAmount] = useState('');
  const [recPaymentMethod, setRecPaymentMethod] = useState<'CASH' | 'UPI' | 'BANK'>('CASH');
  const [recFrequency, setRecFrequency] = useState<RecurringExpenseFrequency>('MONTHLY');
  const [recNextDueDate, setRecNextDueDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [recAutoCreate, setRecAutoCreate] = useState(true);
  const [recNotes, setRecNotes] = useState('');
  const [recFeedback, setRecFeedback] = useState<string | null>(null);
  const [confirmDeleteRecId, setConfirmDeleteRecId] = useState<string | null>(null);
  const [showInlineRecCategory, setShowInlineRecCategory] = useState(false);
  const [inlineRecCatLabel, setInlineRecCatLabel] = useState('');
  const [inlineRecCatIcon, setInlineRecCatIcon] = useState('🧾');
  const [inlineRecCatError, setInlineRecCatError] = useState<string | null>(null);

  // Keep selected category valid if user renames/deletes categories
  useEffect(() => {
    if (expenseCategories.length === 0) return;
    if (!expenseCategories.some((c) => c.id === category)) {
      const first = expenseCategories[0];
      setCategory(first.id);
      setIsPersonalWithdrawal(Boolean(first.isPersonalDrawing));
    }
  }, [expenseCategories, category]);

  const operatingCategoryOptions = useMemo(() => {
    const ops = expenseCategories.filter(
      (c) => !c.isPersonalDrawing && c.id !== 'PERSONAL_DRAWING'
    );
    return ops.length > 0 ? ops : expenseCategories;
  }, [expenseCategories]);

  useEffect(() => {
    if (operatingCategoryOptions.length === 0) return;
    if (!operatingCategoryOptions.some((c) => c.id === recCategory)) {
      setRecCategory(operatingCategoryOptions[0].id);
    }
  }, [operatingCategoryOptions, recCategory]);

  const dueRecurringList = useMemo(
    () => getDueRecurringExpenses(recurringExpenses),
    [recurringExpenses]
  );
  const dueRecurringIds = useMemo(
    () => new Set(dueRecurringList.map((r) => r.id)),
    [dueRecurringList]
  );

  const visibleExpenses = useMemo(() => {
    if (categoryFilter === 'ALL') return filteredExpenses;
    return filteredExpenses.filter((e) => e.category === categoryFilter);
  }, [filteredExpenses, categoryFilter]);

  const handleCategoryChange = (catId: ExpenseCategory) => {
    setCategory(catId);
    const matched = expenseCategories.find((c) => c.id === catId);
    setIsPersonalWithdrawal(Boolean(matched?.isPersonalDrawing || catId === 'PERSONAL_DRAWING'));
  };

  const handleInlineCreateCategory = () => {
    setInlineCatError(null);
    const res = addExpenseCategory({
      label: inlineCatLabel,
      icon: inlineCatIcon,
      isPersonalDrawing: inlineCatDrawing,
    });
    if (!res.success || !res.category) {
      setInlineCatError(res.error || 'Could not add category.');
      return;
    }
    setCategory(res.category.id);
    setIsPersonalWithdrawal(Boolean(res.category.isPersonalDrawing));
    setInlineCatLabel('');
    setInlineCatIcon('🛍️');
    setInlineCatDrawing(false);
    setShowInlineAddCategory(false);
  };

  const handleInlineCreateRecCategory = () => {
    setInlineRecCatError(null);
    const res = addExpenseCategory({
      label: inlineRecCatLabel,
      icon: inlineRecCatIcon,
      isPersonalDrawing: false,
    });
    if (!res.success || !res.category) {
      setInlineRecCatError(res.error || 'Could not add category.');
      return;
    }
    setRecCategory(res.category.id);
    setInlineRecCatLabel('');
    setInlineRecCatIcon('🧾');
    setShowInlineRecCategory(false);
  };

  const handleCreateExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || Number(amount) <= 0) return;

    const matched = expenseCategories.find((c) => c.id === category);
    addExpense({
      title: title.trim(),
      category,
      amount: Number(amount),
      isPersonalWithdrawal:
        isPersonalWithdrawal || Boolean(matched?.isPersonalDrawing) || category === 'PERSONAL_DRAWING',
      paymentMethod,
      notes: notes.trim() || undefined,
      attachments: expenseAttachments.length > 0 ? expenseAttachments : undefined,
    });

    setTitle('');
    setAmount('');
    setNotes('');
    setExpenseAttachments([]);
    setShowInlineAddCategory(false);
    setInlineCatError(null);
    setIsAddModalOpen(false);
  };

  const handleDelete = (id: string, expTitle: string) => {
    const reason = window.prompt(
      `Confirm deletion of expense '${expTitle}'. Please provide an audit reason:`,
      'Incorrect billing entry'
    );
    if (reason) {
      deleteExpense(id, reason);
    }
  };

  const handleCreateRecurringSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(recAmount);
    if (!recTitle.trim() || !Number.isFinite(amt) || amt <= 0) return;

    const effectiveDueDate = recNextDueDate || new Date().toISOString().split('T')[0];
    const matchedRecCat = expenseCategories.find((c) => c.id === recCategory);
    addRecurringExpense({
      title: recTitle.trim(),
      category: recCategory,
      amount: amt,
      isPersonalWithdrawal: Boolean(matchedRecCat?.isPersonalDrawing),
      paymentMethod: recPaymentMethod,
      frequency: recFrequency,
      startDate: effectiveDueDate,
      nextDueDate: effectiveDueDate,
      autoCreateOnDue: recAutoCreate,
      isActive: true,
      notes: recNotes.trim() || undefined,
    });

    setRecFeedback(`Added recurring schedule: "${recTitle.trim()}" (${formatINR(amt)} · ${recFrequency}).`);
    setRecTitle('');
    setRecAmount('');
    setRecNotes('');
    setShowInlineRecCategory(false);
    setInlineRecCatError(null);
    setIsAddRecurringOpen(false);
  };

  const handleRecordRecurringNow = (id: string, schedTitle: string) => {
    const ok = generateDueRecurringExpense(id);
    if (ok) {
      setRecFeedback(`Recorded "${schedTitle}" into Expenses & Cashbook and advanced next due date.`);
    }
  };

  const operatingTotal = filteredExpenses
    .filter((e) => !e.isPersonalWithdrawal && e.category !== 'PERSONAL_DRAWING')
    .reduce((sum, e) => sum + e.amount, 0);

  const drawingsTotal = filteredExpenses
    .filter((e) => e.isPersonalWithdrawal || e.category === 'PERSONAL_DRAWING')
    .reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="space-y-4 pb-12">
      {/* Top Header */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        <div>
          <div className="text-xs uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wide">
            Expense & Cash Withdrawals (Dukan Kharch & Nikasi)
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight mt-0.5 tabular-nums">
            {formatINR(operatingTotal + drawingsTotal)}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
            Operating: {formatINR(operatingTotal)} · Owner Personal Withdrawals: {formatINR(drawingsTotal)}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsCategoryManagerOpen(true)}
            className="flex items-center justify-center gap-2 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-semibold text-xs sm:text-sm px-3.5 py-2.5 rounded-xl cursor-pointer"
          >
            <SlidersHorizontal className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
            <span>Customize Categories</span>
          </button>

          <button
            type="button"
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center justify-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-sm cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Expense (Naya Kharch)</span>
          </button>
        </div>
      </div>

      <PeriodFilterBar label="Expense Period" />

      {/* Two cards comparing Shop Operating Expenses vs Personal Drawings */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
              Shop Operating Expenses (Vyapar Kharch)
            </span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300">
              P&L Deductible
            </span>
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
            {formatINR(operatingTotal)}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Electricity bills, staff daily wages, tea/food, packaging and freight. Subtracted from gross profit to get net profit.
          </p>
        </div>

        <div className="p-4 bg-amber-50/20 dark:bg-amber-950/20 rounded-2xl border border-amber-200 dark:border-amber-800/60 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wide">
              Owner Personal Drawings (Malik Gharelu Kharch)
            </span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200">
              Not P&L Expense
            </span>
          </div>
          <div className="text-2xl font-bold text-amber-900 dark:text-amber-200 mt-1 tabular-nums">
            {formatINR(drawingsTotal)}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Money taken by owner for home grocery, school fees or family needs. Reduces counter cash but is NOT a shop operating loss.
          </p>
        </div>
      </div>

      {/* 6-Month Monthly Operating Expenses Bar Chart (Recharts) */}
      <MonthlyExpensesBarChart expenses={expenses} />

      {/* Recurring Expenses Section (Fixed Monthly/Weekly Shop Bills) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 shrink-0">
              <Repeat className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
                  Recurring Fixed Expenses (Kiraya, Bijli, Staff)
                </h3>
                {dueRecurringList.length > 0 && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/70 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 tabular-nums">
                    {dueRecurringList.length} Due Today / Overdue
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Schedule rent, electricity &amp; staff bills — auto-records on due date or record manually in 1 click.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsAddRecurringOpen(true)}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-2xs cursor-pointer shrink-0 self-start sm:self-auto"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Recurring Bill</span>
          </button>
        </div>

        {recFeedback && (
          <div className="px-4 py-2 bg-emerald-50 dark:bg-emerald-950/50 border-b border-emerald-200 dark:border-emerald-800 flex items-center justify-between text-xs text-emerald-900 dark:text-emerald-200">
            <span className="font-semibold">{recFeedback}</span>
            <button
              type="button"
              onClick={() => setRecFeedback(null)}
              className="text-emerald-700 dark:text-emerald-300 font-bold cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {recurringExpenses.length === 0 ? (
          <div className="p-5 text-center text-xs text-slate-500 dark:text-slate-400">
            No recurring expense schedules added yet. Click <strong>New Recurring Bill</strong> to schedule shop rent, electricity, or staff salary.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {recurringExpenses.map((sched) => {
              const isDue = dueRecurringIds.has(sched.id);
              const catMeta = resolveExpenseCategoryMeta(expenseCategories, sched.category);
              return (
                <div
                  key={sched.id}
                  className={`p-3.5 sm:px-4 flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                    isDue
                      ? 'bg-amber-50/40 dark:bg-amber-950/20'
                      : !sched.isActive
                      ? 'bg-slate-50/60 dark:bg-slate-900/40 opacity-75'
                      : ''
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                        {sched.title}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                        {sched.frequency} · {catMeta.icon} {catMeta.label} · {sched.paymentMethod}
                      </span>
                      {isDue && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/70 text-amber-800 dark:text-amber-200">
                          <Clock className="w-3 h-3" />
                          <span>Due</span>
                        </span>
                      )}
                      {!sched.isActive && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                          Paused
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 tabular-nums">
                      <span>
                        Next Due: <strong className="text-slate-700 dark:text-slate-200">{sched.nextDueDate}</strong>
                      </span>
                      <span>{sched.autoCreateOnDue ? 'Auto-records on due' : 'Manual reminder only'}</span>
                      {sched.lastGeneratedDate && <span>Last Recorded: {sched.lastGeneratedDate}</span>}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <span className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-slate-100 tabular-nums mr-1">
                      {formatINR(sched.amount)}
                    </span>

                    <button
                      type="button"
                      onClick={() => handleRecordRecurringNow(sched.id, sched.title)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer"
                      title="Record this expense now and advance next due date"
                    >
                      <Play className="w-3 h-3" />
                      <span>Record Now</span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        updateRecurringExpense(sched.id, { isActive: !sched.isActive })
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer"
                      title={sched.isActive ? 'Pause schedule' : 'Resume schedule'}
                    >
                      {sched.isActive ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                      <span>{sched.isActive ? 'Pause' : 'Resume'}</span>
                    </button>

                    {confirmDeleteRecId === sched.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            deleteRecurringExpense(sched.id);
                            setConfirmDeleteRecId(null);
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteRecId(null)}
                          className="px-2 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-semibold cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteRecId(sched.id)}
                        aria-label={`Delete recurring bill ${sched.title}`}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 dark:hover:text-rose-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                        title="Delete recurring schedule"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Expenses Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Expense Log &amp; Audit History</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Every expenditure recorded with custom category &amp; payment method
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <label htmlFor="expense-log-cat-filter" className="sr-only">
              Filter by expense category
            </label>
            <select
              id="expense-log-cat-filter"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="text-xs border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
            >
              <option value="ALL">All Categories ({filteredExpenses.length})</option>
              {expenseCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.label}
                </option>
              ))}
            </select>
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 tabular-nums">
              {visibleExpenses.length} records
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 font-semibold uppercase text-[11px]">
              <tr>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Expense Title</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Paid Via</th>
                <th className="py-3 px-4 text-right">Amount (₹)</th>
                <th className="py-3 px-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {visibleExpenses.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500 dark:text-slate-400">
                    No expenses logged for this selection.
                  </td>
                </tr>
              ) : (
                visibleExpenses.map((exp) => {
                  const catMeta = resolveExpenseCategoryMeta(expenseCategories, exp.category);
                  return (
                    <tr key={exp.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-400 whitespace-nowrap tabular-nums">
                        {new Date(exp.date).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                        <div>{exp.title}</div>
                        {exp.notes && <div className="text-[11px] text-slate-500 dark:text-slate-400 font-normal">{exp.notes}</div>}
                        {exp.attachments && exp.attachments.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setViewingAttachment({
                                attachment: exp.attachments![0],
                                title: `Expense: ${exp.title}`,
                                details: `Category: ${catMeta.label} · Amount: ${formatINR(exp.amount)} · ${exp.notes || ''}`,
                              })
                            }
                            className="inline-flex items-center gap-1 mt-1 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800 transition-colors cursor-pointer"
                          >
                            <Paperclip className="w-3 h-3 text-emerald-700 dark:text-emerald-400" />
                            <span>{exp.attachments.length} {exp.attachments.length === 1 ? 'Receipt' : 'Receipts'}</span>
                            <Eye className="w-3 h-3 text-emerald-600 dark:text-emerald-400 ml-0.5" />
                          </button>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                          <span aria-hidden="true">{catMeta.icon}</span>
                          <span>{catMeta.label}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded ${
                            exp.isPersonalWithdrawal
                              ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                              : 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300'
                          }`}
                        >
                          {exp.isPersonalWithdrawal ? 'Owner Drawing' : 'Business Operating'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-700 dark:text-slate-300">
                        {exp.paymentMethod}
                      </td>
                      <td className="py-3 px-4 text-right font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">
                        {formatINR(exp.amount)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          type="button"
                          onClick={() => handleDelete(exp.id, exp.title)}
                          className="p-1 rounded text-slate-400 hover:text-red-600 dark:hover:text-rose-400 cursor-pointer"
                          title="Delete with Audit Reason"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Expense Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-md w-full p-5 border border-slate-200 dark:border-slate-800 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">Record Expense or Cash Drawing</h3>
              <button
                type="button"
                onClick={() => {
                  setIsAddModalOpen(false);
                  setShowInlineAddCategory(false);
                }}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateExpense} className="py-4 space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase mb-1">
                  Amount (Rakam ₹) *
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-2.5 text-slate-400 font-bold text-lg">₹</span>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    required
                    placeholder="e.g. 180"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full text-xl font-bold pl-8 pr-3 py-2 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-800 tabular-nums"
                    autoFocus
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="expense-category-select"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    Category (Varg)
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowInlineAddCategory((prev) => !prev);
                        setInlineCatError(null);
                      }}
                      className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                    >
                      {showInlineAddCategory ? 'Close' : '+ Custom'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCategoryManagerOpen(true)}
                      className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:underline cursor-pointer"
                    >
                      Manage list
                    </button>
                  </div>
                </div>
                <select
                  id="expense-category-select"
                  value={category}
                  onChange={(e) => handleCategoryChange(e.target.value as ExpenseCategory)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  {expenseCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.icon} {c.label}
                    </option>
                  ))}
                </select>

                {showInlineAddCategory && (
                  <div className="mt-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2">
                    <div className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                      Quick Add Custom Category
                    </div>
                    {inlineCatError && (
                      <div className="text-[11px] font-medium text-red-600 dark:text-rose-400">
                        {inlineCatError}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="e.g. Water Jar / Carry Bags"
                        value={inlineCatLabel}
                        onChange={(e) => setInlineCatLabel(e.target.value)}
                        className="flex-1 text-xs border border-slate-300 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                      />
                      <button
                        type="button"
                        onClick={handleInlineCreateCategory}
                        className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer shrink-0"
                      >
                        Add
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-1">
                        {EXPENSE_CATEGORY_ICON_PRESETS.slice(9, 15).map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => setInlineCatIcon(emoji)}
                            className={`w-6 h-6 rounded text-xs flex items-center justify-center border cursor-pointer ${
                              inlineCatIcon === emoji
                                ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/60'
                                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                            }`}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                      <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          checked={inlineCatDrawing}
                          onChange={(e) => setInlineCatDrawing(e.target.checked)}
                          className="rounded accent-amber-600"
                        />
                        <span>Owner Drawing</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Expense Title / Payee *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Morning samosa & tea for counter"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Payment Method
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['CASH', 'UPI', 'BANK'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPaymentMethod(m)}
                      className={`py-2 text-xs font-semibold rounded-lg border cursor-pointer ${
                        paymentMethod === m
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200 border-emerald-600'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Personal Withdrawal Toggle */}
              <div className="p-3 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-amber-900 dark:text-amber-200">Personal Household Drawing?</div>
                  <div className="text-[11px] text-amber-700 dark:text-amber-300">Check if money was taken for owner home use</div>
                </div>
                <input
                  type="checkbox"
                  checked={isPersonalWithdrawal}
                  onChange={(e) => setIsPersonalWithdrawal(e.target.checked)}
                  className="w-5 h-5 accent-emerald-600 rounded"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Additional Note
                </label>
                <input
                  type="text"
                  placeholder="Optional description"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full text-xs sm:text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <FileAttachment
                  attachments={expenseAttachments}
                  onChange={setExpenseAttachments}
                  billType="EXPENSE"
                  label="Attach Receipt / Expense Slip (Receipt ya Bill Photo)"
                  onOcrExtracted={(data) => {
                    if (data.totalAmount) setAmount(String(data.totalAmount));
                    if (data.partyName) setTitle(data.partyName);
                    else if (data.items && data.items.length > 0) setTitle(data.items.map((i) => i.name).join(', '));
                    if (data.notes) setNotes(data.notes);
                  }}
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddModalOpen(false);
                    setShowInlineAddCategory(false);
                  }}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  Save Expense Entry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Recurring Expense Modal */}
      {isAddRecurringOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-md w-full p-5 border border-slate-200 dark:border-slate-800 max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">
                Schedule Recurring Expense
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsAddRecurringOpen(false);
                  setShowInlineRecCategory(false);
                }}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateRecurringSubmit} className="py-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Bill / Expense Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Dukan Kiraya (Shop Rent)"
                  value={recTitle}
                  onChange={(e) => setRecTitle(e.target.value)}
                  className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Amount ₹ *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    required
                    placeholder="e.g. 8500"
                    value={recAmount}
                    onChange={(e) => setRecAmount(e.target.value)}
                    className="w-full text-sm font-bold border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Frequency *
                  </label>
                  <select
                    value={recFrequency}
                    onChange={(e) => setRecFrequency(e.target.value as RecurringExpenseFrequency)}
                    className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  >
                    <option value="WEEKLY">Weekly</option>
                    <option value="MONTHLY">Monthly</option>
                    <option value="YEARLY">Yearly</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Category
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setShowInlineRecCategory((prev) => !prev);
                        setInlineRecCatError(null);
                      }}
                      className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer"
                    >
                      {showInlineRecCategory ? 'Close' : '+ Custom'}
                    </button>
                  </div>
                  <select
                    value={recCategory}
                    onChange={(e) => setRecCategory(e.target.value as ExpenseCategory)}
                    className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  >
                    {operatingCategoryOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.icon} {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Next Due Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={recNextDueDate}
                    onChange={(e) => setRecNextDueDate(e.target.value)}
                    className="w-full text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              {showInlineRecCategory && (
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-2">
                  <div className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                    Quick Add Custom Category
                  </div>
                  {inlineRecCatError && (
                    <div className="text-[11px] font-medium text-red-600 dark:text-rose-400">
                      {inlineRecCatError}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="e.g. Shop Rent / WiFi"
                      value={inlineRecCatLabel}
                      onChange={(e) => setInlineRecCatLabel(e.target.value)}
                      className="flex-1 text-xs border border-slate-300 dark:border-slate-600 rounded-lg px-2.5 py-1.5 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={handleInlineCreateRecCategory}
                      className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer shrink-0"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Payment Method
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['CASH', 'UPI', 'BANK'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setRecPaymentMethod(m)}
                      className={`py-2 text-xs font-semibold rounded-lg border cursor-pointer ${
                        recPaymentMethod === m
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200 border-emerald-600'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <label className="p-3 bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-center justify-between gap-2 cursor-pointer">
                <div>
                  <div className="text-xs font-bold text-emerald-950 dark:text-emerald-200">
                    Auto-Create Expense on Due Date
                  </div>
                  <div className="text-[11px] text-emerald-700 dark:text-emerald-300">
                    Automatically adds expense entry when app opens on or after due date
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={recAutoCreate}
                  onChange={(e) => setRecAutoCreate(e.target.checked)}
                  className="w-5 h-5 accent-emerald-700 rounded"
                />
              </label>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Note (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Landlord Rameshwar Ji"
                  value={recNotes}
                  onChange={(e) => setRecNotes(e.target.value)}
                  className="w-full text-xs sm:text-sm border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddRecurringOpen(false);
                    setShowInlineRecCategory(false);
                  }}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  Save Recurring Schedule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Customize Expense Categories Modal */}
      <ExpenseCategoryManagerModal
        isOpen={isCategoryManagerOpen}
        onClose={() => setIsCategoryManagerOpen(false)}
      />

      {/* Expense Bill Viewer Modal */}
      {viewingAttachment && (
        <BillViewerModal
          attachment={viewingAttachment.attachment}
          title={viewingAttachment.title}
          details={viewingAttachment.details}
          onClose={() => setViewingAttachment(null)}
        />
      )}
    </div>
  );
};
