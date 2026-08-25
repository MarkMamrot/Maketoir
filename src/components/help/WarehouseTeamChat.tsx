'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, MessageCircle, Users } from 'lucide-react';

type ChatIdentity = { locationId: number; locationName: string; userName: string; avatar: string };
type ChatLocation = { id: number; name: string; avatar: string };
type ChatAttachment = { id: number; original_name: string; mime_type: string };
type ChatMessage = {
  id: number;
  location_id: number;
  location_name: string;
  user_name: string;
  avatar: string;
  message: string;
  to_location_id: number | null;
  created_at: string;
  attachments?: ChatAttachment[];
};

function threadPartner(message: ChatMessage, myLocationId: number): number {
  return message.location_id === myLocationId ? Number(message.to_location_id) : message.location_id;
}

function messageTime(value: string): string {
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const date = new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : `${normalized}Z`);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function WarehouseTeamChat({ active, onUnreadChange }: { active: boolean; onUnreadChange: (count: number) => void }) {
  const [identity, setIdentity] = useState<ChatIdentity | null>(null);
  const [locations, setLocations] = useState<ChatLocation[]>([]);
  const [groupMessages, setGroupMessages] = useState<ChatMessage[]>([]);
  const [directMessages, setDirectMessages] = useState<ChatMessage[]>([]);
  const [selected, setSelected] = useState<'group' | number>('group');
  const [unread, setUnread] = useState<Record<number, number>>({});
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<'group' | number>('group');
  const activeRef = useRef(active);
  const seenRef = useRef(new Set<number>());

  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { onUnreadChange(Object.values(unread).reduce((total, count) => total + count, 0)); }, [unread, onUnreadChange]);

  const lastReadKey = (locationId: number, partnerId: number) => `ims_warehouse_chat_last_read_${locationId}_${partnerId}`;

  const markThreadRead = (partnerId: number, messages = directMessages) => {
    if (!identity) return;
    const ids = messages.filter(message => threadPartner(message, identity.locationId) === partnerId).map(message => message.id);
    if (ids.length) {
      try { localStorage.setItem(lastReadKey(identity.locationId, partnerId), String(Math.max(...ids))); } catch {}
    }
    setUnread(current => ({ ...current, [partnerId]: 0 }));
  };

  const loadMessages = async (currentIdentity?: ChatIdentity) => {
    const [groupResponse, inboxResponse] = await Promise.all([
      fetch('/api/pos/chat?type=group&surface=ims'),
      fetch('/api/pos/chat?type=inbox&surface=ims'),
    ]);
    const groupData = await groupResponse.json();
    const inboxData = await inboxResponse.json();
    if (!groupResponse.ok || !inboxResponse.ok) throw new Error(groupData.error ?? inboxData.error ?? 'Team Chat could not load.');
    const groups: ChatMessage[] = groupData.messages ?? [];
    const inbox: ChatMessage[] = inboxData.messages ?? [];
    setGroupMessages(groups);
    setDirectMessages(inbox);
    for (const message of [...groups, ...inbox]) seenRef.current.add(message.id);

    const mine = currentIdentity ?? identity;
    if (!mine) return;
    const counts: Record<number, number> = {};
    for (const message of inbox) {
      if (message.to_location_id !== mine.locationId || message.location_id === mine.locationId) continue;
      let lastRead = 0;
      try { lastRead = Number(localStorage.getItem(lastReadKey(mine.locationId, message.location_id)) ?? 0); } catch {}
      if (message.id > lastRead) counts[message.location_id] = (counts[message.location_id] ?? 0) + 1;
    }
    setUnread(counts);
  };

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/pos/chat?type=meta&surface=ims');
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? 'Warehouse chat is not configured.');
        if (cancelled) return;
        setIdentity(data.identity);
        setLocations(data.locations ?? []);
        await loadMessages(data.identity);
        if (cancelled) return;
        const since = Math.max(0, ...Array.from(seenRef.current));
        eventSource = new EventSource(`/api/pos/chat/stream?since=${since}&surface=ims`);
        eventSource.onmessage = event => {
          try {
            const incoming: ChatMessage[] = JSON.parse(event.data).messages ?? [];
            const fresh = incoming.filter(message => !seenRef.current.has(message.id));
            if (!fresh.length) return;
            for (const message of fresh) seenRef.current.add(message.id);
            setGroupMessages(current => [...current, ...fresh.filter(message => !message.to_location_id)].slice(-200));
            const direct = fresh.filter(message => Boolean(message.to_location_id));
            if (direct.length) setDirectMessages(current => [...current, ...direct].slice(-500));
            for (const message of direct) {
              if (message.to_location_id !== data.identity.locationId || message.location_id === data.identity.locationId) continue;
              const partnerId = message.location_id;
              if (activeRef.current && selectedRef.current === partnerId) {
                try { localStorage.setItem(lastReadKey(data.identity.locationId, partnerId), String(message.id)); } catch {}
              } else {
                setUnread(current => ({ ...current, [partnerId]: (current[partnerId] ?? 0) + 1 }));
              }
            }
          } catch {}
        };
      } catch (loadError: any) {
        if (!cancelled) setError(loadError.message ?? 'Team Chat could not load.');
      }
    })();
    return () => { cancelled = true; eventSource?.close(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (active) setSelected('group');
  }, [active]);

  useEffect(() => {
    if (typeof selected === 'number' && active) markThreadRead(selected);
    requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; });
  }, [selected, active, directMessages.length, groupMessages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleMessages = selected === 'group'
    ? groupMessages
    : directMessages.filter(message => identity && threadPartner(message, identity.locationId) === selected);
  const selectedLocation = typeof selected === 'number' ? locations.find(location => location.id === selected) : null;

  const send = async () => {
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    setError('');
    try {
      const response = await fetch('/api/pos/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, to_location_id: selected === 'group' ? null : selected, surface: 'ims' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Message failed.');
      setDraft('');
      await loadMessages();
    } catch (sendError: any) {
      setError(sendError.message ?? 'Message failed.');
    } finally {
      setSending(false);
    }
  };

  if (error && !identity) return <div style={{ padding: 24, color: 'var(--sv-red)', fontSize: 13 }}>{error}</div>;

  return (
    <div style={{ minHeight: 0, height: '100%', display: 'grid', gridTemplateColumns: '210px minmax(0, 1fr)', background: 'var(--sv-bg-1)' }}>
      <aside style={{ minHeight: 0, overflowY: 'auto', padding: 10, borderRight: '1px solid var(--sv-etch)', background: 'var(--sv-bg-0)' }}>
        <button onClick={() => setSelected('group')} style={{ width: '100%', minHeight: 44, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 9, border: 0, borderRadius: 6, background: selected === 'group' ? '#dcefeb' : 'transparent', color: selected === 'group' ? '#0e625b' : 'var(--sv-text-main)', fontWeight: 750, cursor: 'pointer', textAlign: 'left' }}>
          <Users size={17} /> All locations
        </button>
        <div style={{ margin: '12px 8px 6px', color: 'var(--sv-text-dim)', fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}>Direct messages</div>
        {locations.filter(location => location.id !== identity?.locationId).map(location => (
          <button key={location.id} onClick={() => { setSelected(location.id); markThreadRead(location.id); }} style={{ width: '100%', minHeight: 42, padding: '7px 8px', display: 'grid', gridTemplateColumns: '28px 1fr auto', alignItems: 'center', gap: 8, border: 0, borderRadius: 6, background: selected === location.id ? '#dcefeb' : 'transparent', color: 'var(--sv-text-main)', cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', overflow: 'hidden', borderRadius: '50%', background: 'var(--sv-bg-2)', color: 'var(--sv-action)', fontSize: 11, fontWeight: 800 }}>
              {location.avatar ? <img src={`/avatars/${location.avatar}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} /> : location.name.slice(0, 1).toUpperCase()}
            </span>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 700 }}>{location.name}</span>
            {(unread[location.id] ?? 0) > 0 && <span style={{ minWidth: 18, height: 18, padding: '0 5px', display: 'grid', placeItems: 'center', borderRadius: 9, background: '#ef4444', color: '#fff', fontSize: 9, fontWeight: 800 }}>{unread[location.id]}</span>}
          </button>
        ))}
      </aside>
      <section style={{ minWidth: 0, minHeight: 0, display: 'grid', gridTemplateRows: 'auto 1fr auto' }}>
        <header style={{ minHeight: 48, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 9, borderBottom: '1px solid var(--sv-etch)' }}>
          <MessageCircle size={17} color="var(--sv-action)" />
          <div><strong style={{ display: 'block', fontSize: 13 }}>{selected === 'group' ? 'Team Chat' : selectedLocation?.name ?? 'Direct message'}</strong><span style={{ color: 'var(--sv-text-dim)', fontSize: 11 }}>{identity ? `Sending as ${identity.locationName}` : 'Connecting...'}</span></div>
        </header>
        <div ref={listRef} style={{ minHeight: 0, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {visibleMessages.length === 0 && <div style={{ margin: 'auto', color: 'var(--sv-text-dim)', fontSize: 13 }}>No messages in this conversation yet.</div>}
          {visibleMessages.map(message => {
            const mine = message.location_id === identity?.locationId;
            return <div key={message.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '78%' }}>
              <div style={{ marginBottom: 3, color: 'var(--sv-text-dim)', fontSize: 10, textAlign: mine ? 'right' : 'left' }}>{message.location_name} · {message.user_name} · {messageTime(message.created_at)}</div>
              <div style={{ padding: '8px 10px', borderRadius: mine ? '10px 10px 2px 10px' : '10px 10px 10px 2px', background: mine ? '#dcefeb' : 'var(--sv-bg-0)', border: '1px solid var(--sv-etch)', color: 'var(--sv-text-main)', fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {message.message}
                {message.attachments?.map(file => <a key={file.id} href={`/api/pos/chat/attachments/${file.id}?surface=ims`} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 5, color: 'var(--sv-action)', fontSize: 11 }}>{file.original_name}</a>)}
              </div>
            </div>;
          })}
        </div>
        <form onSubmit={event => { event.preventDefault(); send(); }} style={{ padding: 10, display: 'flex', alignItems: 'flex-end', gap: 7, borderTop: '1px solid var(--sv-etch)' }}>
          <textarea value={draft} onChange={event => setDraft(event.target.value.slice(0, 500))} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} rows={1} placeholder={selected === 'group' ? 'Message all locations' : `Message ${selectedLocation?.name ?? 'location'}`} style={{ minHeight: 38, maxHeight: 96, flex: 1, resize: 'vertical', border: '1px solid var(--sv-etch)', borderRadius: 6, padding: '9px 10px', background: 'var(--sv-bg-0)', color: 'var(--sv-text-main)', font: 'inherit', fontSize: 13, outline: 0 }} />
          <button type="submit" disabled={!draft.trim() || sending} aria-label="Send message" title="Send message" style={{ width: 38, height: 38, display: 'grid', placeItems: 'center', border: 0, borderRadius: 6, background: 'var(--sv-action)', color: '#fff', cursor: draft.trim() && !sending ? 'pointer' : 'default', opacity: draft.trim() && !sending ? 1 : .45 }}><ArrowUp size={18} /></button>
        </form>
        {error && <div style={{ padding: '0 10px 8px', color: 'var(--sv-red)', fontSize: 11 }}>{error}</div>}
      </section>
    </div>
  );
}