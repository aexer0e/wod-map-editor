import { useState } from 'react';
import { CANVAS_HEIGHT, CANVAS_WIDTH, TEAM_ACCENTS, teamColorForIndex } from '../lib/constants';
import { modeLabel, formatUpdatedAt, teamsForMode } from '../lib/mapCodec';
import type { StoredMap } from '../lib/types';
import { uiAssets } from '../lib/assets';

interface MapLibraryProps {
  maps: StoredMap[];
  loading: boolean;
  onCreate: () => void;
  onImport: () => void;
  onEdit: (mapId: string) => void;
  onDownload: (map: StoredMap) => void;
  onRename: (map: StoredMap) => Promise<void>;
  onDelete: (map: StoredMap) => void;
}

function thumbnailCoordinateX(x: number) {
  return Math.max(0, Math.min(100, (x / CANVAS_WIDTH) * 100));
}

function thumbnailCoordinateY(y: number) {
  return Math.max(0, Math.min(100, (y / CANVAS_HEIGHT) * 100));
}

function esc(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function thumbnailFor(map: StoredMap) {
  const terrainSource = map.data.map_surface ? `data:image/png;base64,${map.data.map_surface}` : uiAssets.logo;
  const teamCount = teamsForMode(map.data.mode);
  const capitalIndexes = new Set(map.data.capitals);
  const overlays: string[] = [];

  map.data.infantry.forEach((team, teamIndex) => {
    const teamColor = teamColorForIndex(teamIndex, teamCount);
    const fill = TEAM_ACCENTS[teamColor];
    team.forEach(([x, y]) => {
      overlays.push(
        `<circle cx="${thumbnailCoordinateX(x)}" cy="${thumbnailCoordinateY(y)}" r="1.45" fill="${fill}" stroke="rgba(7,10,12,0.85)" stroke-width="0.4" />`,
      );
    });
  });

  map.data.tanks.forEach((team, teamIndex) => {
    const teamColor = teamColorForIndex(teamIndex, teamCount);
    const fill = TEAM_ACCENTS[teamColor];
    team.forEach(([x, y]) => {
      const cx = thumbnailCoordinateX(x);
      const cy = thumbnailCoordinateY(y);
      overlays.push(
        `<rect x="${cx - 1.9}" y="${cy - 1.35}" width="3.8" height="2.7" rx="0.7" fill="${fill}" stroke="rgba(7,10,12,0.85)" stroke-width="0.4" />`,
      );
      overlays.push(
        `<rect x="${cx - 0.45}" y="${cy - 2.2}" width="0.9" height="1.5" rx="0.3" fill="${fill}" stroke="rgba(7,10,12,0.7)" stroke-width="0.25" />`,
      );
    });
  });

  map.data.cities.forEach(([x, y], cityIndex) => {
    const cx = thumbnailCoordinateX(x);
    const cy = thumbnailCoordinateY(y);
    const isCapital = capitalIndexes.has(cityIndex);
    const radius = isCapital ? 2.15 : 1.8;
    overlays.push(
      `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="#fcde00" stroke="rgba(82,55,0,0.9)" stroke-width="0.5" />`,
    );
    if (isCapital) {
      overlays.push(`<circle cx="${cx}" cy="${cy}" r="0.8" fill="#fff6b4" />`);
    }
  });

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">
      <image href="${esc(terrainSource)}" width="100" height="100" preserveAspectRatio="none" />
      <rect width="100" height="100" fill="rgba(4, 8, 10, 0.08)" />
      ${overlays.join('')}
    </svg>
  `;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function ActionIcon({ kind }: { kind: 'edit' | 'download' | 'delete' }) {
  if (kind === 'edit') {
    return (
      <svg aria-hidden="true" className="library-action-icon" viewBox="0 0 24 24">
        <path d="M4 16.8V20h3.2L18 9.2 14.8 6 4 16.8Z" fill="currentColor" />
        <path d="m13.9 6.9 3.2 3.2" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  }

  if (kind === 'download') {
    return (
      <svg aria-hidden="true" className="library-action-icon" viewBox="0 0 24 24">
        <path d="M12 4v10" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
        <path d="m8 11 4 4 4-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
        <path d="M5 19h14" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className="library-action-icon" viewBox="0 0 24 24">
      <path d="M6 7h12" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
      <path d="M9 7V5h6v2" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
      <path d="M8 9v9m4-9v9m4-9v9" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
      <path d="M7 19h10" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}

export function MapLibrary({
  maps,
  loading,
  onCreate,
  onImport,
  onEdit,
  onDownload,
  onRename,
  onDelete,
}: MapLibraryProps) {
  const [editingMapId, setEditingMapId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  function beginRename(map: StoredMap) {
    setEditingMapId(map.id);
    setRenameValue(map.name);
  }

  async function commitRename(map: StoredMap) {
    const nextName = renameValue.trim();
    setEditingMapId(null);
    if (!nextName || nextName === map.name) {
      return;
    }
    await onRename({ ...map, name: nextName });
  }

  return (
    <section className="library-shell">
      <div className="library-toolbar">
        <div className="library-toolbar-copy">
          <h2>Your Maps</h2>
        </div>
        <div className="library-toolbar-actions">
          <button className="primary-button" type="button" onClick={onCreate}>
            New Map
          </button>
          <button className="secondary-button" type="button" onClick={onImport}>
            Import Map
          </button>
        </div>
      </div>

      {loading ? (
        <div className="empty-state compact">
          <div className="loading-pulse" />
          <p>Loading local maps...</p>
        </div>
      ) : maps.length === 0 ? (
        <div className="empty-state">
          <img alt="WoD Map Editor logo" src={uiAssets.logo} />
          <h3>No maps saved yet</h3>
          <p>Create a map or import one to get started.</p>
        </div>
      ) : (
        <div className="map-grid">
          {maps.map((map) => {
            const isEditingName = editingMapId === map.id;

            return (
              <article className="map-card" key={map.id}>
                <button className="map-thumb" type="button" onClick={() => onEdit(map.id)}>
                  <img alt={`${map.name} preview`} src={thumbnailFor(map)} />
                  <span className="map-mode-pill">{modeLabel(map.data.mode)}</span>
                </button>
                <div className="map-card-body">
                  <div className="map-card-head">
                    <div className="map-title-slot">
                      {isEditingName ? (
                        <input
                          autoFocus
                          className="map-title-input"
                          type="text"
                          value={renameValue}
                          onBlur={() => void commitRename(map)}
                          onChange={(event) => setRenameValue(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              void commitRename(map);
                            }
                            if (event.key === 'Escape') {
                              setEditingMapId(null);
                              setRenameValue('');
                            }
                          }}
                        />
                      ) : (
                        <button className="map-title-button" type="button" onClick={() => beginRename(map)}>
                          <h4>{map.name}</h4>
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="map-card-updated">Updated {formatUpdatedAt(map.updatedAt)}</p>
                  <div className="map-card-actions map-card-actions-wide">
                    <button className="card-icon-button" title="Edit map" type="button" onClick={() => onEdit(map.id)}>
                      <ActionIcon kind="edit" />
                    </button>
                    <button className="card-icon-button" title="Download bundle" type="button" onClick={() => onDownload(map)}>
                      <ActionIcon kind="download" />
                    </button>
                    <button className="card-icon-button danger" title="Delete map" type="button" onClick={() => onDelete(map)}>
                      <ActionIcon kind="delete" />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}