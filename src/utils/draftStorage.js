/**
 * IndexedDB draft storage utility for Parallel Paths.
 * Efficiently persists form fields and image Blobs locally without localStorage size limits.
 */

const DB_NAME = 'ParallelPathsDraftDB';
const DB_VERSION = 1;
const STORE_NAME = 'project_drafts';

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported in this environment'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onerror = (event) => {
      reject(event.target.error || new Error('Failed to open IndexedDB'));
    };
  });
}

/**
 * Save draft data to IndexedDB.
 * @param {string} id - Draft identifier (e.g. 'project_draft_new' or 'project_draft_edit_123')
 * @param {object} draftData - Form data and Blobs
 */
export async function saveDraft(id, draftData) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      const record = {
        id,
        formData: draftData.formData || {},
        featuredImage: draftData.featuredImage || null,
        additionalImages: draftData.additionalImages || [],
        savedAt: Date.now()
      };

      const request = store.put(record);

      request.onsuccess = () => resolve(true);
      request.onerror = (e) => reject(e.target.error);
    });
  } catch (error) {
    console.warn('[draftStorage] Failed to save draft:', error);
    return false;
  }
}

/**
 * Retrieve draft data from IndexedDB.
 * @param {string} id - Draft identifier
 * @returns {Promise<object|null>}
 */
export async function getDraft(id) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = (e) => {
        resolve(e.target.result || null);
      };

      request.onerror = (e) => {
        reject(e.target.error);
      };
    });
  } catch (error) {
    console.warn('[draftStorage] Failed to retrieve draft:', error);
    return null;
  }
}

/**
 * Delete draft from IndexedDB.
 * @param {string} id - Draft identifier
 */
export async function clearDraft(id) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve(true);
      request.onerror = (e) => reject(e.target.error);
    });
  } catch (error) {
    console.warn('[draftStorage] Failed to clear draft:', error);
    return false;
  }
}

/**
 * Check whether a valid non-empty draft exists for the given ID.
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function hasDraft(id) {
  try {
    const draft = await getDraft(id);
    if (!draft) return false;

    // Check if there is any meaningful text content
    const hasText = Object.values(draft.formData || {}).some(
      (val) => typeof val === 'string' && val.trim().length > 0
    );

    // Check if there are any images
    const hasFeatured = !!(draft.featuredImage && (draft.featuredImage.blob || draft.featuredImage.existingUrl));
    const hasAdditional = Array.isArray(draft.additionalImages) && draft.additionalImages.length > 0;

    return hasText || hasFeatured || hasAdditional;
  } catch {
    return false;
  }
}
