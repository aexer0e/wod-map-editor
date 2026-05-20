import { startTransition, useEffect, useState } from 'react';
import { EditorScreen } from './components/EditorScreen';
import { MapLibrary } from './components/MapLibrary';
import { uiAssets } from './lib/assets';
import { createMapRecord, downloadMapFile, mapSurfaceFromImageFile, readCompressedMap } from './lib/mapCodec';
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

interface ImportDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: (textFile: File, imageFile: File) => Promise<void>;
}

function ImportDialog({ open, onCancel, onConfirm }: ImportDialogProps) {
  const [textFile, setTextFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTextFile(null);
      setImageFile(null);
      setSubmitting(false);
      setError(null);
    }
  }, [open]);

  if (!open) {
    return null;
  }

  async function handleSubmit() {
    if (!textFile || !imageFile || submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(textFile, imageFile);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to import the selected files.');
      setSubmitting(false);
    }
  }

  return (
    <div className="dialog-scrim" role="presentation">
      <div aria-modal="true" className="dialog-card import-dialog" role="dialog">
        <p className="eyebrow">Import map</p>
        <h3>Upload both files</h3>
        <p>Choose the exported map TXT file and the matching PNG terrain image, then import them together.</p>

        <div className="import-grid">
          <label className={`upload-zone ${textFile ? 'filled' : ''}`}>
            <input
              accept=".txt,.gz"
              className="visually-hidden"
              type="file"
              onChange={(event) => setTextFile(event.target.files?.[0] ?? null)}
            />
            <strong>Map TXT</strong>
            <span>{textFile ? textFile.name : 'Click to choose the .txt export'}</span>
          </label>

          <label className={`upload-zone ${imageFile ? 'filled' : ''}`}>
            <input
              accept="image/png"
              className="visually-hidden"
              type="file"
              onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
            />
            <strong>Terrain PNG</strong>
            <span>{imageFile ? imageFile.name : 'Click to choose the .png image'}</span>
          </label>
        </div>

        {error && <p className="dialog-error">{error}</p>}

        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary-button" disabled={!textFile || !imageFile || submitting} type="button" onClick={() => void handleSubmit()}>
            {submitting ? 'Importing...' : 'Import map'}
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
  const [promptMode, setPromptMode] = useState<'create' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StoredMap | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

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

  async function handleDeleteMap() {
    if (!deleteTarget) {
      return;
    }

    await mapStore.remove(deleteTarget.id);
    setMaps((current) => removeMap(current, deleteTarget.id));
    setDeleteTarget(null);
  }

  async function handleImport(textFile: File, imageFile: File) {
    const importedData = await readCompressedMap(textFile);
    const importedSurface = await mapSurfaceFromImageFile(imageFile);
    const name = textFile.name.replace(/\.(txt|gz)$/i, '') || 'Imported map';
    const imported = await mapStore.put({
      ...createMapRecord(name),
      data: {
        ...importedData,
        map_surface: importedSurface || importedData.map_surface,
      },
    });
    setMaps((current) => upsertMap(current, imported));
    setImportDialogOpen(false);
    setScreen({ kind: 'editor', mapId: imported.id });
  }

  const activeMap = screen.kind === 'editor' ? maps.find((map) => map.id === screen.mapId) : undefined;

  return (
    <div className="app-shell">
      {screen.kind !== 'editor' && (
        <header className="app-header">
          <div className="brand-block">
            <img alt="WoD Map Editor icon" src={uiAssets.appIcon} />
            <div>
              <h1>WoD Map Editor</h1>
            </div>
          </div>
        </header>
      )}

      <main className="app-main">
        {screen.kind === 'library' && (
          <MapLibrary
            loading={loading}
            maps={maps}
            onCreate={() => setPromptMode('create')}
            onDelete={(map) => setDeleteTarget(map)}
            onDownload={downloadMapFile}
            onEdit={(mapId) => setScreen({ kind: 'editor', mapId })}
            onImport={() => setImportDialogOpen(true)}
            onRename={async (map) => {
              const renamed = await mapStore.put(map);
              setMaps((current) => upsertMap(current, renamed));
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
        confirmLabel="Create map"
        initialValue="Untitled map"
        open={promptMode !== null}
        subtitle="Give the new battlefield a working name."
        title="Create a new map"
        onCancel={() => setPromptMode(null)}
        onConfirm={(value) => void handleCreateMap(value)}
      />

      <ConfirmDialog
        description={deleteTarget ? `Delete "${deleteTarget.name}" from local storage? This cannot be undone.` : ''}
        open={deleteTarget !== null}
        title="Delete this map?"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDeleteMap()}
      />

      <ImportDialog
        open={importDialogOpen}
        onCancel={() => setImportDialogOpen(false)}
        onConfirm={handleImport}
      />
    </div>
  );
}