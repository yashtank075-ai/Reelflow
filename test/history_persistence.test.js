import test from 'node:test';
import assert from 'node:assert/strict';

// Import history constants and storage logic directly from App.jsx
import {
  HISTORY_STORAGE_KEY,
  MAX_HISTORY_ENTRIES,
  loadStoredHistory,
  persistHistory,
  clearStoredHistory
} from '../src/historyStorage.js';

function createMockLocalStorage(initialStore = {}) {
  const store = new Map(Object.entries(initialStore));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    get _store() {
      return Object.fromEntries(store.entries());
    }
  };
}

test('History Storage: Exact localStorage key verification', () => {
  assert.equal(HISTORY_STORAGE_KEY, 'reelflow_recent_downloads');
  assert.equal(MAX_HISTORY_ENTRIES, 20);
});

test('Regression: Clear all history, then reload: history remains empty', () => {
  const initialItems = [
    { id: '1', provider: 'instagram', title: 'Reel 1', timestamp: 1000 },
    { id: '2', provider: 'facebook', title: 'Video 2', timestamp: 2000 }
  ];

  const mockStorage = createMockLocalStorage({
    [HISTORY_STORAGE_KEY]: JSON.stringify(initialItems)
  });

  globalThis.window = { localStorage: mockStorage };

  // Verify loaded
  const beforeClear = loadStoredHistory();
  assert.equal(beforeClear.length, 2);

  // User clears history
  const cleared = clearStoredHistory();
  assert.equal(cleared, true);

  // Check persisted storage directly
  assert.equal(mockStorage.getItem(HISTORY_STORAGE_KEY), null);

  // Simulate page reload (re-reading from storage)
  const afterReload = loadStoredHistory();
  assert.deepEqual(afterReload, []);
});

test('Regression: Add a new history item, then reload: the new item remains', () => {
  const mockStorage = createMockLocalStorage();
  globalThis.window = { localStorage: mockStorage };

  const newItem = {
    id: 'item-101',
    provider: 'instagram',
    title: 'Fresh Downloaded Reel',
    quality: 'Original / Best',
    timestamp: Date.now(),
    status: 'started'
  };

  const saved = persistHistory([newItem]);
  assert.equal(saved, true);

  // Simulate reload
  const loadedAfterReload = loadStoredHistory();
  assert.equal(loadedAfterReload.length, 1);
  assert.equal(loadedAfterReload[0].id, 'item-101');
  assert.equal(loadedAfterReload[0].title, 'Fresh Downloaded Reel');
});

test('Regression: Delete one item, then reload: the deleted item does not return', () => {
  const item1 = { id: 'entry-1', provider: 'instagram', title: 'Post 1', timestamp: 1000 };
  const item2 = { id: 'entry-2', provider: 'facebook', title: 'Post 2', timestamp: 2000 };
  const item3 = { id: 'entry-3', provider: 'instagram', title: 'Post 3', timestamp: 3000 };

  const mockStorage = createMockLocalStorage({
    [HISTORY_STORAGE_KEY]: JSON.stringify([item1, item2, item3])
  });
  globalThis.window = { localStorage: mockStorage };

  // Remove item2
  const currentList = loadStoredHistory();
  const updatedList = currentList.filter(item => item.id !== 'entry-2');
  persistHistory(updatedList);

  // Simulate page reload
  const reloaded = loadStoredHistory();
  assert.equal(reloaded.length, 2);
  assert.equal(reloaded.some(item => item.id === 'entry-2'), false);
  assert.equal(reloaded[0].id, 'entry-1');
  assert.equal(reloaded[1].id, 'entry-3');
});

test('Regression: Clear history followed by a delayed state update: old records are not restored', () => {
  const staleSnapshot = [
    { id: 'stale-1', provider: 'instagram', title: 'Old Reel', timestamp: 500 }
  ];

  const mockStorage = createMockLocalStorage({
    [HISTORY_STORAGE_KEY]: JSON.stringify(staleSnapshot)
  });
  globalThis.window = { localStorage: mockStorage };

  // User clicks "Clear History"
  clearStoredHistory();
  assert.equal(mockStorage.getItem(HISTORY_STORAGE_KEY), null);

  // Simulate a delayed/background action attempting to persist an empty list or checking storage
  persistHistory([]);
  assert.equal(mockStorage.getItem(HISTORY_STORAGE_KEY), null);

  // Simulate reload
  const reloaded = loadStoredHistory();
  assert.deepEqual(reloaded, []);
});

test('History Storage: persistHistory cleans storage when passed empty array', () => {
  const mockStorage = createMockLocalStorage({
    [HISTORY_STORAGE_KEY]: JSON.stringify([{ id: '1', timestamp: 100 }])
  });
  globalThis.window = { localStorage: mockStorage };

  persistHistory([]);
  assert.equal(mockStorage.getItem(HISTORY_STORAGE_KEY), null);
  assert.deepEqual(loadStoredHistory(), []);
});

test('History Storage: Graceful degradation with missing or throwing localStorage', () => {
  // Case 1: localStorage is undefined
  globalThis.window = {};
  assert.deepEqual(loadStoredHistory(), []);
  assert.equal(persistHistory([{ id: 'test', timestamp: 1 }]), false);
  assert.equal(clearStoredHistory(), false);

  // Case 2: localStorage throws on access
  globalThis.window = {
    localStorage: {
      getItem() { throw new Error('SecurityError: Access is denied'); },
      setItem() { throw new Error('QuotaExceededError'); },
      removeItem() { throw new Error('SecurityError'); }
    }
  };
  assert.deepEqual(loadStoredHistory(), []);
  assert.equal(persistHistory([{ id: 'test', timestamp: 1 }]), false);
  assert.equal(clearStoredHistory(), false);
});
