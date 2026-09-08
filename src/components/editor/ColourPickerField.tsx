'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, Pipette, RotateCcw, X } from 'lucide-react';
import styles from './ColourPickerField.module.css';

const HEX = /^#[0-9a-f]{6}$/i;

export function ColourPickerField({ label, value, fallback = '#000000', onChange, swatches = {}, allowClear = false, clearLabel = 'Clear' }: {
  label: string;
  value?: string;
  fallback?: string;
  onChange: (value: string) => void;
  swatches?: Record<string, string>;
  allowClear?: boolean;
  clearLabel?: string;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const resolved = HEX.test(value ?? '') ? value! : HEX.test(fallback) ? fallback : '#000000';

  useEffect(() => setDraft(value ?? ''), [value]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const applyDraft = () => {
    if (HEX.test(draft)) {
      onChange(draft.toLowerCase());
      setOpen(false);
    }
  };

  return (
    <div className={styles.field} ref={rootRef}>
      <label id={`${id}-label`}>{label}</label>
      <button className={styles.trigger} type="button" onClick={() => setOpen(current => !current)} aria-expanded={open} aria-labelledby={`${id}-label`}>
        <span className={styles.preview} style={{ backgroundColor: resolved }} />
        <span>{value || clearLabel}</span>
        <Pipette size={14} />
      </button>
      {open && <div className={styles.popover} role="dialog" aria-label={`${label} colour picker`}>
        <div className={styles.popoverHeader}><strong>{label}</strong><button type="button" onClick={() => setOpen(false)} aria-label="Close colour picker"><X size={15} /></button></div>
        <label className={styles.nativePicker}>
          <input type="color" value={resolved} onChange={event => { setDraft(event.target.value); onChange(event.target.value); }} />
          <span style={{ backgroundColor: resolved }}><Pipette size={18} /></span>
          <small>Open colour spectrum</small>
        </label>
        <div className={styles.hexRow}>
          <input value={draft} maxLength={7} placeholder="#000000" aria-label={`${label} hexadecimal value`} onChange={event => setDraft(event.target.value)} onKeyDown={event => event.key === 'Enter' && applyDraft()} />
          <button type="button" onClick={applyDraft} disabled={!HEX.test(draft)} aria-label="Apply hexadecimal colour"><Check size={15} /></button>
        </div>
        {Object.keys(swatches).length > 0 && <div className={styles.swatches}><span>Foresight brand colours</span><div>{Object.entries(swatches).filter(([, colour]) => HEX.test(colour)).map(([name, colour]) => <button key={name} type="button" title={`${name}: ${colour}`} aria-label={`Use ${name} ${colour}`} style={{ backgroundColor: colour }} onClick={() => { onChange(colour); setOpen(false); }} />)}</div></div>}
        {allowClear && <button className={styles.clear} type="button" onClick={() => { onChange(''); setOpen(false); }}><RotateCcw size={13} /> {clearLabel}</button>}
      </div>}
    </div>
  );
}
