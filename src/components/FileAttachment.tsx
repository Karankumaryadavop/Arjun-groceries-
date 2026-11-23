/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from 'react';
import { BillAttachment, BillOcrExtractedData } from '../types';
import { downloadDataUrlAsBlobFile, openDataUrlViaBlobTab } from '../utils/androidDownload';
import {
  processFileToAttachment,
  formatFileSize,
  rotateImageAttachment,
  scanBillWithAI,
} from '../utils/documentStorage';
import { BillOcrReviewModal } from './BillOcrReviewModal';
import {
  Camera,
  Image as ImageIcon,
  FileText,
  Paperclip,
  X,
  RotateCw,
  Eye,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Download,
  Sparkles,
} from 'lucide-react';

interface FileAttachmentProps {
  attachments: BillAttachment[];
  onChange: (attachments: BillAttachment[]) => void;
  maxFiles?: number;
  label?: string;
  helperText?: string;
  disabled?: boolean;
  billType?: 'PURCHASE' | 'EXPENSE' | 'SALE';
  onOcrExtracted?: (data: BillOcrExtractedData) => void;
}

export const FileAttachment: React.FC<FileAttachmentProps> = ({
  attachments = [],
  onChange,
  maxFiles = 5,
  label = 'Bill / Receipt Photo (Bill Photo / Parchi)',
  helperText = 'Attach physical bill photo, supplier invoice or digital PDF slip',
  disabled = false,
  billType = 'PURCHASE',
  onOcrExtracted,
}) => {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<BillAttachment | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [scanningDocId, setScanningDocId] = useState<string | null>(null);
  const [ocrModalData, setOcrModalData] = useState<{
    attachment: BillAttachment;
    data: BillOcrExtractedData;
  } | null>(null);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setErrorMessage(null);

    if (attachments.length + fileList.length > maxFiles) {
      setErrorMessage(`Maximum ${maxFiles} bill attachments allowed per transaction.`);
      return;
    }

    setIsProcessing(true);
    try {
      const newAttachments: BillAttachment[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        const attachment = await processFileToAttachment(file);
        newAttachments.push(attachment);
      }
      onChange([...attachments, ...newAttachments]);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to process document attachment.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRemove = (id: string) => {
    onChange(attachments.filter((a) => a.id !== id));
    if (previewItem?.id === id) {
      setPreviewItem(null);
    }
  };

  const handleRotate = async (attachment: BillAttachment) => {
    if (attachment.type !== 'IMAGE') return;
    setIsProcessing(true);
    try {
      const rotated = await rotateImageAttachment(attachment);
      onChange(attachments.map((a) => (a.id === attachment.id ? rotated : a)));
      if (previewItem?.id === attachment.id) {
        setPreviewItem(rotated);
      }
    } catch {
      // Ignore rotation error
    } finally {
      setIsProcessing(false);
    }
  };

  const handleScanWithAI = async (attachment: BillAttachment) => {
    setErrorMessage(null);
    setScanningDocId(attachment.id);
    try {
      const result = await scanBillWithAI(attachment, billType);
      if (result.success && result.data) {
        setOcrModalData({
          attachment,
          data: result.data,
        });
      } else if (result.data) {
        // Fallback or preview
        setOcrModalData({
          attachment,
          data: result.data,
        });
        if (result.error) {
          setErrorMessage(result.error);
        }
      } else {
        setErrorMessage(result.error || 'Could not extract bill data. You can still save the photo without OCR.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error scanning bill with AI');
    } finally {
      setScanningDocId(null);
    }
  };

  const handleApplyOcrData = (confirmedData: BillOcrExtractedData) => {
    if (!ocrModalData) return;
    const updated = attachments.map((a) =>
      a.id === ocrModalData.attachment.id ? { ...a, ocrData: confirmedData } : a
    );
    onChange(updated);

    if (onOcrExtracted) {
      onOcrExtracted(confirmedData);
    }
    setOcrModalData(null);
  };

  return (
    <div className="space-y-2.5">
      {/* Hidden native inputs for mobile camera, gallery, and PDF */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        disabled={disabled || isProcessing || attachments.length >= maxFiles}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        disabled={disabled || isProcessing || attachments.length >= maxFiles}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf"
        multiple
        className="hidden"
        disabled={disabled || isProcessing || attachments.length >= maxFiles}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Header and status indicator */}
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
          <Paperclip className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
          <span>{label}</span>
        </label>

        {attachments.length > 0 ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
            <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
            <span>
              {attachments.length} {attachments.length === 1 ? 'bill photo' : 'bills'} attached
            </span>
          </span>
        ) : (
          <span className="text-[11px] text-slate-400 dark:text-slate-500">Optional</span>
        )}
      </div>

      {helperText && <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">{helperText}</p>}

      {/* 3 Mobile-first Capture / Upload Action Buttons */}
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          disabled={disabled || isProcessing || attachments.length >= maxFiles}
          onClick={() => cameraInputRef.current?.click()}
          className="flex flex-col sm:flex-row items-center justify-center gap-1.5 p-2.5 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-900 dark:text-emerald-200 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
          title="Take photo using mobile camera"
        >
          <Camera className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
          <span>Take Photo</span>
        </button>

        <button
          type="button"
          disabled={disabled || isProcessing || attachments.length >= maxFiles}
          onClick={() => galleryInputRef.current?.click()}
          className="flex flex-col sm:flex-row items-center justify-center gap-1.5 p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
          title="Choose photo from photo gallery"
        >
          <ImageIcon className="w-4 h-4 text-slate-600 dark:text-slate-300" />
          <span>Gallery</span>
        </button>

        <button
          type="button"
          disabled={disabled || isProcessing || attachments.length >= maxFiles}
          onClick={() => pdfInputRef.current?.click()}
          className="flex flex-col sm:flex-row items-center justify-center gap-1.5 p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
          title="Upload digital PDF invoice"
        >
          <FileText className="w-4 h-4 text-purple-600 dark:text-purple-400" />
          <span>Upload PDF</span>
        </button>
      </div>

      {/* Processing Spinner */}
      {isProcessing && (
        <div className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800 rounded-lg text-xs text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
          <Loader2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 animate-spin" />
          <span>Optimizing and compressing bill photo...</span>
        </div>
      )}

      {/* Error message */}
      {errorMessage && (
        <div className="flex items-center gap-1.5 p-2 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs rounded-lg border border-rose-200 dark:border-rose-800">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Thumbnails list */}
      {attachments.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
          {attachments.map((att, idx) => (
            <div
              key={att.id || idx}
              className="relative group bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col justify-between"
            >
              {/* Preview image or PDF icon */}
              <div
                onClick={() => {
                  setPreviewItem(att);
                  setPreviewZoom(1);
                }}
                className="h-24 bg-slate-100 dark:bg-slate-900 flex items-center justify-center overflow-hidden cursor-pointer relative"
              >
                {att.type === 'IMAGE' ? (
                  <img
                    src={att.dataUrl}
                    alt={att.name}
                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-purple-700 dark:text-purple-400">
                    <FileText className="w-8 h-8" />
                    <span className="text-[10px] font-bold mt-1">PDF DOCUMENT</span>
                  </div>
                )}

                {/* Hover overlay hint */}
                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                  <Eye className="w-5 h-5 drop-shadow-md" />
                </div>

                {/* Badge top-left */}
                <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-black/60 text-white backdrop-blur-xs">
                  {att.type === 'PDF' ? 'PDF' : `Page ${idx + 1}`}
                </span>
              </div>

              {/* Card Footer with actions */}
              <div className="p-2 bg-white dark:bg-slate-900 flex items-center justify-between text-xs border-t border-slate-100 dark:border-slate-800">
                <div className="truncate pr-1">
                  <div className="truncate text-[11px] font-semibold text-slate-800 dark:text-slate-200" title={att.name}>
                    {att.name}
                  </div>
                  <div className="text-[10px] text-slate-400 dark:text-slate-500">{formatFileSize(att.size)}</div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {onOcrExtracted && (
                    <button
                      type="button"
                      disabled={scanningDocId === att.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleScanWithAI(att);
                      }}
                      title="Scan Bill with AI OCR (AI se Bill Janche)"
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 dark:bg-amber-900/60 hover:bg-amber-200 dark:hover:bg-amber-900 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700 transition-colors cursor-pointer"
                    >
                      {scanningDocId === att.id ? (
                        <Loader2 className="w-3 h-3 animate-spin text-amber-800 dark:text-amber-300" />
                      ) : (
                        <Sparkles className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                      )}
                      <span>{scanningDocId === att.id ? 'Scanning...' : 'Scan AI'}</span>
                    </button>
                  )}
                  {att.type === 'IMAGE' && (
                    <button
                      type="button"
                      onClick={() => handleRotate(att)}
                      title="Rotate 90 degrees"
                      className="p-1 rounded text-slate-500 dark:text-slate-400 hover:text-emerald-700 dark:hover:text-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleRemove(att.id)}
                    title="Remove attachment"
                    className="p-1 rounded text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Fullscreen / Zoom Preview Modal */}
      {previewItem && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800">
            {/* Modal Header */}
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2 truncate pr-2">
                {previewItem.type === 'PDF' ? (
                  <FileText className="w-5 h-5 text-purple-400 shrink-0" />
                ) : (
                  <ImageIcon className="w-5 h-5 text-emerald-400 shrink-0" />
                )}
                <div className="truncate">
                  <h4 className="text-sm font-bold truncate">{previewItem.name}</h4>
                  <p className="text-[10px] text-slate-400">
                    {formatFileSize(previewItem.size)} · Attached {new Date(previewItem.uploadedAt).toLocaleDateString()}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {previewItem.type === 'IMAGE' && (
                  <>
                    <button
                      type="button"
                      onClick={() => setPreviewZoom((z) => Math.max(0.5, z - 0.25))}
                      title="Zoom Out"
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                    >
                      <ZoomOut className="w-4 h-4" />
                    </button>
                    <span className="text-xs font-mono text-slate-300 px-1">
                      {Math.round(previewZoom * 100)}%
                    </span>
                    <button
                      type="button"
                      onClick={() => setPreviewZoom((z) => Math.min(3, z + 0.25))}
                      title="Zoom In"
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                    >
                      <ZoomIn className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRotate(previewItem)}
                      title="Rotate Image"
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 ml-1 cursor-pointer"
                    >
                      <RotateCw className="w-4 h-4" />
                    </button>
                  </>
                )}

                <button
                  type="button"
                  disabled={!previewItem.dataUrl}
                  onClick={() =>
                    downloadDataUrlAsBlobFile(
                      previewItem.dataUrl,
                      previewItem.name || `bill-${previewItem.id}`,
                      previewItem.type === 'PDF' ? 'application/pdf' : 'image/jpeg'
                    )
                  }
                  title="Download File"
                  aria-label="Download File"
                  className="p-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white ml-1 disabled:opacity-40 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => setPreviewItem(null)}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 ml-1 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Content Body */}
            <div className="flex-1 overflow-auto p-4 bg-slate-950 flex items-center justify-center min-h-[300px]">
              {previewItem.type === 'IMAGE' ? (
                <div
                  className="transition-transform duration-100 ease-out origin-center"
                  style={{ transform: `scale(${previewZoom})` }}
                >
                  <img
                    src={previewItem.dataUrl}
                    alt={previewItem.name}
                    className="max-h-[68vh] max-w-full rounded shadow-lg object-contain"
                  />
                </div>
              ) : (
                <div className="w-full h-[65vh] flex flex-col items-center justify-center text-white space-y-3">
                  <FileText className="w-16 h-16 text-purple-400" />
                  <p className="text-sm font-semibold">{previewItem.name}</p>
                  <p className="text-xs text-slate-400">PDF Document attached to transaction</p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      disabled={!previewItem.dataUrl}
                      onClick={() =>
                        downloadDataUrlAsBlobFile(
                          previewItem.dataUrl,
                          previewItem.name || `bill-${previewItem.id}.pdf`,
                          'application/pdf'
                        )
                      }
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold inline-flex items-center gap-2 cursor-pointer disabled:opacity-40"
                    >
                      <Download className="w-4 h-4" />
                      <span>Download PDF</span>
                    </button>
                    <button
                      type="button"
                      disabled={!previewItem.dataUrl}
                      onClick={() => openDataUrlViaBlobTab(previewItem.dataUrl, 'application/pdf')}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg text-xs font-bold inline-flex items-center gap-2 border border-slate-700 cursor-pointer disabled:opacity-40"
                    >
                      <span>Open PDF</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Attached to bill transaction</span>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="px-4 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold rounded-lg cursor-pointer"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Bill Scanner Review Screen */}
      {ocrModalData && (
        <BillOcrReviewModal
          attachment={ocrModalData.attachment}
          initialOcrData={ocrModalData.data}
          billType={billType}
          isOpen={Boolean(ocrModalData)}
          onClose={() => setOcrModalData(null)}
          onApply={handleApplyOcrData}
        />
      )}
    </div>
  );
};
