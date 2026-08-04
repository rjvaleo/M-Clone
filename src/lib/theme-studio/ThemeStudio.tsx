/**
 * Theme Studio — a portable palette editor.
 *
 * Fully controlled: it holds no palettes of its own, imports nothing from any
 * host application, and depends on React alone (no icon library, no CSS
 * framework, no store). Give it palettes and an `onChange`; it gives back edited
 * palettes and, on request, the derived token set.
 *
 * The live preview is the reason this is an editor rather than a form. Every
 * pixel of it is painted from the derived tokens, so what a palette will
 * actually look like as an interface is visible while its hex values are being
 * typed — including the status colours, which the derivation deliberately keeps
 * out of the palette's reach.
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { deriveTheme, type DerivedTheme } from './derive';
import { ensureStudioStyles } from './styles';
import { normalizeHex, paletteId, type StudioPalette } from './types';

export interface ThemeStudioProps {
  palettes: StudioPalette[];
  onChange: (palettes: StudioPalette[]) => void;
  /** Offered as an "Apply" button when present — the host decides what applying means. */
  onApply?: (palette: StudioPalette, derived: DerivedTheme) => void;
  applyLabel?: string;
  /** Id of the palette the host currently has applied, shown as a marker. */
  activeId?: string;
  className?: string;
}

const NEW_COLORS = ['#2e5496', '#7fa1d6', '#e8e4dc', '#3a3a3c'];

export function ThemeStudio({ palettes, onChange, onApply, applyLabel = 'Apply', activeId, className = '' }: ThemeStudioProps) {
  useEffect(() => ensureStudioStyles(), []);

  const [selectedId, setSelectedId] = useState<string | null>(palettes[0]?.id ?? null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Hex text is edited as typed; a half-typed "#2e5" must not wipe the colour. */
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  const selected = palettes.find((p) => p.id === selectedId) ?? null;
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? palettes.filter((p) => p.name.toLowerCase().includes(q)) : palettes;
  }, [palettes, filter]);

  const derived = useMemo<DerivedTheme | null>(() => {
    if (!selected?.colors.length) return null;
    try {
      return deriveTheme(selected.colors);
    } catch {
      return null;
    }
  }, [selected]);

  useEffect(() => setDrafts({}), [selectedId]);

  const update = (next: StudioPalette) => {
    setError(null);
    onChange(palettes.map((p) => (p.id === next.id ? next : p)));
  };

  const create = () => {
    const palette: StudioPalette = {
      id: paletteId('new palette', palettes.map((p) => p.id)),
      name: 'New palette',
      colors: [...NEW_COLORS],
      note: 'Created in Theme Studio',
    };
    onChange([...palettes, palette]);
    setSelectedId(palette.id);
  };

  const duplicate = (source: StudioPalette) => {
    const palette: StudioPalette = {
      id: paletteId(`${source.name} copy`, palettes.map((p) => p.id)),
      name: `${source.name} copy`,
      colors: [...source.colors],
      note: `Duplicated from ${source.name}`,
    };
    onChange([...palettes, palette]);
    setSelectedId(palette.id);
  };

  const remove = (palette: StudioPalette) => {
    const rest = palettes.filter((p) => p.id !== palette.id);
    onChange(rest);
    setSelectedId(rest[0]?.id ?? null);
  };

  const setColor = (index: number, raw: string) => {
    if (!selected) return;
    setDrafts((d) => ({ ...d, [index]: raw }));
    const hex = normalizeHex(raw);
    if (!hex) return;
    const colors = [...selected.colors];
    colors[index] = hex;
    update({ ...selected, colors });
  };

  const importJson = (text: string) => {
    try {
      const doc: unknown = JSON.parse(text);
      const list = (Array.isArray(doc) ? doc : [doc]) as StudioPalette[];
      const clean = list
        .filter((p) => p && typeof p.name === 'string' && Array.isArray(p.colors))
        .map((p) => ({
          id: paletteId(p.id || p.name, palettes.map((x) => x.id)),
          name: p.name,
          colors: p.colors.map((c) => normalizeHex(String(c))).filter((c): c is string => !!c),
          note: p.note ?? 'Imported',
        }))
        .filter((p) => p.colors.length >= 2);
      if (!clean.length) throw new Error('No palettes with at least two readable hex values.');
      onChange([...palettes, ...clean]);
      setSelectedId(clean[0].id);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className={`ts-studio ${className}`}>
      {/* ------------------------------------------------------------- list */}
      <div className="ts-panel">
        <div className="ts-panel-head">
          Palettes · {palettes.length}
          <button type="button" className="ts-btn ts-spacer" onClick={create}>
            + New
          </button>
        </div>
        <div style={{ padding: 7, borderBottom: '1px solid var(--ts-bd)' }}>
          <input
            className="ts-input"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter palettes"
          />
        </div>
        {shown.length === 0 ? (
          <div className="ts-empty">No palettes{filter ? ' match that filter' : ' yet'}.</div>
        ) : (
          <ul className="ts-list" role="listbox" aria-label="Palettes">
            {shown.map((palette) => (
              <li key={palette.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={palette.id === selectedId}
                  className="ts-item"
                  onClick={() => setSelectedId(palette.id)}
                >
                  <span className="ts-item-name">
                    {palette.name}
                    {palette.id === activeId && <span className="ts-inline-note"> · applied</span>}
                    {palette.readOnly && <span className="ts-inline-note"> · built in</span>}
                  </span>
                  {palette.note && <span className="ts-item-note">{palette.note}</span>}
                  <span className="ts-strip">
                    {palette.colors.map((c, i) => (
                      <span key={`${c}-${i}`} style={{ background: c }} />
                    ))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ----------------------------------------------------------- editor */}
      <div className="ts-panel">
        {!selected ? (
          <div className="ts-empty">Select a palette, or create one.</div>
        ) : (
          <>
            <div className="ts-panel-head">
              {selected.readOnly ? 'Viewing' : 'Editing'} · {selected.name}
              <span className="ts-spacer" />
              {derived && <span className="ts-tag">{derived.mode}</span>}
              {onApply && derived && (
                <button type="button" className="ts-btn" onClick={() => onApply(selected, derived)}>
                  {applyLabel}
                </button>
              )}
              <button type="button" className="ts-btn" onClick={() => duplicate(selected)}>
                Duplicate
              </button>
              {!selected.readOnly && (
                <button type="button" className="ts-btn ts-btn-danger" onClick={() => remove(selected)}>
                  Delete
                </button>
              )}
            </div>

            <div className="ts-panel-body">
              {error && <div className="ts-error">{error}</div>}

              <label className="ts-field">
                <span className="ts-label">Name</span>
                <input
                  className="ts-input"
                  value={selected.name}
                  disabled={selected.readOnly}
                  onChange={(e) => update({ ...selected, name: e.target.value })}
                />
              </label>

              <div className="ts-field">
                <span className="ts-label">Colours · {selected.colors.length}</span>
                <div className="ts-swatches">
                  {selected.colors.map((color, index) => (
                    <div className="ts-swatch" key={index}>
                      <input
                        type="color"
                        value={color}
                        disabled={selected.readOnly}
                        aria-label={`Colour ${index + 1}`}
                        onChange={(e) => setColor(index, e.target.value)}
                      />
                      <input
                        type="text"
                        value={drafts[index] ?? color}
                        disabled={selected.readOnly}
                        spellCheck={false}
                        aria-label={`Colour ${index + 1} hex`}
                        onChange={(e) => setColor(index, e.target.value)}
                        onBlur={() => setDrafts((d) => ({ ...d, [index]: color }))}
                      />
                      {!selected.readOnly && selected.colors.length > 2 && (
                        <button
                          type="button"
                          className="ts-x"
                          title="Remove this colour"
                          onClick={() => update({ ...selected, colors: selected.colors.filter((_, i) => i !== index) })}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                  {!selected.readOnly && (
                    <button type="button" className="ts-btn" onClick={() => update({ ...selected, colors: [...selected.colors, '#888888'] })}>
                      + Colour
                    </button>
                  )}
                </div>
                <p className="ts-note" style={{ marginTop: 6 }}>
                  Direction is read, not chosen: a palette that averages light becomes a light theme, one that averages
                  dark becomes a dark one. Surfaces borrow the hue and a damped share of the saturation, but their
                  lightness comes from a fixed ladder — which is what keeps text legible whatever the palette holds.
                </p>
              </div>

              {derived && <Preview derived={derived} name={selected.name} />}

              <div className="ts-row" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="ts-btn"
                  onClick={() => {
                    void navigator.clipboard.writeText(JSON.stringify(palettes.filter((p) => !p.readOnly), null, 2));
                  }}
                >
                  Copy all as JSON
                </button>
                <button
                  type="button"
                  className="ts-btn"
                  onClick={() => {
                    const text = prompt('Paste palette JSON — one object or an array of { name, colors }');
                    if (text) importJson(text);
                  }}
                >
                  Import JSON…
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Everything below is painted from the derived tokens — nothing is hard-coded. */
function Preview({ derived, name }: { derived: DerivedTheme; name: string }) {
  const [showTokens, setShowTokens] = useState(false);
  const style = derived.tokens as CSSProperties;
  const entries = Object.entries(derived.tokens);

  return (
    <div className="ts-field">
      <span className="ts-label">Live preview</span>
      <div className="ts-preview" style={{ ...style, background: 'var(--s-card)', color: 'var(--tx-800)' }}>
        <div className="ts-pv-nav" style={{ background: 'var(--s-nav)' }}>{name}</div>
        <div className="ts-pv-body" style={{ background: `rgb(var(--s-page))` }}>
          <div className="ts-pv-card" style={{ background: 'var(--s-card)', borderColor: 'var(--bd-200)' }}>
            <div className="ts-pv-title" style={{ color: 'var(--color-ink)' }}>PI 1 · readiness</div>
            <div className="ts-pv-pills">
              <span className="ts-pv-pill" style={{ background: 'var(--status-done-bg)', color: 'var(--status-done-text)' }}>Done</span>
              <span className="ts-pv-pill" style={{ background: 'var(--status-progress-bg)', color: 'var(--status-progress-text)' }}>In Progress</span>
              <span className="ts-pv-pill" style={{ background: 'var(--status-risk-bg)', color: 'var(--status-risk-text)' }}>At Risk</span>
              <span className="ts-pv-pill" style={{ background: 'var(--status-blocked-bg)', color: 'var(--status-blocked-text)' }}>Blocked</span>
              <span className="ts-pv-pill" style={{ background: 'var(--status-todo-bg)', color: 'var(--status-todo-text)' }}>To Do</span>
            </div>
            <div className="ts-pv-bar" style={{ background: 'var(--chart-track)' }}>
              <span style={{ width: '46%', background: 'var(--status-done-text)' }} />
              <span style={{ width: '22%', background: 'var(--status-progress-text)' }} />
            </div>
          </div>
          <div
            className="ts-pv-card"
            style={{ background: 'var(--sel-fill)', color: 'var(--sel-ink)', borderColor: 'var(--sel-edge)', boxShadow: 'inset 4px 0 0 0 var(--sel)' }}
          >
            <div className="ts-pv-title">Selected lane</div>
            <div style={{ fontSize: 10 }}>Paired with the content surface below, so the link between rail and board is visible.</div>
          </div>
          <div className="ts-pv-card" style={{ background: 'var(--sel-fill-2)', color: 'var(--sel-ink)', borderColor: 'var(--sel-edge)' }}>
            <div style={{ fontSize: 10 }}>Content for the selected lane</div>
          </div>
          <div className="ts-row">
            <button type="button" className="ts-pv-btn" style={{ background: 'var(--ac-on)' }}>Primary action</button>
            <span style={{ fontSize: 10, color: 'var(--tx-500)' }}>Muted supporting text</span>
          </div>
        </div>
      </div>

      <div className="ts-row" style={{ marginTop: 7 }}>
        <button type="button" className="ts-btn" onClick={() => setShowTokens((v) => !v)}>
          {showTokens ? 'Hide' : 'Show'} {entries.length} tokens
        </button>
        {derived.plainTokens && <span className="ts-note">Light palette — a white-surface variant is derived too.</span>}
      </div>
      {showTokens && (
        <div className="ts-tokens" style={{ marginTop: 6 }}>
          {entries.map(([key, value]) => (
            <div key={key}>
              <span className="ts-chip" style={{ background: value.includes(' ') && !value.startsWith('#') ? `rgb(${value})` : value }} />
              <b>{key}</b>
              <span>{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
