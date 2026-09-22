'use client';

import { useState } from 'react';
import { LifeBuoy, Megaphone, MessageCircle, Users, X } from 'lucide-react';

import { WarehouseTeamChat } from './WarehouseTeamChat';
import { WarehouseCommunicationsBoard } from './WarehouseCommunicationsBoard';
import { SupportTicketsPanel } from './SupportTicketsPanel';
import styles from './UnifiedHelpDrawer.module.css';

// Reuses the UnifiedHelpDrawer visual shell (same CSS module) but is a fully
// independent drawer — split out from Help/Ask Solvantis per its own bottom icon.
export function TeamCommunicationsDrawer({
  open,
  onOpenChange,
  showFloatingTrigger = true,
  userTier,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  showFloatingTrigger?: boolean;
  userTier?: string;
}) {
  const isSuperAdmin = userTier === 'SuperAdmin';
  const [mode, setMode] = useState<'chat' | 'board' | 'tickets'>('chat');
  const [chatUnread, setChatUnread] = useState(0);
  const [boardUnread, setBoardUnread] = useState(0);
  const [openTicketCount, setOpenTicketCount] = useState(0);
  const totalUnread = chatUnread + boardUnread + (isSuperAdmin ? openTicketCount : 0);

  return (
    <>
      {showFloatingTrigger && !open && (
        <button
          className={styles.floatingTrigger}
          onClick={() => onOpenChange(true)}
          aria-label={totalUnread > 0 ? `Open Team Communications, ${totalUnread} unread` : 'Open Team Communications'}
          title="Team Communications"
        >
          <Users size={21} />
          {totalUnread > 0 && (
            <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, padding: '0 5px', display: 'grid', placeItems: 'center', borderRadius: 9, background: '#ef4444', color: '#fff', border: '2px solid var(--sv-bg-1, #fff)', fontSize: 9, fontWeight: 800, lineHeight: 1 }}>
              {totalUnread > 99 ? '99+' : totalUnread}
            </span>
          )}
        </button>
      )}
      <aside className={styles.drawer} role="dialog" aria-modal="false" aria-labelledby="team-communications-title" aria-hidden={!open} style={open ? undefined : { display: 'none' }}>
        <header className={styles.header}>
          <div className={styles.brandMark}><Users size={19} /></div>
          <div className={styles.headingText}>
            <h2 id="team-communications-title">Team Communications</h2>
            <span>Warehouse and POS location messages</span>
          </div>
          <button className={`${styles.iconButton} sv-button-flat`} onClick={() => onOpenChange(false)} aria-label="Close Team Communications" title="Close Team Communications">
            <X size={20} />
          </button>
        </header>

        <div className={styles.modeTabs} role="tablist" aria-label="Team Communications mode">
          <button className={`sv-button-flat ${mode === 'chat' ? styles.activeTab : ''}`} onClick={() => setMode('chat')} role="tab" aria-selected={mode === 'chat'}>
            <MessageCircle size={16} /> Team Chat
            {chatUnread > 0 && <span style={{ minWidth: 18, height: 18, padding: '0 5px', display: 'grid', placeItems: 'center', borderRadius: 9, background: '#ef4444', color: '#fff', fontSize: 9, fontWeight: 800 }}>{chatUnread > 99 ? '99+' : chatUnread}</span>}
          </button>
          <button className={`sv-button-flat ${mode === 'board' ? styles.activeTab : ''}`} onClick={() => setMode('board')} role="tab" aria-selected={mode === 'board'}>
            <Megaphone size={16} /> Team Communications
            {boardUnread > 0 && <span style={{ minWidth: 18, height: 18, padding: '0 5px', display: 'grid', placeItems: 'center', borderRadius: 9, background: '#ef4444', color: '#fff', fontSize: 9, fontWeight: 800 }}>{boardUnread > 99 ? '99+' : boardUnread}</span>}
          </button>
          {isSuperAdmin && (
            <button className={`sv-button-flat ${mode === 'tickets' ? styles.activeTab : ''}`} onClick={() => setMode('tickets')} role="tab" aria-selected={mode === 'tickets'}>
              <LifeBuoy size={16} /> Support Tickets
              {openTicketCount > 0 && <span style={{ minWidth: 18, height: 18, padding: '0 5px', display: 'grid', placeItems: 'center', borderRadius: 9, background: '#ef4444', color: '#fff', fontSize: 9, fontWeight: 800 }}>{openTicketCount > 99 ? '99+' : openTicketCount}</span>}
            </button>
          )}
        </div>

        <div style={{ minHeight: 0, display: mode === 'chat' ? 'block' : 'none', overflow: 'auto' }}>
          <WarehouseTeamChat active={open && mode === 'chat'} onUnreadChange={setChatUnread} />
        </div>
        <div style={{ minHeight: 0, display: mode === 'board' ? 'block' : 'none', overflow: 'auto' }}>
          <WarehouseCommunicationsBoard active={open && mode === 'board'} onUnreadChange={setBoardUnread} />
        </div>
        {isSuperAdmin && (
          <div style={{ minHeight: 0, display: mode === 'tickets' ? 'block' : 'none', overflow: 'auto', padding: 16 }}>
            <SupportTicketsPanel onOpenCountChange={setOpenTicketCount} />
          </div>
        )}
      </aside>
    </>
  );
}
