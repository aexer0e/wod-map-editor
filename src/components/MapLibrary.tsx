import { useRef } from 'react';
import { modeLabel, formatUpdatedAt } from '../lib/mapCodec';
import type { StoredMap } from '../lib/types';
import { uiAssets } from '../lib/assets';

interface MapLibraryProps {
  maps: StoredMap[];
  loading: boolean;
  onCreate: () => void;
  onImport: (file: File) => Promise<void>;
  onEdit: (mapId: string) => void;
  onDownload: (map: StoredMap) => void;
  onRename: (map: StoredMap) => void;
  onDelete: (map: StoredMap) => void;
}

function thumbnailFor(map: StoredMap) {
  return map.data.map_surface ? `data:image/png;base64,${map.data.map_surface}` : uiAssets.logo;
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
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const totals = maps.reduce(
    (summary, map) => {
      summary.units += map.data.infantry.reduce((count, team) => count + team.length, 0);
      summary.units += map.data.tanks.reduce((count, team) => count + team.length, 0);
      summary.cities += map.data.cities.length;
      summary.bridges += map.data.bridges.length;
      return summary;
    },
    { units: 0, cities: 0, bridges: 0 },
  );

  return (
    <section className="library-shell">
      <div className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">React + TypeScript rebuild</span>
          <h2>Fast map editing without the mushy input feel.</h2>
          <p>
            The editor now keeps terrain painting on a dedicated canvas pipeline, saves locally with stronger typing,
            and keeps the edit screen locked in place so the mouse wheel can resize your brush instead of scrolling the page.
          </p>
          <div className="hero-actions">
            <button className="primary-button" type="button" onClick={onCreate}>
              New map
            </button>
            <button className="secondary-button" type="button" onClick={() => importInputRef.current?.click()}>
              Import .txt
            </button>
            <input
              ref={importInputRef}
              accept=".txt,.gz"
              className="visually-hidden"
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) {
                  return;
                }

                void onImport(file);
                event.target.value = '';
              }}
            />
          </div>
        </div>

        <div className="hero-metrics">
          <article>
            <span>Saved maps</span>
            <strong>{maps.length}</strong>
          </article>
          <article>
            <span>Total units</span>
            <strong>{totals.units}</strong>
          </article>
          <article>
            <span>Cities</span>
            <strong>{totals.cities}</strong>
          </article>
          <article>
            <span>Bridges</span>
            <strong>{totals.bridges}</strong>
          </article>
        </div>
      </div>

      <div className="section-header">
        <div>
          <h3>Your maps</h3>
          <p>Each card opens directly into the new fixed editor workspace.</p>
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
          <p>Start a new battlefield or import an existing exported map file.</p>
        </div>
      ) : (
        <div className="map-grid">
          {maps.map((map) => {
            const infantry = map.data.infantry.reduce((count, team) => count + team.length, 0);
            const tanks = map.data.tanks.reduce((count, team) => count + team.length, 0);

            return (
              <article className="map-card" key={map.id}>
                <button className="map-thumb" type="button" onClick={() => onEdit(map.id)}>
                  <img alt={`${map.name} preview`} src={thumbnailFor(map)} />
                  <span className="map-mode-pill">{modeLabel(map.data.mode)}</span>
                </button>
                <div className="map-card-body">
                  <div>
                    <h4>{map.name}</h4>
                    <p>Updated {formatUpdatedAt(map.updatedAt)}</p>
                  </div>
                  <div className="map-card-stats">
                    <span>{map.data.cities.length} cities</span>
                    <span>{infantry} infantry</span>
                    <span>{tanks} tanks</span>
                    <span>{map.data.bridges.length} bridges</span>
                  </div>
                </div>
                <div className="map-card-actions">
                  <button className="primary-button subtle" type="button" onClick={() => onEdit(map.id)}>
                    Edit
                  </button>
                  <button className="secondary-button" type="button" onClick={() => onDownload(map)}>
                    Download
                  </button>
                  <button className="secondary-button" type="button" onClick={() => onRename(map)}>
                    Rename
                  </button>
                  <button className="danger-button" type="button" onClick={() => onDelete(map)}>
                    Delete
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}