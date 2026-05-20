import { startTransition, useEffect, useState } from 'react';
import { EditorScreen } from './components/EditorScreen';
import { MapLibrary } from './components/MapLibrary';
import { uiAssets } from './lib/assets';
import { createMapRecord, downloadMapFile, readCompressedMap } from './lib/mapCodec';
import { mapStore } from './lib/storage';
import type { StoredMap } from './lib/types';

type Screen =
  | { kind: 'library' }
  | { kind: 'editor'; mapId: string };

function upsertMap(collection: StoredMap[], nextMap: StoredMap) {
  return [nextMap, ...collection.filter((map) => map.id !== nextMap.id)].sort((left, right) => right.updatedAt - left.updatedAt);
}

function removeMap(collection: StoredMap[], mapId: string) {
  return collection.filter((map) => map.id !== mapId);
}

interface PromptDialogProps {
  confirmLabel: string;
  initialValue: string;
  open: boolean;
  subtitle: string;
  title: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}

function PromptDialog({
  confirmLabel,
  initialValue,
  open,
  subtitle,
  title,
  onCancel,
  onConfirm,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="dialog-scrim" role="presentation">
      <div aria-modal="true" className="dialog-card" role="dialog">
        <p className="eyebrow">Map details</p>
        <h3>{title}</h3>
        <p>{subtitle}</p>
        <input
          autoFocus
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              onConfirm(value.trim());
            }
          }}
        />
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary-button" type="button" onClick={() => onConfirm(value.trim())}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  description: string;
  open: boolean;
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
}

function ConfirmDialog({ description, open, title, onCancel, onConfirm }: ConfirmDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="dialog-scrim" role="presentation">
      <div aria-modal="true" className="dialog-card" role="dialog">
        <p className="eyebrow">Confirm action</p>
        <h3>{title}</h3>
        <p>{description}</p>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="danger-button" type="button" onClick={onConfirm}>
            Delete map
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [maps, setMaps] = useState<StoredMap[]>([]);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<Screen>({ kind: 'library' });
  const [promptMode, setPromptMode] = useState<'create' | 'rename' | null>(null);
  const [renameTarget, setRenameTarget] = useState<StoredMap | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StoredMap | null>(null);

  useEffect(() => {
    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.createElement('link');
    favicon.rel = 'icon';
    favicon.href = uiAssets.appIcon;
    document.head.appendChild(favicon);
  }, []);

  useEffect(() => {
    document.body.dataset.screen = screen.kind;
    return () => {
      delete document.body.dataset.screen;
    };
  }, [screen.kind]);

  useEffect(() => {
    void loadMaps();
  }, []);

  async function loadMaps() {
    setLoading(true);
    try {
      const nextMaps = await mapStore.list();
      startTransition(() => {
        setMaps(nextMaps);
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateMap(name: string) {
    if (!name) {
      setPromptMode(null);
      return;
    }

    const created = await mapStore.put(createMapRecord(name));
    setMaps((current) => upsertMap(current, created));
    setPromptMode(null);
    setScreen({ kind: 'editor', mapId: created.id });
  }

  async function handleRenameMap(name: string) {
    if (!renameTarget) {
      return;
    }

    if (!name) {
      setRenameTarget(null);
      setPromptMode(null);
      return;
    }

    const renamed = await mapStore.put({ ...renameTarget, name });
    setMaps((current) => upsertMap(current, renamed));
    setRenameTarget(null);
    setPromptMode(null);
  }

  async function handleDeleteMap() {
    if (!deleteTarget) {
      return;
    }

    await mapStore.remove(deleteTarget.id);
    setMaps((current) => removeMap(current, deleteTarget.id));
    setDeleteTarget(null);
  }

  async function handleImport(file: File) {
    const importedData = await readCompressedMap(file);
    const name = file.name.replace(/\.(txt|gz)$/i, '') || 'Imported map';
    const imported = await mapStore.put({
      ...createMapRecord(name),
      data: importedData,
    });
    setMaps((current) => upsertMap(current, imported));
  }

  const activeMap = screen.kind === 'editor' ? maps.find((map) => map.id === screen.mapId) : undefined;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <img alt="WoD Map Editor icon" src={uiAssets.appIcon} />
          <div>
            <p className="eyebrow">War of Dots map workflow</p>
            <h1>WoD Map Editor</h1>
          </div>
        </div>
        <div className="header-note">
          <span>Prototype rebuilt for stronger state handling, faster terrain input, and a clearer editor flow.</span>
        </div>
      </header>

      <main className="app-main">
        {screen.kind === 'library' && (
          <MapLibrary
            loading={loading}
            maps={maps}
            onCreate={() => {
              setPromptMode('create');
              setRenameTarget(null);
            }}
            onDelete={(map) => setDeleteTarget(map)}
            onDownload={downloadMapFile}
            onEdit={(mapId) => setScreen({ kind: 'editor', mapId })}
            onImport={handleImport}
            onRename={(map) => {
              setRenameTarget(map);
              setPromptMode('rename');
            }}
          />
        )}

        {screen.kind === 'editor' && activeMap && (
          <EditorScreen
            initialMap={activeMap}
            saveMap={mapStore.put}
            onClose={(savedMap) => {
              setMaps((current) => upsertMap(current, savedMap));
              setScreen({ kind: 'library' });
            }}
          />
        )}
      </main>

      <PromptDialog
        confirmLabel={promptMode === 'rename' ? 'Rename map' : 'Create map'}
        initialValue={promptMode === 'rename' && renameTarget ? renameTarget.name : 'Untitled map'}
        open={promptMode !== null}
        subtitle={promptMode === 'rename' ? 'Pick a clearer label for this battlefield.' : 'Give the new battlefield a working name.'}
        title={promptMode === 'rename' ? 'Rename map' : 'Create a new map'}
        onCancel={() => {
          setPromptMode(null);
          setRenameTarget(null);
        }}
        onConfirm={(value) => {
          if (promptMode === 'rename') {
            void handleRenameMap(value);
            return;
          }
          void handleCreateMap(value);
        }}
      />

      <ConfirmDialog
        description={deleteTarget ? `Delete "${deleteTarget.name}" from local storage? This cannot be undone.` : ''}
        open={deleteTarget !== null}
        title="Delete this map?"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDeleteMap()}
      />
    </div>
  );
}