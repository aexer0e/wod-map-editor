// IndexedDB storage for maps
const Store = (() => {
  const DB_NAME = 'wod-map-editor';
  const DB_VER = 1;
  const STORE = 'maps';
  let _db;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(mode) {
    return open().then(db => db.transaction(STORE, mode).objectStore(STORE));
  }

  function promisify(req) {
    return new Promise((res, rej) => {
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  return {
    async list() {
      const s = await tx('readonly');
      const items = await promisify(s.getAll());
      return items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },
    async get(id) {
      const s = await tx('readonly');
      return promisify(s.get(id));
    },
    async put(map) {
      map.updatedAt = Date.now();
      if (!map.createdAt) map.createdAt = map.updatedAt;
      const s = await tx('readwrite');
      await promisify(s.put(map));
      return map;
    },
    async remove(id) {
      const s = await tx('readwrite');
      return promisify(s.delete(id));
    },
  };
})();
