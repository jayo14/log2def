// Log2Def Bounded Concurrency & IndexedDB Offline Upload Queue Manager
// Designed for memory safety on mobile Android devices.

import { processLogbookImage } from './image-processor';

export interface QueuedUpload {
  id: string; // Used as client_upload_id for backend idempotency
  projectId: number | string;
  pageIndex: number; // Explicit sequential page order
  fileName: string;
  fileType: string;
  fileSize: number;
  fileBlob: Blob;
  thumbnailUrl: string; // Micro thumbnail (<8KB) for UI previews
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  progress: number; // 0 to 100
  createdAt: number;
  retryCount: number;
  error?: string;
  qualityWarning?: string;
}

const DB_NAME = 'Log2DefUploadsDB';
const STORE_NAME = 'upload_queue';
const DB_VERSION = 2;

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported in this environment'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('projectId', 'projectId', { unique: false });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('pageIndex', 'pageIndex', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

/**
 * Sequential ingestion of captured images or selected files:
 * Compresses one image at a time, checks quality, generates micro-thumbnail,
 * and saves into IndexedDB with an explicit pageIndex.
 */
export async function enqueueUploads(
  projectId: number | string,
  files: (File | Blob)[],
  options: {
    startPageIndex?: number;
    fileNames?: string[];
    onProgress?: (processed: number, total: number) => void;
  } = {}
): Promise<QueuedUpload[]> {
  const existing = await getQueuedUploads(projectId);
  let nextPageIndex = options.startPageIndex ?? existing.length;

  const db = await getDB();
  const queuedList: QueuedUpload[] = [];
  const now = Date.now();

  for (let i = 0; i < files.length; i++) {
    const rawFile = files[i];
    const originalName =
      (rawFile as File).name ||
      (options.fileNames && options.fileNames[i]) ||
      `page_${nextPageIndex + 1}.jpg`;
    const isImage = rawFile.type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(originalName);

    let finalBlob: Blob = rawFile;
    let thumbnailUrl = '';
    let qualityWarning: string | undefined;

    if (isImage) {
      try {
        const processed = await processLogbookImage(rawFile);
        finalBlob = processed.blob;
        thumbnailUrl = processed.thumbnailDataUrl;
        if (!processed.quality.isAcceptable && processed.quality.warnings.length > 0) {
          qualityWarning = processed.quality.warnings[0];
        }
      } catch (err) {
        console.warn('Sequential image processing fallback:', err);
      }
    }

    const uploadId = `upl_${projectId}_${now}_${i}_${Math.random().toString(36).substring(2, 8)}`;
    const item: QueuedUpload = {
      id: uploadId,
      projectId,
      pageIndex: nextPageIndex,
      fileName: originalName,
      fileType: isImage ? 'image/jpeg' : rawFile.type || 'application/octet-stream',
      fileSize: finalBlob.size,
      fileBlob: finalBlob,
      thumbnailUrl,
      status: 'pending',
      progress: 0,
      createdAt: now,
      retryCount: 0,
      qualityWarning,
    };

    // Save item to IndexedDB
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(item);
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });

    queuedList.push(item);
    nextPageIndex++;

    if (options.onProgress) {
      options.onProgress(i + 1, files.length);
    }
  }

  notifyQueueUpdated();
  registerBackgroundSync();
  return queuedList;
}

/**
 * Retrieve all queued items for a specific project, ordered strictly by pageIndex.
 */
export async function getQueuedUploads(projectId?: number | string): Promise<QueuedUpload[]> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    const request = store.getAll();
    const items = await new Promise<QueuedUpload[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    let filtered = items;
    if (projectId !== undefined) {
      filtered = items.filter((item) => String(item.projectId) === String(projectId));
    }
    return filtered.sort((a, b) => a.pageIndex - b.pageIndex);
  } catch {
    return [];
  }
}

/**
 * Reorder queued uploads and update their pageIndex in IndexedDB.
 */
export async function reorderQueuedUploads(
  projectId: number | string,
  orderedIds: string[]
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);

  for (let newIndex = 0; newIndex < orderedIds.length; newIndex++) {
    const id = orderedIds[newIndex];
    const getReq = store.get(id);
    await new Promise<void>((resolve, reject) => {
      getReq.onsuccess = () => {
        const item = getReq.result as QueuedUpload | undefined;
        if (item) {
          item.pageIndex = newIndex;
          store.put(item);
        }
        resolve();
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  notifyQueueUpdated();
}

/**
 * Remove a single upload item from queue.
 */
export async function removeQueuedUpload(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  notifyQueueUpdated();
}

/**
 * Clear all completed items for a project.
 */
export async function clearCompletedUploads(projectId?: number | string): Promise<void> {
  const items = await getQueuedUploads(projectId);
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);

  for (const item of items) {
    if (item.status === 'completed') {
      store.delete(item.id);
    }
  }

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  notifyQueueUpdated();
}

/**
 * Bounded concurrency queue processor.
 * Uploads files in parallel with maxConcurrency (default 2 workers).
 * Uses exponential backoff on retry (up to 3 retries).
 * Sends client_upload_id and page_index for backend idempotency and ordering.
 */
let isProcessingQueue = false;

export async function processUploadQueue(
  uploadSingleCaller: (
    projectId: number | string,
    formData: FormData,
    onProgress?: (pct: number) => void
  ) => Promise<any>,
  projectId?: number | string,
  options: {
    maxConcurrency?: number;
    maxRetries?: number;
    onItemCompleted?: (item: QueuedUpload) => void;
  } = {}
): Promise<{ processed: number; failed: number }> {
  if (isProcessingQueue) return { processed: 0, failed: 0 };
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { processed: 0, failed: 0 };
  }

  isProcessingQueue = true;
  let processed = 0;
  let failed = 0;

  const maxConcurrency = options.maxConcurrency ?? 2;
  const maxRetries = options.maxRetries ?? 3;

  try {
    const allQueued = await getQueuedUploads(projectId);
    const pendingItems = allQueued.filter(
      (item) => item.status === 'pending' || (item.status === 'failed' && item.retryCount < maxRetries)
    );

    if (pendingItems.length === 0) {
      return { processed: 0, failed: 0 };
    }

    const db = await getDB();

    // Helper to execute single item upload with exponential backoff
    async function uploadWorker(item: QueuedUpload): Promise<boolean> {
      // Exponential backoff wait if retryCount > 0
      if (item.retryCount > 0) {
        const delayMs = Math.min(1000 * Math.pow(2, item.retryCount - 1), 6000);
        await new Promise((r) => setTimeout(r, delayMs));
      }

      // Mark status as uploading
      item.status = 'uploading';
      item.progress = 10;
      const txStart = db.transaction(STORE_NAME, 'readwrite');
      txStart.objectStore(STORE_NAME).put(item);
      await new Promise<void>((r) => { txStart.oncomplete = () => r(); });
      notifyQueueUpdated();

      const formData = new FormData();
      const file = new File([item.fileBlob], item.fileName, { type: item.fileType });
      formData.append('file', file);
      formData.append('client_upload_id', item.id);
      formData.append('page_index', String(item.pageIndex));
      formData.append('async', 'true');

      try {
        await uploadSingleCaller(item.projectId, formData, (pct) => {
          item.progress = pct;
          notifyQueueUpdated();
        });

        // Mark completed and remove from queue
        item.status = 'completed';
        item.progress = 100;
        const txDone = db.transaction(STORE_NAME, 'readwrite');
        txDone.objectStore(STORE_NAME).delete(item.id);
        await new Promise<void>((r) => { txDone.oncomplete = () => r(); });

        processed++;
        if (options.onItemCompleted) options.onItemCompleted(item);
        notifyQueueUpdated();
        return true;
      } catch (err: any) {
        failed++;
        item.retryCount += 1;
        item.status = item.retryCount >= maxRetries ? 'failed' : 'pending';
        item.error = err.message || 'Upload failed';
        item.progress = 0;

        const txErr = db.transaction(STORE_NAME, 'readwrite');
        txErr.objectStore(STORE_NAME).put(item);
        await new Promise<void>((r) => { txErr.oncomplete = () => r(); });
        notifyQueueUpdated();
        return false;
      }
    }

    // Run with bounded concurrency pool
    const queue = [...pendingItems];
    const workers: Promise<void>[] = [];

    async function runNext(): Promise<void> {
      while (queue.length > 0) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) break;
        const item = queue.shift();
        if (item) {
          await uploadWorker(item);
        }
      }
    }

    for (let w = 0; w < Math.min(maxConcurrency, queue.length); w++) {
      workers.push(runNext());
    }

    await Promise.all(workers);
  } finally {
    isProcessingQueue = false;
  }

  return { processed, failed };
}

// UI event notification
function notifyQueueUpdated() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('log2def-upload-queue-updated'));
  }
}

// Background Sync Registration
export async function registerBackgroundSync() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    if ('sync' in registration) {
      await (registration as any).sync.register('sync-logbook-uploads');
    }
  } catch {
    // Progressive enhancement
  }
}
