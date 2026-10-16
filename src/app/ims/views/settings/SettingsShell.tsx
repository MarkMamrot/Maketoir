'use client';

import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, HelpCircle, Menu, X } from 'lucide-react';
import { settingsPath, type SettingsItem, type SettingsSection } from '@/lib/navigation/imsSettingsNavigation';
import styles from './SettingsShell.module.css';

const DraftContext = createContext<((id: string, dirty: boolean) => void) | null>(null);

export function SettingsActions({ children }: { children: React.ReactNode }) {
  return <div className={styles.formActions} data-settings-actions>{children}</div>;
}

export function useSettingsDirty(dirty: boolean) {
  const id = useId();
  const register = useContext(DraftContext);
  useEffect(() => {
    register?.(id, dirty);
    return () => register?.(id, false);
  }, [dirty, id, register]);
}

export function SettingsShell({ active, items, businessName, dirty = false, onNavigate, onClose, onHelp, children }: {
  active: SettingsSection; items: readonly SettingsItem[]; businessName: string; dirty?: boolean;
  onNavigate: (section: SettingsSection) => void; onClose: () => void; onHelp: () => void; children: React.ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pageHeader = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const drafts = useRef(new Set<string>());
  const [hasDrafts, setHasDrafts] = useState(false);
  const [expanded, setExpanded] = useState<string[]>(() => settingsPath(active, items).slice(0, -1).map(item => item.id));
  const [mobileMenu, setMobileMenu] = useState(false);
  const [pending, setPending] = useState<SettingsSection | 'close' | { href: string } | null>(null);
  const dialogId = useId();
  const path = settingsPath(active, items);
  const page = path[path.length - 1];
  const register = useCallback((id: string, value: boolean) => {
    if (value) drafts.current.add(id); else drafts.current.delete(id);
    setHasDrafts(drafts.current.size > 0);
  }, []);
  const unsaved = dirty || hasDrafts;
  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const mobileMenuRef = useRef(mobileMenu);
  mobileMenuRef.current = mobileMenu;
  const acceptedUrl = useRef('');

  const request = (next: SettingsSection | 'close') => {
    if (next === active) return;
    if (unsavedRef.current) { setPending(next); return; }
    if (next === 'close') onClose(); else {
      onNavigate(next); setMobileMenu(false);
      if (mobileMenuRef.current) pageHeader.current?.focus();
    }
  };
  useEffect(() => {
    const measure = () => root.current?.style.setProperty('--settings-page-header-height', `${pageHeader.current?.offsetHeight ?? 0}px`);
    measure();
    if (typeof ResizeObserver === 'undefined' || !pageHeader.current) return;
    const observer = new ResizeObserver(measure);
    observer.observe(pageHeader.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    acceptedUrl.current = window.location.href;
    setExpanded(previous => [...new Set([...previous, ...settingsPath(active, items).slice(0, -1).map(item => item.id)])]);
    content.current?.scrollTo({ top: 0 });
  }, [active, items]);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        if (pendingRef.current) { event.preventDefault(); setPending(null); return; }
        if (mobileMenuRef.current) { event.preventDefault(); setMobileMenu(false); menuButton.current?.focus(); return; }
        const nested = event.target instanceof Element ? event.target.closest('[role="dialog"]') : null;
        if (nested && nested !== root.current) return;
        event.preventDefault();
        if (unsavedRef.current) setPending('close'); else closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const scope = root.current?.querySelector('[role="alertdialog"]') ?? root.current?.querySelector('[role="dialog"]') ?? root.current;
      const elements = Array.from(scope?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') ?? [])
        .filter(element => element.getClientRects().length > 0);
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const unload = (event: BeforeUnloadEvent) => { if (unsavedRef.current) { event.preventDefault(); event.returnValue = ''; } };
    const navigate = (event: Event) => {
      const href = window.location.href;
      if (href === acceptedUrl.current) return;
      if (unsavedRef.current) {
        event.stopImmediatePropagation();
        window.history.replaceState(window.history.state, '', acceptedUrl.current);
        setPending({ href });
      } else {
        acceptedUrl.current = href;
        if (!window.location.hash.startsWith('#settings-')) closeRef.current();
      }
    };
    root.current?.addEventListener('keydown', keydown);
    window.addEventListener('beforeunload', unload);
    window.addEventListener('hashchange', navigate, true);
    window.addEventListener('popstate', navigate, true);
    const element = root.current;
    return () => {
      document.body.style.overflow = previousOverflow;
      element?.removeEventListener('keydown', keydown);
      window.removeEventListener('beforeunload', unload);
      window.removeEventListener('hashchange', navigate, true);
      window.removeEventListener('popstate', navigate, true);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const renderItems = (nodes: readonly SettingsItem[], depth = 0): React.ReactNode => (
    <ul className={styles.list}>
      {nodes.map(item => {
        const open = expanded.includes(item.id);
        const current = active === item.id;
        const ancestor = path.some(part => part.id === item.id);
        return <li key={item.id}>
          <button type="button" className={`sv-button-flat ${styles.navItem} ${depth === 0 ? styles.group : ''}`} style={{ paddingLeft: 14 + depth * 16 }}
            aria-expanded={item.children ? open : undefined} aria-current={current ? 'page' : undefined}
            data-ancestor={ancestor || undefined}
            onClick={() => item.children ? setExpanded(previous => open ? previous.filter(id => id !== item.id) : [...previous, item.id]) : request(item.id as SettingsSection)}>
            {item.children ? open ? <ChevronDown size={16} /> : <ChevronRight size={16} /> : <span className={styles.dot} aria-hidden="true" />}
            <span>{item.label}</span>
          </button>
          {item.children && open && renderItems(item.children, depth + 1)}
        </li>;
      })}
    </ul>
  );
  return <DraftContext.Provider value={register}>
    <div ref={root} className={styles.shell} role="dialog" aria-modal="true" aria-labelledby={`${dialogId}-title`} data-testid="ims-settings-shell" data-settings-overlay
      onClickCapture={event => {
        const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
        if (!unsaved || !link || link.getAttribute('target') === '_blank') return;
        event.preventDefault(); event.stopPropagation();
        const href = link.getAttribute('href');
        if (href) setPending({ href });
      }}>
      <header className={styles.top}>
        <button ref={menuButton} type="button" className={styles.menuButton} onClick={() => setMobileMenu(value => !value)} aria-expanded={mobileMenu} aria-controls={`${dialogId}-navigation`} aria-label="Settings navigation"><Menu size={20} /></button>
        <div><strong id={`${dialogId}-title`}>Settings</strong><span className={styles.business}>{businessName}</span></div>
        <button type="button" onClick={onHelp} aria-label="Help for this settings page"><HelpCircle size={18} />Help</button>
        <button ref={closeButton} type="button" onClick={() => request('close')} aria-label="Close settings"><X size={21} /></button>
      </header>
      <nav id={`${dialogId}-navigation`} aria-label="Settings" className={`${styles.nav} ${mobileMenu ? styles.mobileOpen : ''}`}>{renderItems(items)}</nav>
      <div ref={content} className={styles.content} data-settings-scroll>
        <header ref={pageHeader} tabIndex={-1} className={styles.pageHeader}>
          <p className={styles.breadcrumb}>{path.slice(0, -1).map(item => item.label).join(' / ')}</p>
          <h1>{page?.label ?? 'Settings'}</h1>
          {page?.description && <p>{page.description}</p>}
        </header>
        <div className={styles.body} key={active}>{children}</div>
      </div>
      {pending && <div className={styles.confirmBackdrop}>
        <section role="alertdialog" aria-modal="true" aria-labelledby={`${dialogId}-discard`} className={styles.confirm}>
          <h2 id={`${dialogId}-discard`}>Discard unsaved changes?</h2>
          <p>Your changes have not been saved. Stay here to save them, or discard them to continue.</p>
          <div className={styles.actions}>
            <button autoFocus type="button" onClick={() => setPending(null)}>Keep editing</button>
            <button type="button" data-danger onClick={() => {
              const next = pending;
              drafts.current.clear(); setHasDrafts(false); setPending(null);
              if (next === 'close') onClose();
              else if (typeof next === 'object') { onClose(); window.location.assign(next.href); }
              else { onNavigate(next); setMobileMenu(false); if (mobileMenuRef.current) pageHeader.current?.focus(); }
            }}>Discard changes</button>
          </div>
        </section>
      </div>}
    </div>
  </DraftContext.Provider>;
}
