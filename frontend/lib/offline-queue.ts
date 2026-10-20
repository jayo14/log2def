// Log2Def IndexedDB Offline Upload Queue & Background Sync Manager

export interface QueuedUpload {
  id: string;
  projectId: number | string;
  fileName: string;
  fileType: string;
  fileSize: number;
  fileBlob: Blob;
  status: 'pending' | 'uploading' | 'failed' | 'completed';
  createdAt: number;
  retryCount: number;
  error?: string;
}

const DB_NAME = 'Log2DefUploadsDB';
const STORE_NAME = 'upload_queue';
const DB_VERSION = 1;

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
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

// 1. Enqueue bulk files into IndexedDB
export async function enqueueUploads(
  projectId: number | string,
  files: File[]
): Promise<QueuedUpload[]> {
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);

  const queuedList: QueuedUpload[] = [];
  const now = Date.now();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const item: QueuedUpload = {
      id: `${projectId}_${now}_${i}_${Math.random().toString(36).substring(2, 7)}`,
      projectId,
      fileName: file.name,
      fileType: file.type || 'application/octet-stream',
      fileSize: file.size,
      fileBlob: file,
      status: 'pending',
      createdAt: now,
      retryCount: 0,
    };
    store.put(item);
    queuedList.push(item);
  }

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  notifyQueueUpdated();
  registerBackgroundSync();

  return queuedList;
}

// 2. Retrieve queued uploads for project
export async function getQueuedUploads(
  projectId?: number | string
): Promise<QueuedUpload[]> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    const request = store.getAll();
    const items = await new Promise<QueuedUpload[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    if (projectId) {
      return items.filter((item) => String(item.projectId) === String(projectId));
    }
    return items;
  } catch {
    return [];
  }
}

// 3. Remove single upload item from queue
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

// 4. Clear all completed or all items for project
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

// 5. Process queue (send up to 30 files in bulk per batch)
let isProcessingQueue = false;

export async function processUploadQueue(
  uploadEndpointCaller: (projectId: number | string, formData: FormData) => Promise<any>,
  projectId?: number | string,
  onBatchUploaded?: (count: number) => void
): Promise<{ processed: number; failed: number }> {
  if (isProcessingQueue) return { processed: 0, failed: 0 };
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { processed: 0, failed: 0 };
  }

  isProcessingQueue = true;
  let processed = 0;
  let failed = 0;

  try {
    const allQueued = await getQueuedUploads(projectId);
    const pendingItems = allQueued.filter((i) => i.status === 'pending' || i.status === 'failed');

    if (pendingItems.length === 0) {
      isProcessingQueue = false;
      return { processed: 0, failed: 0 };
    }

    // Group items by projectId
    const byProject: Record<string, QueuedUpload[]> = {};
    for (const item of pendingItems) {
      const pId = String(item.projectId);
      if (!byProject[pId]) byProject[pId] = [];
      byProject[pId].push(item);
    }

    const db = await getDB();

    for (const pId of Object.keys(byProject)) {
      const items = byProject[pId];
      // Process in batches of up to 30
      while (items.length > 0) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) break;

        const batch = items.splice(0, 30);
        const batchIds = batch.map((b) => b.id);

        // Mark as uploading in DB
        const txMark = db.transaction(STORE_NAME, 'readwrite');
        const storeMark = txMark.objectStore(STORE_NAME);
        for (const item of batch) {
          item.status = 'uploading';
          storeMark.put(item);
        }
        await new Promise<void>((r) => { txMark.oncomplete = () => r(); });
        notifyQueueUpdated();

        // Build FormData
        const formData = new FormData();
        for (const item of batch) {
          const file = new File([item.fileBlob], item.fileName, { type: item.fileType });
          formData.append('files', file);
        }
        formData.append('file', new File([batch[0].fileBlob], batch[0].fileName, { type: batch[0].fileType }));

        try {
          await uploadEndpointCaller(pId, formData);

          // Success: delete from DB
          const txDel = db.transaction(STORE_NAME, 'readwrite');
          const storeDel = txDel.objectStore(STORE_NAME);
          for (const id of batchIds) {
            storeDel.delete(id);
          }
          await new Promise<void>((r) => { txDel.oncomplete = () => r(); });

          processed += batch.length;
          if (onBatchUploaded) onBatchUploaded(batch.length);
        } catch (err: any) {
          failed += batch.length;
          // Failed: revert status to pending or mark with error
          const txRev = db.transaction(STORE_NAME, 'readwrite');
          const storeRev = txRev.objectStore(STORE_NAME);
          for (const item of batch) {
            item.status = 'pending';
            item.retryCount = (item.retryCount || 0) + 1;
            item.error = err.message || 'Upload failed';
            storeRev.put(item);
          }
          await new Promise<void>((r) => { txRev.oncomplete = () => r(); });
          // Stop processing further batches if network went down
          if (!navigator.onLine || err.message?.includes('network') || err.message?.includes('Failed to fetch')) {
            break;
          }
        }
        notifyQueueUpdated();
      }
    }
  } finally {
    isProcessingQueue = false;
  }

  return { processed, failed };
}

// 6. UI event notification
function notifyQueueUpdated() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('log2def-upload-queue-updated'));
  }
}

// 7. Background Sync Registration with Service Worker
export async function registerBackgroundSync() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    if ('sync' in registration) {
      await (registration as any).sync.register('sync-logbook-uploads');
    }
  } catch {
    // Background Sync is progressive enhancement; fallback to window 'online' event
  }
}
