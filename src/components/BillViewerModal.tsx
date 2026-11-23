/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { BillAttachment } from '../types';
import { downloadDataUrlAsBlobFile, openDataUrlViaBlobTab } from '../utils/androidDownload';
import { getBillDocument } from '../utils/billDatabase';
import { formatFileSize, rotateImageAttachment } from '../utils/documentStorage';
import {
  FileText,
  Image as ImageIcon,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Download,
  X,
  ExternalLink,
} from 'lucide-react';

interface BillViewerModalProps {
  attachments?: BillAttachment[];
  attachment?: BillAttachment;
  isOpen?: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  details?: string;
}

export const BillViewerModal: React.FC<BillViewerModalProps> = ({
  attachments,
  attachment,
  isOpen = true,
  onClose,
  title = 'Attached Bill Document (Attached Bill Parchi)',
  subtitle,
  details,
}) => {
  const resolvedList = attachments && attachments.length > 0
    ? attachments
    : attachment
    ? [attachment]
    : [];

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [currentAttachments, setCurrentAttachments] = useState<BillAttachment[]>(resolvedList);

  // Sync state when props change & lazily hydrate any stripped attachment dataUrls from bill vault
  React.useEffect(() => {
    let cancelled = false;
    setCurrentAttachments(resolvedList);
    setSelectedIndex(0);
    setZoom(1);

    const needsHydration = resolvedList.some((a) => a.id && (!a.dataUrl || !a.dataUrl.trim()));
    if (needsHydration && isOpen) {
      Promise.all(
        resolvedList.map(async (att) => {
          if (att.dataUrl && att.dataUrl.trim()) return att;
          const stored = await getBillDocument(att.id);
          return stored && stored.dataUrl ? { ...att, dataUrl: stored.dataUrl } : att;
        })
      ).then((hydrated) => {
        if (!cancelled) {
          setCurrentAttachments(hydrated);
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [attachments, attachment, isOpen]);

  if (!isOpen || !currentAttachments || currentAttachments.length === 0) return null;

  const currentItem = currentAttachments[selectedIndex] || currentAttachments[0];

  const handleRotateCurrent = async () => {
    if (currentItem.type !== 'IMAGE') return;
    try {
      const rotated = await rotateImageAttachment(currentItem);
      const updated = currentAttachments.map((item, idx) =>
        idx === selectedIndex ? rotated : item
      );
      setCurrentAttachments(updated);
    } catch {
      // ignore
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden shadow-2xl border border-slate-700">
        {/* Header */}
        <div className="p-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-2.5 truncate pr-2">
            <div className="p-2 bg-emerald-600/30 rounded-lg text-emerald-400">
              {currentItem.type === 'PDF' ? (
                <FileText className="w-5 h-5 text-purple-400" />
              ) : (
                <ImageIcon className="w-5 h-5 text-emerald-400" />
              )}
            </div>
            <div className="truncate">
              <h3 className="text-sm sm:text-base font-bold truncate">{title}</h3>
              <p className="text-[11px] text-slate-400 truncate">
                {(subtitle || details) ? `${subtitle || details} · ` : ''}
                {currentItem.name} ({formatFileSize(currentItem.size)})
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {currentItem.type === 'IMAGE' && (
              <>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
                  title="Zoom Out"
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="text-xs font-mono text-slate-300 px-1">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(3.5, z + 0.25))}
                  title="Zoom In"
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleRotateCurrent}
                  title="Rotate 90°"
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 ml-1"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
              </>
            )}

            <button
              type="button"
              disabled={!currentItem.dataUrl}
              onClick={() =>
                downloadDataUrlAsBlobFile(
                  currentItem.dataUrl,
                  currentItem.name || `bill-${currentItem.id}`,
                  currentItem.type === 'PDF' ? 'application/pdf' : 'image/jpeg'
                )
              }
              title="Download Document"
              className="p-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white ml-1 flex items-center gap-1 text-xs px-2.5 font-semibold disabled:opacity-40 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Save</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close document viewer"
              title="Close"
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 ml-1 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Multi-page / Multi-attachment tab selector if multiple */}
        {currentAttachments.length > 1 && (
          <div className="flex items-center gap-2 p-2 bg-slate-900 border-b border-slate-800 overflow-x-auto text-xs">
            <span className="text-slate-400 font-medium px-2">Pages/Bills:</span>
            {currentAttachments.map((att, idx) => (
              <button
                key={att.id || idx}
                type="button"
                onClick={() => {
                  setSelectedIndex(idx);
                  setZoom(1);
                }}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  selectedIndex === idx
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {att.type === 'PDF' ? `PDF ${idx + 1}` : `Page ${idx + 1}`}
              </button>
            ))}
          </div>
        )}

        {/* Viewer Viewport */}
        <div className="flex-1 overflow-auto p-4 bg-slate-950 flex items-center justify-center min-h-[350px]">
          {currentItem.type === 'IMAGE' ? (
            <div
              className="transition-transform duration-100 ease-out origin-center"
              style={{ transform: `scale(${zoom})` }}
            >
              <img
                src={currentItem.dataUrl}
                alt={currentItem.name}
                className="max-h-[70vh] max-w-full rounded shadow-2xl object-contain"
              />
            </div>
          ) : (
            <div className="w-full h-[65vh] flex flex-col items-center justify-center text-white space-y-4">
              <div className="p-4 rounded-2xl bg-purple-950/70 border border-purple-800">
                <FileText className="w-16 h-16 text-purple-400" />
              </div>
              <div className="text-center">
                <h4 className="text-base font-bold">{currentItem.name}</h4>
                <p className="text-xs text-slate-400 mt-1">
                  Digital PDF invoice attached to this transaction ({formatFileSize(currentItem.size)})
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  disabled={!currentItem.dataUrl}
                  onClick={() =>
                    downloadDataUrlAsBlobFile(
                      currentItem.dataUrl,
                      currentItem.name || `bill-${currentItem.id}.pdf`,
                      'application/pdf'
                    )
                  }
                  className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-2 shadow-lg cursor-pointer disabled:opacity-40"
                >
                  <Download className="w-4 h-4" />
                  <span>Download PDF Document</span>
                </button>
                <button
                  type="button"
                  disabled={!currentItem.dataUrl}
                  onClick={() => openDataUrlViaBlobTab(currentItem.dataUrl, 'application/pdf')}
                  className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-xl text-xs font-bold inline-flex items-center gap-2 border border-slate-700 cursor-pointer disabled:opacity-40"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Open PDF</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900 dark:text-slate-100">{currentItem.name}</span>
            <span className="text-slate-400 dark:text-slate-500">·</span>
            <span>Attached on {new Date(currentItem.uploadedAt).toLocaleDateString('en-IN')}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-semibold rounded-lg cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
