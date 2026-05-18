import React from 'react';

function formatDate(s) {
  if (!s) return 'never';
  const d = new Date(s);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

export default function SearchSidebar({
  searches,
  activeId,
  mode,
  onModeChange,
  onSelect,
  onNew,
  onDelete,
  onRerun,
  onRename,
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>Searches</h2>
      </div>

      <div className="sidebar-mode-toggle">
        <button
          className={`mode-btn ${mode === 'farmland' ? 'active' : ''}`}
          onClick={() => onModeChange('farmland')}
        >
          Farmland
        </button>
        <button
          className={`mode-btn ${mode === 'cabin' ? 'active' : ''}`}
          onClick={() => onModeChange('cabin')}
        >
          Cabin
        </button>
        <button
          className={`mode-btn ${mode === 'commercial' ? 'active' : ''}`}
          onClick={() => onModeChange('commercial')}
          title="Commercial / underground / industrial — bunker-conversion candidates"
        >
          Commercial
        </button>
      </div>

      <button className="btn btn-primary new-search-btn" onClick={onNew}>
        + New Search
      </button>

      <div className="sidebar-list">
        {searches.length === 0 ? (
          <div className="sidebar-empty">
            No saved searches yet. Draw an area on the map to create one.
          </div>
        ) : (
          searches.map(s => (
            <div
              key={s.id}
              className={`sidebar-item ${activeId === s.id ? 'active' : ''}`}
              onClick={() => onSelect(s)}
            >
              <div className="sidebar-item-row">
                <span className="sidebar-item-name">{s.name}</span>
                <span className={`mode-tag mode-${s.mode}`}>{s.mode}</span>
              </div>
              <div className="sidebar-item-sub">
                {Array.isArray(s.polygon) ? `${s.polygon.length}-point area` : `${(+s.radius_mi).toFixed(0)}mi radius`} · {s.result_count || 0} results · {formatDate(s.last_run_at)}
              </div>
              {(s.min_house_sqft || s.max_house_sqft) && (
                <div className="sidebar-item-sub">
                  {s.max_house_sqft
                    ? `${(s.min_house_sqft ?? 0).toLocaleString()}–${s.max_house_sqft.toLocaleString()} sqft`
                    : `≥ ${s.min_house_sqft.toLocaleString()} sqft`}
                </div>
              )}
              <div className="sidebar-item-actions">
                <button title="Re-run search" onClick={(e) => { e.stopPropagation(); onRerun(s); }}>Re-run</button>
                <button title="Rename"        onClick={(e) => { e.stopPropagation(); onRename(s); }}>Rename</button>
                <button title="Delete search" className="danger" onClick={(e) => { e.stopPropagation(); onDelete(s); }}>Delete</button>
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
