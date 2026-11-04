/**
 * Log2Def Client-Side Memory-Safe Image Processor & Quality Validator
 * Designed specifically for low-end Android mobile devices (2GB-3GB RAM).
 *
 * Technical Specifications & Rationale:
 * 1. Max Dimension: 1600px on the longest edge.
 *    - Standard 12MP-48MP smartphone photos consume 40MB-190MB of raw decoded pixel memory.
 *    - Downscaling to 1600px gives ~200 DPI for standard A5/A4 logbook pages, preserving
 *      ink strokes, signatures, and printed table borders while reducing decoded canvas RAM to <8MB.
 * 2. Compression Quality: JPEG 0.82.
 *    - Preserves high-frequency text boundaries without compression ringing.
 *    - Reduces file payload from ~5MB to ~180KB-320KB, ideal for Nigerian mobile cellular networks.
 * 3. Thumbnail: 160px at JPEG 0.60.
 *    - Allows 40-50 pages to be previewed and reordered simultaneously in UI using <350KB RAM total.
 * 4. Resource Disposal:
 *    - Releases backing store canvas immediately (resizes to 1x1).
 *    - Provides URL revoke helpers to prevent detached DOM / blob memory leaks.
 */

export interface ImageQualityReport {
  isAcceptable: boolean;
  warnings: string[];
  metrics: {
    width: number;
    height: number;
    meanLuminance: number;
    laplacianVariance: number;
  };
}

export interface ProcessedImageResult {
  blob: Blob;
  thumbnailDataUrl: string;
  width: number;
  height: number;
  quality: ImageQualityReport;
}

const MAX_LONG_EDGE = 1600;
const JPEG_QUALITY = 0.82;
const THUMB_MAX_EDGE = 160;
const THUMB_QUALITY = 0.60;

/**
 * Calculates average luminance across RGBA image data (0-255).
 * Formula: Y = 0.299R + 0.587G + 0.114B
 */
export function calculateMeanLuminance(data: Uint8ClampedArray): number {
  let totalLuma = 0;
  const count = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    totalLuma += luma;
  }
  return count > 0 ? totalLuma / count : 128;
}

/**
 * Calculates variance of Laplacian on a grayscale grid to detect camera blur.
 * Sharp text images produce high edge variance (>100); out-of-focus or motion-blurred
 * captures have low variance (<65).
 */
export function calculateLaplacianVariance(
  data: Uint8ClampedArray,
  width: number,
  height: number
): number {
  if (width < 3 || height < 3) return 100;

  // Step 1: Convert to grayscale array
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const idx = i * 4;
    gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }

  // Step 2: Convolve with 3x3 Laplacian kernel:
  // [ 0,  1,  0 ]
  // [ 1, -4,  1 ]
  // [ 0,  1,  0 ]
  const laplacian = [];
  let sum = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const val =
        gray[idx - width] +
        gray[idx - 1] -
        4 * gray[idx] +
        gray[idx + 1] +
        gray[idx + width];
      laplacian.push(val);
      sum += val;
    }
  }

  const n = laplacian.length;
  if (n === 0) return 100;

  const mean = sum / n;
  let varianceSum = 0;
  for (let i = 0; i < n; i++) {
    const diff = laplacian[i] - mean;
    varianceSum += diff * diff;
  }

  return varianceSum / n;
}

/**
 * Evaluates image quality against Nigerian SIWES student logbook criteria.
 */
export function evaluateLogbookImageQuality(
  width: number,
  height: number,
  meanLuma: number,
  blurVariance: number
): ImageQualityReport {
  const warnings: string[] = [];

  // 1. Resolution Check
  if (width < 800 || height < 800) {
    warnings.push('Low resolution: Image is small. Move camera closer to fill the page for clearer text.');
  }

  // 2. Lighting / Darkness Check
  if (meanLuma < 45) {
    warnings.push('Too dark: The page is poorly lit. Turn on your flashlight or move near sunlight and retake.');
  } else if (meanLuma > 240) {
    warnings.push('Overexposed: Harsh light or reflection detected. Tilt camera slightly away from direct bulb.');
  }

  // 3. Blur / Focus Check
  if (blurVariance < 65) {
    warnings.push('Blurry image: Handwriting appears out of focus. Rest phone on a steady surface and retake.');
  }

  return {
    isAcceptable: warnings.length === 0,
    warnings,
    metrics: {
      width,
      height,
      meanLuminance: Math.round(meanLuma),
      laplacianVariance: Math.round(blurVariance),
    },
  };
}

/**
 * Loads an image Blob/File safely into an HTMLImageElement without leaking memory.
 */
function loadImageSafely(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image into memory: ' + err));
    };
    img.src = url;
  });
}

/**
 * Sequential processing pipeline for a single logbook image:
 * 1. Downscales image to max 1600px maintaining aspect ratio.
 * 2. Compresses to JPEG 0.82 for OCR.
 * 3. Generates a lightweight 160px thumbnail data URL for UI display.
 * 4. Runs brightness, blur, and resolution heuristics.
 * 5. Cleans up canvases immediately to release mobile RAM.
 */
export async function processLogbookImage(fileOrBlob: Blob): Promise<ProcessedImageResult> {
  const img = await loadImageSafely(fileOrBlob);

  const origWidth = img.naturalWidth || img.width;
  const origHeight = img.naturalHeight || img.height;

  // Compute scaled dimensions for OCR-grade file (max 1600px)
  let targetWidth = origWidth;
  let targetHeight = origHeight;
  const maxEdge = Math.max(origWidth, origHeight);

  if (maxEdge > MAX_LONG_EDGE) {
    const scale = MAX_LONG_EDGE / maxEdge;
    targetWidth = Math.round(origWidth * scale);
    targetHeight = Math.round(origHeight * scale);
  }

  // Draw scaled image on primary canvas
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    throw new Error('Unable to acquire 2D canvas rendering context');
  }

  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  // Sample a 200x200 downscaled region for lightning-fast blur & brightness analysis
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = 200;
  sampleCanvas.height = 200;
  const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

  let quality: ImageQualityReport;
  if (sampleCtx) {
    sampleCtx.drawImage(canvas, 0, 0, 200, 200);
    const sampleData = sampleCtx.getImageData(0, 0, 200, 200);
    const meanLuma = calculateMeanLuminance(sampleData.data);
    const blurVariance = calculateLaplacianVariance(sampleData.data, 200, 200);
    quality = evaluateLogbookImageQuality(origWidth, origHeight, meanLuma, blurVariance);

    // Free sample canvas
    sampleCanvas.width = 1;
    sampleCanvas.height = 1;
  } else {
    quality = {
      isAcceptable: true,
      warnings: [],
      metrics: { width: origWidth, height: origHeight, meanLuminance: 128, laplacianVariance: 100 },
    };
  }

  // Generate lightweight 160px micro-thumbnail for UI
  const thumbScale = THUMB_MAX_EDGE / Math.max(targetWidth, targetHeight);
  const thumbWidth = Math.max(1, Math.round(targetWidth * thumbScale));
  const thumbHeight = Math.max(1, Math.round(targetHeight * thumbScale));

  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = thumbWidth;
  thumbCanvas.height = thumbHeight;
  const thumbCtx = thumbCanvas.getContext('2d');
  let thumbnailDataUrl = '';

  if (thumbCtx) {
    thumbCtx.drawImage(canvas, 0, 0, thumbWidth, thumbHeight);
    thumbnailDataUrl = thumbCanvas.toDataURL('image/jpeg', THUMB_QUALITY);
    thumbCanvas.width = 1;
    thumbCanvas.height = 1;
  }

  // Export compressed Blob
  const compressedBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('Canvas image compression failed'));
      },
      'image/jpeg',
      JPEG_QUALITY
    );
  });

  // Explicitly free main canvas backing memory
  canvas.width = 1;
  canvas.height = 1;

  return {
    blob: compressedBlob,
    thumbnailDataUrl,
    width: targetWidth,
    height: targetHeight,
    quality,
  };
}
