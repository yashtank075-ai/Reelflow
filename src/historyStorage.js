export const HISTORY_STORAGE_KEY = 'reelflow_recent_downloads';
export const MAX_HISTORY_ENTRIES = 20;

export function loadStoredHistory() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(item => item && typeof item === 'object' && typeof item.id === 'string' && typeof item.timestamp === 'number')
      .slice(0, MAX_HISTORY_ENTRIES);
  } catch (err) {
    console.warn('Could not read download history from storage:', err);
    return [];
  }
}

export function persistHistory(entries) {
  if (typeof window === 'undefined' || !window.localStorage) return false;

  if (!entries || !Array.isArray(entries) || entries.length === 0) {
    try {
      window.localStorage.removeItem(HISTORY_STORAGE_KEY);
      return true;
    } catch (err) {
      console.warn('Could not clear download history from storage:', err.message);
      return false;
    }
  }

  let currentList = entries.slice(0, MAX_HISTORY_ENTRIES);
  while (currentList.length > 0) {
    try {
      window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(currentList));
      return true; // Successfully saved
    } catch (err) {
      const isQuotaError = 
        err.name === 'QuotaExceededError' || 
        err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || 
        err.code === 22 || 
        err.code === 1014;

      if (isQuotaError && currentList.length > 1) {
        // Evict the oldest entry and retry
        currentList = currentList.slice(0, currentList.length - 1);
      } else {
        console.warn('Could not persist download history (storage full or restricted):', err.message);
        return false;
      }
    }
  }
  return false;
}

export function clearStoredHistory() {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    window.localStorage.removeItem(HISTORY_STORAGE_KEY);
    return true;
  } catch (err) {
    console.warn('Could not clear download history from storage:', err.message);
    return false;
  }
}
