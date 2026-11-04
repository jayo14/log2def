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
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  // Initialize camera stream with chosen facing mode
  const startCamera = useCallback(async (mode: 'environment' | 'user') => {
    setIsStartingCamera(true);
    setCameraError(null);

    // Stop existing stream if running
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error('Camera access not supported by browser. Please use file upload.');
      }

      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          facingMode: { ideal: mode },
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
        message = 'Camera permission denied. Allow camera access in browser settings.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        message = 'No camera device found.';
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
    startCamera(facingMode);
    return () => {
      stopCamera();
    };
  }, [facingMode, startCamera, stopCamera]);

  // Flip camera between rear and front
  const toggleFacingMode = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  // Capture single frame from live stream
  const handleSnap = async () => {
    if (!videoRef.current || isProcessingShot) return;
    setIsProcessingShot(true);
    setFlashActive(true);
    setTimeout(() => setFlashActive(false), 160);

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

      // Free canvas
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
  const targetLabel = capturedPages.length === 0 && existingPageCount === 0 ? 'Cover' : `Page ${currentPageNumber}`;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-between"
      style={{
        background: '#041d15',
        color: '#fff',
        fontFamily: "'Manrope', system-ui, sans-serif",
        height: '100dvh',
      }}
    >
      {/* Top Header — Sleek Brand Bar */}
      <header
        className="flex items-center justify-between px-3.5 sm:px-5 py-3 flex-none"
        style={{
          background: 'linear-gradient(180deg, rgba(4, 30, 22, 0.95), rgba(4, 30, 22, 0.6))',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(15, 163, 122, 0.2)',
          zIndex: 40,
        }}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="w-8 h-8 rounded-xl flex items-center justify-center flex-none"
            style={{ background: 'var(--mint, #dcf0e7)', color: 'var(--g, #066b4d)' }}
          >
            <span className="ms" style={{ fontSize: '18px' }}>photo_camera</span>
          </span>
          <div>
            <h2
              style={{
                fontFamily: "'Fraunces', Georgia, serif",
                fontSize: '15px',
                fontWeight: 600,
                margin: 0,
                lineHeight: 1.2,
                color: '#fff',
              }}
            >
              Logbook Scanner
            </h2>
            <div className="flex items-center gap-2 text-xs" style={{ color: 'rgba(255,255,255,0.7)', marginTop: '2px' }}>
              <span>Target: <strong style={{ color: '#58d6ad' }}>{targetLabel}</strong></span>
              <span>•</span>
              <span>{capturedPages.length} snapped</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Flip camera */}
          <button
            type="button"
            onClick={toggleFacingMode}
            className="w-8 h-8 rounded-full flex items-center justify-center transition active:scale-90"
            style={{
              background: 'rgba(255,255,255,0.12)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.2)',
              cursor: 'pointer',
            }}
            title="Switch Camera (Front/Rear)"
            aria-label="Switch Camera"
          >
            <span className="ms" style={{ fontSize: '18px' }}>flip_camera_ios</span>
          </button>

          {/* Close button */}
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onCancel();
            }}
            className="px-3 py-1.5 rounded-full text-xs font-bold transition hover:opacity-80"
            style={{
              background: 'rgba(255,255,255,0.12)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.2)',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      </header>

      {/* Camera Viewport & Focus Frame */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden bg-black">
        {flashActive && (
          <div className="absolute inset-0 bg-white z-30 opacity-75 transition-opacity pointer-events-none" />
        )}

        {isStartingCamera && (
          <div className="flex flex-col items-center gap-2.5 text-xs text-white/70">
            <div
              className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: 'var(--gl, #0fa37a)', borderTopColor: 'transparent' }}
            />
            <span>Initializing rear camera...</span>
          </div>
        )}

        {cameraError && (
          <div
            className="max-w-xs sm:max-w-sm p-5 rounded-2xl text-center space-y-3 mx-4"
            style={{
              background: 'rgba(20, 32, 27, 0.9)',
              border: '1px solid rgba(220, 38, 38, 0.4)',
              backdropFilter: 'blur(10px)',
            }}
          >
            <span className="ms" style={{ fontSize: '32px', color: '#f87171' }}>videocam_off</span>
            <p style={{ fontSize: '14px', fontWeight: 700, margin: 0, color: '#fca5a5' }}>Camera Unavailable</p>
            <p style={{ fontSize: '12px', color: '#e5e7eb', margin: 0 }}>{cameraError}</p>
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => startCamera(facingMode)}
                className="px-4 py-1.5 rounded-full text-xs font-bold"
                style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', cursor: 'pointer' }}
              >
                Retry
              </button>
              <button
                type="button"
                onClick={() => {
                  stopCamera();
                  onCancel();
                }}
                className="px-4 py-1.5 rounded-full text-xs font-bold"
                style={{ background: 'var(--g, #066b4d)', color: '#fff', border: 'none', cursor: 'pointer' }}
              >
                Use Upload
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

        {/* Brand Document Alignment Frame */}
        {!cameraError && !isStartingCamera && (
          <div className="absolute inset-4 sm:inset-8 pointer-events-none flex flex-col justify-between items-center">
            {/* Top alignment badge */}
            <div
              className="px-3 py-1 rounded-full text-[11px] font-bold flex items-center gap-1.5 shadow-md"
              style={{
                background: 'rgba(4, 30, 22, 0.75)',
                color: '#58d6ad',
                border: '1px solid rgba(15, 163, 122, 0.4)',
                backdropFilter: 'blur(6px)',
              }}
            >
              <span className="ms" style={{ fontSize: '13px' }}>crop_free</span>
              <span>Align page edges inside frame</span>
            </div>

            {/* Document Corner Brackets */}
            <div
              className="w-full flex-1 my-3 relative rounded-2xl"
              style={{
                border: '1.5px dashed rgba(88, 214, 173, 0.35)',
              }}
            >
              {/* Corner 1: Top-Left */}
              <div
                className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 rounded-tl-xl"
                style={{ borderColor: '#58d6ad' }}
              />
              {/* Corner 2: Top-Right */}
              <div
                className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 rounded-tr-xl"
                style={{ borderColor: '#58d6ad' }}
              />
              {/* Corner 3: Bottom-Left */}
              <div
                className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 rounded-bl-xl"
                style={{ borderColor: '#58d6ad' }}
              />
              {/* Corner 4: Bottom-Right */}
              <div
                className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 rounded-br-xl"
                style={{ borderColor: '#58d6ad' }}
              />
            </div>
          </div>
        )}

        {/* Quality Warning Pill Banner */}
        {lastWarning && (
          <div
            className="absolute top-3 inset-x-4 z-20 p-2.5 rounded-2xl flex items-center justify-between gap-2 shadow-lg animate-fade-in"
            style={{
              background: 'rgba(138, 90, 0, 0.9)',
              color: '#fff',
              border: '1px solid #fde68a',
              backdropFilter: 'blur(8px)',
            }}
          >
            <div className="flex items-center gap-2 text-xs min-w-0">
              <span className="ms flex-none" style={{ fontSize: '18px', color: '#fef08a' }}>warning</span>
              <span className="truncate">{lastWarning}</span>
            </div>
            <button
              type="button"
              onClick={handleRetakeLast}
              className="px-2.5 py-1 rounded-full text-xs font-bold flex-none transition"
              style={{ background: '#fff', color: '#8a5a00', border: 'none', cursor: 'pointer' }}
            >
              Retake
            </button>
          </div>
        )}
      </div>

      {/* Thumbnail Preview Strip */}
      {capturedPages.length > 0 && (
        <div
          className="px-3.5 py-2 flex-none"
          style={{
            background: 'rgba(4, 25, 18, 0.95)',
            borderTop: '1px solid rgba(15, 163, 122, 0.2)',
          }}
        >
          <div className="flex items-center gap-2.5 overflow-x-auto pb-0.5 scrollbar-thin">
            {capturedPages.map((p) => (
              <div
                key={p.id}
                className="relative flex-none w-14 h-18 rounded-xl overflow-hidden group shadow-sm"
                style={{ border: '1.5px solid var(--gl, #0fa37a)', background: '#000' }}
              >
                <img src={p.thumbnailUrl} alt={p.label} className="w-full h-full object-cover" />
                <span
                  className="absolute bottom-0 inset-x-0 text-[9px] font-bold text-center py-0.5 truncate px-0.5"
                  style={{ background: 'rgba(0,0,0,0.75)', color: '#fff' }}
                >
                  {p.label}
                </span>
                <button
                  type="button"
                  onClick={() => handleDeletePage(p.id)}
                  className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center text-[10px] text-white opacity-90 hover:opacity-100"
                  style={{ background: 'rgba(180, 35, 24, 0.9)', border: 'none', cursor: 'pointer' }}
                  title="Remove page"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottom Shutter & Controls Bar */}
      <footer
        className="px-4 sm:px-8 py-3.5 sm:py-5 flex items-center justify-between flex-none"
        style={{
          background: 'linear-gradient(0deg, rgba(4, 30, 22, 0.98), rgba(4, 30, 22, 0.8))',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderTop: '1px solid rgba(15, 163, 122, 0.2)',
        }}
      >
        {/* Left: Retake Last */}
        <div className="w-24 flex items-center">
          {capturedPages.length > 0 && (
            <button
              type="button"
              onClick={handleRetakeLast}
              disabled={isProcessingShot}
              className="px-3 py-1.5 rounded-full text-xs font-bold text-white/80 hover:text-white transition disabled:opacity-40"
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                cursor: 'pointer',
              }}
            >
              Retake
            </button>
          )}
        </div>

        {/* Center: Tactile Shutter Button */}
        <button
          type="button"
          onClick={handleSnap}
          disabled={isStartingCamera || Boolean(cameraError) || isProcessingShot}
          className="relative w-18 h-18 sm:w-20 sm:h-20 rounded-full flex items-center justify-center p-1.5 transition active:scale-95 disabled:opacity-40"
          style={{
            border: '4px solid var(--gl, #0fa37a)',
            boxShadow: '0 0 20px rgba(15, 163, 122, 0.5)',
            background: 'transparent',
            cursor: isStartingCamera || Boolean(cameraError) || isProcessingShot ? 'not-allowed' : 'pointer',
          }}
          title="Capture Logbook Page"
          aria-label="Capture Logbook Page"
        >
          <div
            className="w-13 h-13 sm:w-15 sm:h-15 rounded-full flex items-center justify-center transition"
            style={{
              background: '#fff',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            }}
          >
            {isProcessingShot && (
              <div
                className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: 'var(--g, #066b4d)', borderTopColor: 'transparent' }}
              />
            )}
          </div>
        </button>

        {/* Right: Done Button */}
        <div className="w-24 flex justify-end">
          <button
            type="button"
            onClick={handleFinish}
            disabled={capturedPages.length === 0}
            className="px-4 py-2 rounded-full text-xs font-extrabold flex items-center gap-1.5 shadow-md transition disabled:opacity-40"
            style={{
              background: 'var(--g, #066b4d)',
              color: '#fff',
              border: 'none',
              cursor: capturedPages.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            <span>Done</span>
            {capturedPages.length > 0 && (
              <span
                className="w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-bold"
                style={{ background: '#fff', color: 'var(--g, #066b4d)' }}
              >
                {capturedPages.length}
              </span>
            )}
          </button>
        </div>
      </footer>
    </div>
  );
}
