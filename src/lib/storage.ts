import { openDB, type DBSchema } from 'idb';
import { cloneMapRecord } from './mapCodec';
import type { StoredMap } from './types';

interface WodEditorDb extends DBSchema {
  maps: {
    key: string;
    value: StoredMap;
  };
}

const DB_NAME = 'wod-map-editor';
const STORE_NAME = 'maps';

const dbPromise = openDB<WodEditorDb>(DB_NAME, 1, {
  upgrade(database) {
    if (!database.objectStoreNames.contains(STORE_NAME)) {
      database.createObjectStore(STORE_NAME, { keyPath: 'id' });
    }
  },
});

export const mapStore = {
  async list() {
    const database = await dbPromise;
    const maps = await database.getAll(STORE_NAME);
    return maps.map(cloneMapRecord).sort((left, right) => right.updatedAt - left.updatedAt);
  },

  async get(id: string) {
    const database = await dbPromise;
    const map = await database.get(STORE_NAME, id);
    return map ? cloneMapRecord(map) : undefined;
  },

  async put(map: StoredMap) {
    const database = await dbPromise;
    const nextMap = cloneMapRecord({
      ...map,
      createdAt: map.createdAt || Date.now(),
      updatedAt: Date.now(),
    });
    await database.put(STORE_NAME, nextMap);
    return nextMap;
  },

  async remove(id: string) {
    const database = await dbPromise;
    await database.delete(STORE_NAME, id);
  },
};