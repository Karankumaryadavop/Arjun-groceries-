import React, { useEffect, useRef, useState } from 'react';
import { Camera, Upload, Trash2, X, RefreshCw, Check, User } from 'lucide-react';

interface CustomerCameraCaptureProps {
  value?: string;
  customerName?: string;
  onChange: (photoDataUrl: string | undefined) => void;
  compact?: boolean;
}

/**
 * Compresses any image File/Blob or HTMLVideoElement frame into a lightweight
 * square/portrait JPEG data URL (<= 320px) safe for single-phone IndexedDB storage.
 */
function captureCanvasToDataUrl(
  source: HTMLVideoElement | HTMLImageElement,
  srcWidth: number,
  srcHeight: number
): string {
  const targetSize = 320;
  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Center-crop square from source
  const minSide = Math.min(srcWidth, srcHeight);
  const sx = Math.max(0, (srcWidth - minSide) / 2);
  const sy = Math.max(0, (srcHeight - minSide) / 2);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetSize, targetSize);
  ctx.drawImage(source, sx, sy, minSide, minSide, 0, 0, targetSize, targetSize);

  return canvas.toDataURL('image/jpeg', 0.78);
}

export const CustomerCameraCapture: React.FC<CustomerCameraCaptureProps> = ({
  value,
  customerName,
  onChange,
  compact = false,
}) => {
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isStartingCamera, setIsStartingCamera] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopCameraStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    if (!isCameraOpen) {
      stopCameraStream();
      return;
    }

    let cancelled = false;
    setIsStartingCamera(true);
    setCameraError(null);

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      setIsStartingCamera(false);
      setCameraError(
        'Live camera preview is not supported in this browser. Use "Upload / Phone Camera" instead.'
      );
      return;
    }

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode,
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        setIsStartingCamera(false);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setIsStartingCamera(false);
        setCameraError(
          err?.name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow camera access or use "Upload / Phone Camera".'
            : 'No live camera detected on this device. Use "Upload / Phone Camera" to pick or snap a photo.'
        );
      });

    return () => {
      cancelled = true;
      stopCameraStream();
    };
  }, [isCameraOpen, facingMode]);

  const handleCaptureFrame = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const dataUrl = captureCanvasToDataUrl(video, video.videoWidth, video.videoHeight);
    if (dataUrl) {
      onChange(dataUrl);
      setIsCameraOpen(false);
    }
  };

  const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const compressed = captureCanvasToDataUrl(img, img.width, img.height);
        if (compressed) {
          onChange(compressed);
        }
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className={compact ? 'inline-flex items-center gap-2' : 'space-y-2'}>
      <div className="flex items-center gap-3">
        {/* Customer Photo Thumbnail */}
        <div className="w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border-2 border-emerald-200 dark:border-emerald-800 overflow-hidden flex items-center justify-center shrink-0">
          {value ? (
            <img
              src={value}
              alt={customerName ? `${customerName} photo` : 'Customer photo'}
              className="w-full h-full object-cover"
            />
          ) : (
            <User className="w-6 h-6 text-emerald-700 dark:text-emerald-400" />
          )}
        </div>

        {/* Camera & Upload Controls */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setIsCameraOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>{value ? 'Retake Photo' : 'Take Photo'}</span>
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold border border-slate-200 dark:border-slate-700 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload / Phone Cam</span>
          </button>

          {value && (
            <button
              type="button"
              onClick={() => onChange(undefined)}
              aria-label="Remove customer photo"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-50 dark:bg-rose-950/40 hover:bg-red-100 dark:hover:bg-rose-900/50 text-red-700 dark:text-rose-300 text-xs font-semibold border border-red-200 dark:border-rose-800 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Remove</span>
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="user"
            onChange={handleFilePicked}
            aria-label="Upload customer identification photo"
            className="hidden"
          />
        </div>
      </div>

      {/* Live Camera Capture Modal */}
      {isCameraOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Customer Camera Photo Capture"
        >
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full overflow-hidden">
            <div className="px-4 py-3 bg-emerald-950 text-white flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold">
                <Camera className="w-4 h-4 text-emerald-300" />
                <span>Customer Photo Capture</span>
              </div>
              <button
                type="button"
                onClick={() => setIsCameraOpen(false)}
                aria-label="Close camera capture"
                className="p-1 rounded-lg text-emerald-200 hover:text-white hover:bg-emerald-900 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              {cameraError ? (
                <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 space-y-3">
                  <p className="font-semibold">{cameraError}</p>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Choose Photo / Phone Camera</span>
                  </button>
                </div>
              ) : (
                <div className="relative aspect-square max-h-72 mx-auto rounded-xl overflow-hidden bg-slate-950 border border-slate-700">
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    autoPlay
                    className="w-full h-full object-cover"
                  />
                  {isStartingCamera && (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-white/80 bg-slate-950/70">
                      Starting camera...
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={() =>
                    setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Switch ({facingMode === 'environment' ? 'Back' : 'Front'})</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsCameraOpen(false)}
                    className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                  >
                    Cancel
                  </button>
                  {!cameraError && (
                    <button
                      type="button"
                      onClick={handleCaptureFrame}
                      disabled={isStartingCamera}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Capture Photo</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
