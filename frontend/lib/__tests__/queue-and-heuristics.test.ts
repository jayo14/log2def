import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateMeanLuminance,
  calculateLaplacianVariance,
  evaluateLogbookImageQuality,
} from '../image-processor.ts';

describe('Log2Def Image Processor & Heuristics Unit Tests', () => {
  test('calculateMeanLuminance returns 0 for pure black pixels', () => {
    // 4 pixels RGBA (0, 0, 0, 255)
    const blackPixels = new Uint8ClampedArray([
      0, 0, 0, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
      0, 0, 0, 255,
    ]);
    const luma = calculateMeanLuminance(blackPixels);
    assert.equal(luma, 0);
  });

  test('calculateMeanLuminance returns 255 for pure white pixels', () => {
    // 4 pixels RGBA (255, 255, 255, 255)
    const whitePixels = new Uint8ClampedArray([
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
    ]);
    const luma = calculateMeanLuminance(whitePixels);
    assert.equal(Math.round(luma), 255);
  });

  test('calculateLaplacianVariance detects low edge variance on flat uniform image', () => {
    // 10x10 uniform gray grid (flat, zero edge detail)
    const size = 10;
    const flatData = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < flatData.length; i += 4) {
      flatData[i] = 128;     // R
      flatData[i + 1] = 128; // G
      flatData[i + 2] = 128; // B
      flatData[i + 3] = 255; // A
    }

    const variance = calculateLaplacianVariance(flatData, size, size);
    assert.equal(variance, 0);
  });

  test('calculateLaplacianVariance detects high variance on high-contrast edge pattern', () => {
    // 10x10 alternating black and white checkerboard pattern (sharp edges)
    const size = 10;
    const edgeData = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const color = (x + y) % 2 === 0 ? 255 : 0;
        edgeData[idx] = color;
        edgeData[idx + 1] = color;
        edgeData[idx + 2] = color;
        edgeData[idx + 3] = 255;
      }
    }

    const variance = calculateLaplacianVariance(edgeData, size, size);
    assert.ok(variance > 100, `Expected variance > 100 for sharp edges, got ${variance}`);
  });

  test('evaluateLogbookImageQuality flags dark, blurry, and low-res captures', () => {
    // Case 1: Too dark
    const darkReport = evaluateLogbookImageQuality(1200, 1600, 30, 120);
    assert.equal(darkReport.isAcceptable, false);
    assert.ok(darkReport.warnings.some((w) => w.includes('Too dark')));

    // Case 2: Blurry
    const blurryReport = evaluateLogbookImageQuality(1200, 1600, 120, 40);
    assert.equal(blurryReport.isAcceptable, false);
    assert.ok(blurryReport.warnings.some((w) => w.includes('Blurry image')));

    // Case 3: Low resolution
    const lowResReport = evaluateLogbookImageQuality(600, 700, 120, 120);
    assert.equal(lowResReport.isAcceptable, false);
    assert.ok(lowResReport.warnings.some((w) => w.includes('Low resolution')));

    // Case 4: High quality capture
    const goodReport = evaluateLogbookImageQuality(1200, 1600, 130, 150);
    assert.equal(goodReport.isAcceptable, true);
    assert.equal(goodReport.warnings.length, 0);
  });
});

describe('Upload Queue Ordering & Idempotency Simulation', () => {
  interface MockQueueItem {
    id: string;
    pageIndex: number;
    retryCount: number;
    status: string;
  }

  test('queue preserves explicit sequential page_index and survives reordering', () => {
    const queue: MockQueueItem[] = [
      { id: 'page_0', pageIndex: 0, retryCount: 0, status: 'pending' },
      { id: 'page_1', pageIndex: 1, retryCount: 0, status: 'pending' },
      { id: 'page_2', pageIndex: 2, retryCount: 0, status: 'pending' },
    ];

    // Simulate student reordering: page_2 moved to the front (Cover)
    const newOrderIds = ['page_2', 'page_0', 'page_1'];
    const reorderedQueue = newOrderIds.map((id, newIndex) => {
      const item = queue.find((q) => q.id === id)!;
      return { ...item, pageIndex: newIndex };
    });

    assert.equal(reorderedQueue[0].id, 'page_2');
    assert.equal(reorderedQueue[0].pageIndex, 0);
    assert.equal(reorderedQueue[1].id, 'page_0');
    assert.equal(reorderedQueue[1].pageIndex, 1);
    assert.equal(reorderedQueue[2].id, 'page_1');
    assert.equal(reorderedQueue[2].pageIndex, 2);
  });

  test('exponential backoff delay calculates correct intervals up to cap', () => {
    function getBackoffDelay(retryCount: number): number {
      return Math.min(1000 * Math.pow(2, retryCount - 1), 6000);
    }

    assert.equal(getBackoffDelay(1), 1000); // 1s
    assert.equal(getBackoffDelay(2), 2000); // 2s
    assert.equal(getBackoffDelay(3), 4000); // 4s
    assert.equal(getBackoffDelay(4), 6000); // capped at 6s
    assert.equal(getBackoffDelay(5), 6000); // capped at 6s
  });

  test('bounded concurrency pool throttles parallel tasks to limit', async () => {
    let activeWorkers = 0;
    let peakConcurrency = 0;
    const maxConcurrency = 2;
    const taskIds = [1, 2, 3, 4, 5];

    async function executeWorker(id: number) {
      activeWorkers++;
      if (activeWorkers > peakConcurrency) peakConcurrency = activeWorkers;
      await new Promise((r) => setTimeout(r, 20));
      activeWorkers--;
    }

    const queue = [...taskIds];
    const workers: Promise<void>[] = [];

    async function runner() {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item !== undefined) {
          await executeWorker(item);
        }
      }
    }

    for (let w = 0; w < maxConcurrency; w++) {
      workers.push(runner());
    }

    await Promise.all(workers);

    assert.equal(queue.length, 0);
    assert.ok(peakConcurrency <= maxConcurrency, `Peak concurrency ${peakConcurrency} exceeded limit ${maxConcurrency}`);
  });
});
