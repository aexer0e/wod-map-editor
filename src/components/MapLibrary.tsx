import { useState } from 'react';
import { CANVAS_HEIGHT, CANVAS_WIDTH, CAPITAL_SIZE, CITY_SIZE, SPRITE_SIZE, teamColorForIndex } from '../lib/constants';
import { modeLabel, formatUpdatedAt, teamsForMode } from '../lib/mapCodec';
import type { StoredMap } from '../lib/types';
import { spriteAssets, uiAssets } from '../lib/assets';

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
  return Math.max(0, Math.min(CANVAS_WIDTH, x));
}

function thumbnailCoordinateY(y: number) {
  return Math.max(0, Math.min(CANVAS_HEIGHT, y));
}

function thumbnailPercentX(x: number) {
  return (thumbnailCoordinateX(x) / CANVAS_WIDTH) * 100;
}

function thumbnailPercentY(y: number) {
  return (thumbnailCoordinateY(y) / CANVAS_HEIGHT) * 100;
}

function thumbnailPercentWidth(size: number) {
  return (size / CANVAS_WIDTH) * 100;
}

function thumbnailPercentHeight(size: number) {
  return (size / CANVAS_HEIGHT) * 100;
}

function MapThumbnail({ map }: { map: StoredMap }) {
  const terrainSource = map.data.map_surface ? `data:image/png;base64,${map.data.map_surface}` : uiAssets.logo;
  const teamCount = teamsForMode(map.data.mode);
  const capitalIndexes = new Set(map.data.capitals);

  return (
    <span className="map-thumb-frame">
      <span className="map-thumb-stage">
        <img alt={`${map.name} preview`} className="map-thumb-terrain" draggable={false} src={terrainSource} />
        <span aria-hidden="true" className="map-thumb-shade" />
        <span aria-hidden="true" className="map-thumb-overlay">
          {map.data.infantry.flatMap((team, teamIndex) => {
            const teamColor = teamColorForIndex(teamIndex, teamCount);
            const sprite = spriteAssets[teamColor].infantry;
            return team.map(([x, y], unitIndex) => (
              <img
                alt=""
                className="map-thumb-sprite"
                draggable={false}
                key={`infantry-${teamIndex}-${unitIndex}`}
                src={sprite}
                style={{
                  height: `${thumbnailPercentHeight(SPRITE_SIZE)}%`,
                  left: `${thumbnailPercentX(x)}%`,
                  top: `${thumbnailPercentY(y)}%`,
                  width: `${thumbnailPercentWidth(SPRITE_SIZE)}%`,
                }}
              />
            ));
          })}
          {map.data.tanks.flatMap((team, teamIndex) => {
            const teamColor = teamColorForIndex(teamIndex, teamCount);
            const sprite = spriteAssets[teamColor].tank;
            return team.map(([x, y], unitIndex) => (
              <img
                alt=""
                className="map-thumb-sprite"
                draggable={false}
                key={`tank-${teamIndex}-${unitIndex}`}
                src={sprite}
                style={{
                  height: `${thumbnailPercentHeight(SPRITE_SIZE + 4)}%`,
                  left: `${thumbnailPercentX(x)}%`,
                  top: `${thumbnailPercentY(y)}%`,
                  width: `${thumbnailPercentWidth(SPRITE_SIZE + 4)}%`,
                }}
              />
            ));
          })}
          {map.data.cities.map(([x, y], cityIndex) => {
            const isCapital = capitalIndexes.has(cityIndex);
            const size = isCapital ? CAPITAL_SIZE : CITY_SIZE;

            return (
              <img
                alt=""
                className="map-thumb-sprite"
                draggable={false}
                key={`city-${cityIndex}`}
                src={isCapital ? uiAssets.capital : uiAssets.city}
                style={{
                  height: `${thumbnailPercentHeight(size)}%`,
                  left: `${thumbnailPercentX(x)}%`,
                  top: `${thumbnailPercentY(y)}%`,
                  width: `${thumbnailPercentWidth(size)}%`,
                }}
              />
            );
          })}
        </span>
      </span>
    </span>
  );
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
                  <MapThumbnail map={map} />
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