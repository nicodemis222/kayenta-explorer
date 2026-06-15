import React from 'react';
import Dialog from './Dialog.jsx';

const MIN_SQFT_OPTS = [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 5000, 7500, 10000];
const MAX_SQFT_OPTS = [1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000, 25000, 50000, 100000];

/**
 * Save-and-search modal shown after a drawing is finished. Presentational —
 * the parent owns `savePrompt` state and the confirm/cancel handlers.
 */
export default function SaveSearchModal({ savePrompt, setSavePrompt, onConfirm, onCancel }) {
  return (
    <Dialog title="Save and search" labelId="save-modal-title" onClose={onCancel}>
      <label className="save-field">
        <span>Name</span>
        <input
          type="text"
          value={savePrompt.name}
          onChange={e => setSavePrompt(p => ({ ...p, name: e.target.value }))}
          autoFocus
        />
      </label>
      <div className="save-field">
        <span>House size range (sqft)</span>
        <div className="save-range">
          <select
            value={savePrompt.minSqft}
            onChange={e => setSavePrompt(p => ({ ...p, minSqft: Number(e.target.value) }))}
            title="Smallest house size to include"
          >
            {MIN_SQFT_OPTS.map(v => <option key={v} value={v}>min {v.toLocaleString()}</option>)}
          </select>
          <span className="save-range-sep">to</span>
          <select
            value={savePrompt.maxSqft || 0}
            onChange={e => setSavePrompt(p => ({ ...p, maxSqft: Number(e.target.value) }))}
            title="Largest house size to include (or no upper limit)"
          >
            <option value={0}>no max</option>
            {MAX_SQFT_OPTS.map(v => <option key={v} value={v}>max {v.toLocaleString()}</option>)}
          </select>
        </div>
      </div>
      <div className="save-modal-actions">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" onClick={onConfirm} disabled={!savePrompt.name.trim()}>
          Save and search
        </button>
      </div>
    </Dialog>
  );
}
