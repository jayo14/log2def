'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { processLogbookImage, ProcessedImageResult } from '@/lib/image-processor';

export interface CapturedPage {
  id: string;
  blob: Blob;
  thumbnailUrl: string;
  pageIndex: number;
  label: string;
  qualityWarning?: string;
}

interface CameraCaptureProps {
  onCaptureComplete: (pages: CapturedPage[]) => void;
  onCancel: () => void;
  existingPageCount?: number;
}

export default function CameraCapture({
  onCaptureComplete,
  onCancel,
  existingPageCount = 0,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [isStartingCamera, setIsStartingCamera] = useState(true);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedPages, setCapturedPages] = useState<CapturedPage[]>([]);
  const [isProcessingShot, setIsProcessingShot] = useState(false);
  const [flashActive, setFlashActive] = useState(false);
  const [lastWarning, setLastWarning] = useState<string | null>(null);

  // Initialize camera stream with rear camera preference (environment)
  const startCamera = useCallback(async () => {
    setIsStartingCamera(true);
    setCameraError(null);

    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error('Camera access is not supported by your browser. Please use file upload.');
      }

      // Constraints prefer rear camera and 1080p resolution
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setIsStartingCamera(false);
    } catch (err: any) {
      console.error('Camera initialization error:', err);
      let message = 'Unable to access camera.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        message = 'Camera permission denied. Please allow camera permissions in browser settings.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        message = 'No camera found on this device.';
      } else if (err.message) {
        message = err.message;
      }
      setCameraError(message);
      setIsStartingCamera(false);
    }
  }, []);

  // Stop camera tracks cleanly
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  // Capture single frame from the live video stream without restarting stream
  const handleSnap = async () => {
    if (!videoRef.current || isProcessingShot) return;
    setIsProcessingShot(true);
    setFlashActive(true);
    setTimeout(() => setFlashActive(false), 200);

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1920;
    canvas.height = video.videoHeight || 1080;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      setIsProcessingShot(false);
      return;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Failed to create snapshot blob'))),
          'image/jpeg',
          0.90
        );
      });

      // Free capture canvas
      canvas.width = 1;
      canvas.height = 1;

      // Sequential compression and quality check
      const processed: ProcessedImageResult = await processLogbookImage(blob);

      const currentPageIndex = existingPageCount + capturedPages.length;
      const label = currentPageIndex === 0 ? 'Cover Page' : `Page ${currentPageIndex + 1}`;
      const warning = !processed.quality.isAcceptable && processed.quality.warnings.length > 0
        ? processed.quality.warnings[0]
        : undefined;

      const newPage: CapturedPage = {
        id: `cap_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        blob: processed.blob,
        thumbnailUrl: processed.thumbnailDataUrl,
        pageIndex: currentPageIndex,
        label,
        qualityWarning: warning,
      };

      setCapturedPages((prev) => [...prev, newPage]);
      if (warning) {
        setLastWarning(warning);
      } else {
        setLastWarning(null);
      }
    } catch (err: any) {
      console.error('Error processing captured frame:', err);
    } finally {
      setIsProcessingShot(false);
    }
  };

  // Retake the most recent page
  const handleRetakeLast = () => {
    setCapturedPages((prev) => prev.slice(0, prev.length - 1));
    setLastWarning(null);
  };

  // Delete a specific page
  const handleDeletePage = (id: string) => {
    setCapturedPages((prev) => {
      const filtered = prev.filter((p) => p.id !== id);
      return filtered.map((p, idx) => {
        const pageIdx = existingPageCount + idx;
        return {
          ...p,
          pageIndex: pageIdx,
          label: pageIdx === 0 ? 'Cover Page' : `Page ${pageIdx + 1}`,
        };
      });
    });
  };

  // Done capturing - handover to upload queue
  const handleFinish = () => {
    stopCamera();
    onCaptureComplete(capturedPages);
  };

  const currentPageNumber = existingPageCount + capturedPages.length + 1;
  const targetLabel = capturedPages.length === 0 && existingPageCount === 0 ? 'Cover Page' : `Page ${currentPageNumber}`;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white">
      {/* Top Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">
            Logbook Camera Capture
          </h2>
          <p className="text-xs text-slate-400">
            Next target: <span className="text-emerald-400 font-medium">{targetLabel}</span> • {capturedPages.length} snapped
          </p>
        </div>
        <button
          onClick={() => {
            stopCamera();
            onCancel();
          }}
          className="px-3 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition"
        >
          Cancel
        </button>
      </header>

      {/* Camera Viewport */}
      <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
        {flashActive && <div className="absolute inset-0 bg-white z-30 opacity-75 transition-opacity" />}

        {isStartingCamera && (
          <div className="flex flex-col items-center gap-2 text-slate-400 text-sm">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <p>Accessing rear camera...</p>
          </div>
        )}

        {cameraError && (
          <div className="max-w-md p-6 bg-slate-900 border border-red-500/30 rounded-xl text-center space-y-3 mx-4">
            <p className="text-sm font-semibold text-red-400">Camera Unavailable</p>
            <p className="text-xs text-slate-300">{cameraError}</p>
            <div className="flex justify-center gap-3 pt-2">
              <button
                onClick={startCamera}
                className="px-4 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition"
              >
                Retry Camera
              </button>
              <button
                onClick={() => {
                  stopCamera();
                  onCancel();
                }}
                className="px-4 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition"
              >
                Use File Upload Instead
              </button>
            </div>
          </div>
        )}

        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`w-full h-full object-cover ${cameraError ? 'hidden' : 'block'}`}
        />

        {/* Viewfinder Target Overlay */}
        {!cameraError && !isStartingCamera && (
          <div className="absolute inset-8 pointer-events-none border-2 border-dashed border-emerald-400/40 rounded-2xl flex flex-col justify-between p-4">
            <div className="flex justify-between text-[11px] text-emerald-300 font-mono bg-black/40 px-2 py-1 rounded backdrop-blur self-start">
              Align page edges inside frame
            </div>
          </div>
        )}

        {/* Quality Warning Prompt */}
        {lastWarning && (
          <div className="absolute top-4 left-4 right-4 z-20 bg-amber-950/90 border border-amber-500/50 rounded-xl p-3 backdrop-blur shadow-lg flex items-start justify-between gap-3 animate-fade-in">
            <div className="text-xs text-amber-200">
              <p className="font-semibold text-amber-100">Quality Notice on Last Shot</p>
              <p className="mt-0.5">{lastWarning}</p>
            </div>
            <button
              onClick={handleRetakeLast}
              className="px-3 py-1 text-xs font-semibold bg-amber-500 text-slate-950 hover:bg-amber-400 rounded-lg whitespace-nowrap transition"
            >
              Retake
            </button>
          </div>
        )}
      </div>

      {/* Thumbnail Strip */}
      {capturedPages.length > 0 && (
        <div className="bg-slate-900 border-t border-slate-800 px-4 py-2">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
            {capturedPages.map((page, idx) => (
              <div
                key={page.id}
                className="relative flex-shrink-0 w-16 h-20 rounded border border-slate-700 bg-slate-800 overflow-hidden group"
              >
                <img
                  src={page.thumbnailUrl}
                  alt={page.label}
                  className="w-full h-full object-cover"
                />
                <span className="absolute bottom-0 inset-x-0 bg-black/70 text-[9px] text-center text-slate-200 truncate px-0.5">
                  {page.label}
                </span>
                {page.qualityWarning && (
                  <span
                    title={page.qualityWarning}
                    className="absolute top-0.5 right-0.5 w-3 h-3 bg-amber-500 text-[8px] font-bold text-black rounded-full flex items-center justify-center"
                  >
                    !
                  </span>
                )}
                <button
                  onClick={() => handleDeletePage(page.id)}
                  className="absolute top-0.5 left-0.5 w-4 h-4 bg-red-600/90 hover:bg-red-500 text-[10px] text-white rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                  title="Delete page"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottom Shutter Controls */}
      <footer className="bg-slate-950 px-6 py-4 border-t border-slate-900 flex items-center justify-between">
        <div className="w-24">
          {capturedPages.length > 0 && (
            <button
              onClick={handleRetakeLast}
              disabled={isProcessingShot}
              className="text-xs text-slate-400 hover:text-white px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 transition"
            >
              Retake Last
            </button>
          )}
        </div>

        {/* Shutter Button */}
        <button
          onClick={handleSnap}
          disabled={isStartingCamera || !!cameraError || isProcessingShot}
          className="relative w-18 h-18 rounded-full border-4 border-white flex items-center justify-center p-1 active:scale-95 transition disabled:opacity-40"
          title="Take photo"
        >
          <div className="w-14 h-14 rounded-full bg-emerald-500 hover:bg-emerald-400 flex items-center justify-center">
            {isProcessingShot && (
              <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
          </div>
        </button>

        {/* Done Button */}
        <div className="w-24 flex justify-end">
          <button
            onClick={handleFinish}
            disabled={capturedPages.length === 0}
            className="px-4 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg disabled:opacity-40 disabled:hover:bg-emerald-600 transition"
          >
            Done ({capturedPages.length})
          </button>
        </div>
      </footer>
    </div>
  );
}
