'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight, HelpCircle, MessageCircle, Search, Users, X } from 'lucide-react';

import type { AssistantAudience } from '@/lib/assistant/policy';
import { listHelpTopics, resolveHelpContext } from '@/lib/help/resolveHelpContext';
import { searchHelpTopics } from '@/lib/help/searchHelpTopics';
import type { HelpProduct, HelpTopic } from '@/lib/help/types';
import { SolvantisAssistantPanel } from '@/components/assistant/SolvantisAssistantPanel';
import { WarehouseTeamChat } from './WarehouseTeamChat';
import { HelpMarkdown } from './HelpMarkdown';
import styles from './UnifiedHelpDrawer.module.css';

function topicGroupLabel(topic: HelpTopic): string {
  return topic.screen.split(' > ')[0];
}

function topicGroupId(label: string): string {
  return `help-topic-group-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

export function UnifiedHelpDrawer({
  open,
  onOpenChange,
  audience,
  product,
  currentContext,
  chatEndpoint,
  escalationEndpoint,
  assistantDisabled = false,
  assistantDisabledLabel,
  showFloatingTrigger = true,
  teamChatEnabled = false,
  modeRequest,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  audience: AssistantAudience;
  product: HelpProduct;
  currentContext?: string | null;
  chatEndpoint: string;
  escalationEndpoint: string;
  assistantDisabled?: boolean;
  assistantDisabledLabel?: string;
  showFloatingTrigger?: boolean;
  teamChatEnabled?: boolean;
  modeRequest?: { key: number; mode: 'help' | 'ask' | 'team' };
}) {
  const contextual = useMemo(
    () => resolveHelpContext({ audience, product, context: currentContext }),
    [audience, product, currentContext],
  );
  const topics = useMemo(() => listHelpTopics(audience, product), [audience, product]);
  const [mode, setMode] = useState<'help' | 'ask' | 'team'>('help');
  const [teamUnread, setTeamUnread] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(contextual?.topic.id ?? null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(contextual?.topic ? [topicGroupLabel(contextual.topic)] : []),
  );
  const [query, setQuery] = useState('');
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const closeDrawer = useCallback(() => {
    setMode('help');
    onOpenChange(false);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    setSelectedId(contextual?.topic.id ?? null);
    setExpandedGroups(new Set(contextual?.topic ? [topicGroupLabel(contextual.topic)] : []));
    closeButtonRef.current?.focus();
    if (contextual?.sectionId) {
      requestAnimationFrame(() => document.getElementById(contextual.sectionId!)?.scrollIntoView({ block: 'start' }));
    }
  }, [open, contextual?.topic.id, contextual?.sectionId]);

  useEffect(() => {
    if (modeRequest) setMode(modeRequest.mode);
  }, [modeRequest]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDrawer();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, closeDrawer]);

  const selected = topics.find(topic => topic.id === selectedId) ?? contextual?.topic ?? topics[0] ?? null;
  const normalizedQuery = query.trim().toLowerCase();
  const searchResults = useMemo(() => searchHelpTopics(topics, normalizedQuery), [topics, normalizedQuery]);
  const filtered = normalizedQuery ? [] : topics;
  const topicGroups = filtered.reduce<Array<{ label: string; topics: HelpTopic[] }>>((groups, topic) => {
    const label = topicGroupLabel(topic);
    const existing = groups.find(group => group.label === label);
    if (existing) existing.topics.push(topic);
    else groups.push({ label, topics: [topic] });
    return groups;
  }, []);

  const selectTopic = (topic: HelpTopic, sectionId?: string) => {
    setSelectedId(topic.id);
    setExpandedGroups(current => new Set(current).add(topicGroupLabel(topic)));
    setQuery('');
    if (sectionId) requestAnimationFrame(() => document.getElementById(sectionId)?.scrollIntoView({ block: 'start' }));
  };

  const toggleGroup = (label: string) => {
    setExpandedGroups(current => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const relatedTopics = selected?.relatedTopics
    ?.map(topicId => topics.find(topic => topic.id === topicId))
    .filter((topic): topic is HelpTopic => Boolean(topic)) ?? [];

  return (
    <>
      {showFloatingTrigger && !open && (
        <button
          className={styles.floatingTrigger}
          onClick={() => { setMode(teamChatEnabled ? 'team' : 'ask'); onOpenChange(true); }}
          aria-label={teamChatEnabled ? `Open Team Chat${teamUnread ? `, ${teamUnread} unread` : ''}` : 'Open Solvantis Help'}
          title={teamChatEnabled ? 'Team Chat' : 'Help and Ask Solvantis'}
        >
          {teamChatEnabled ? <Users size={21} /> : <MessageCircle size={21} />}
          {teamChatEnabled && teamUnread > 0 && (
            <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18, padding: '0 5px', display: 'grid', placeItems: 'center', borderRadius: 9, background: '#ef4444', color: '#fff', border: '2px solid var(--sv-bg-1, #fff)', fontSize: 9, fontWeight: 800, lineHeight: 1 }}>
              {teamUnread > 99 ? '99+' : teamUnread}
            </span>
          )}
        </button>
      )}
      <aside className={styles.drawer} role="dialog" aria-modal="false" aria-labelledby="unified-help-title" aria-hidden={!open} style={open ? undefined : { display: 'none' }}>
          <header className={styles.header}>
            <div className={styles.brandMark}><HelpCircle size={19} /></div>
            <div className={styles.headingText}>
              <h2 id="unified-help-title">{mode === 'team' ? 'Team Communications' : 'Solvantis Help'}</h2>
              <span>{mode === 'team' ? 'Warehouse and POS location messages' : contextual?.exact ? `Help for ${contextual.topic.title}` : 'Product guidance and live assistance'}</span>
            </div>
            <button ref={closeButtonRef} className={styles.iconButton} onClick={closeDrawer} aria-label="Close Help" title="Close Help">
              <X size={20} />
            </button>
          </header>

          <div className={styles.modeTabs} role="tablist" aria-label="Help mode">
            {teamChatEnabled && (
              <button className={mode === 'team' ? styles.activeTab : ''} onClick={() => setMode('team')} role="tab" aria-selected={mode === 'team'}>
                <Users size={16} /> Team Chat
                {teamUnread > 0 && <span style={{ minWidth: 18, height: 18, padding: '0 5px', display: 'grid', placeItems: 'center', borderRadius: 9, background: '#ef4444', color: '#fff', fontSize: 9, fontWeight: 800 }}>{teamUnread > 99 ? '99+' : teamUnread}</span>}
              </button>
            )}
            <button className={mode === 'help' ? styles.activeTab : ''} onClick={() => setMode('help')} role="tab" aria-selected={mode === 'help'}>
              <BookOpen size={16} /> Help
            </button>
            <button className={mode === 'ask' ? styles.activeTab : ''} onClick={() => setMode('ask')} role="tab" aria-selected={mode === 'ask'}>
              <MessageCircle size={16} /> Ask Solvantis
            </button>
          </div>

          {teamChatEnabled && <div style={{ minHeight: 0, display: mode === 'team' ? 'block' : 'none' }}><WarehouseTeamChat active={open && mode === 'team'} onUnreadChange={setTeamUnread} /></div>}
          {mode === 'ask' ? (
            <div className={styles.assistantPane}>
              <SolvantisAssistantPanel
                chatEndpoint={chatEndpoint}
                escalationEndpoint={escalationEndpoint}
                currentView={currentContext}
                disabled={assistantDisabled}
                disabledLabel={assistantDisabledLabel}
                onCitationOpen={citation => {
                  const topic = topics.find(candidate => candidate.id === citation.topicId);
                  if (!topic) return;
                  setSelectedId(topic.id);
                  setExpandedGroups(current => new Set(current).add(topicGroupLabel(topic)));
                  setMode('help');
                  if (citation.sectionId) requestAnimationFrame(() => document.getElementById(citation.sectionId!)?.scrollIntoView({ block: 'start' }));
                }}
                embedded
              />
            </div>
          ) : mode === 'help' ? (
            <div className={styles.helpLayout}>
              <nav className={styles.topicNav} aria-label="Help topics">
                <label className={styles.searchBox}>
                  <Search size={15} />
                  <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search Help" aria-label="Search Help" />
                </label>
                <div className={styles.topicList}>
                  {normalizedQuery && searchResults.map(({ topic, section, snippet }) => (
                    <button key={`${topic.id}:${section.id}`} className={styles.searchResult} onClick={() => selectTopic(topic, section.id)}>
                      <span><strong>{topic.title}</strong><small>{section.heading}</small><em>{snippet}</em></span><ChevronRight size={15} />
                    </button>
                  ))}
                  {topicGroups.map(group => (
                    <div className={styles.topicGroup} key={group.label}>
                      <button
                        type="button"
                        className={styles.groupToggle}
                        aria-expanded={expandedGroups.has(group.label)}
                        aria-controls={topicGroupId(group.label)}
                        onClick={() => toggleGroup(group.label)}
                      >
                        <span>{group.label}</span>
                        <ChevronDown size={14} aria-hidden="true" />
                      </button>
                      {expandedGroups.has(group.label) && (
                        <div id={topicGroupId(group.label)} className={styles.groupTopics}>
                          {group.topics.map(topic => (
                            <button key={topic.id} className={`${topic.id === selected?.id ? styles.selectedTopic : ''} ${topic.parentId && topics.some(candidate => candidate.id === topic.parentId) ? styles.childTopic : ''}`} onClick={() => selectTopic(topic)}>
                              <span>{topic.title}</span><ChevronRight size={15} />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {normalizedQuery && searchResults.length === 0 && <p className={styles.noResults}>No matching topics.</p>}
                </div>
              </nav>

              <article className={styles.content}>
                {selected ? (
                  <>
                    <div className={styles.breadcrumbs}>{selected.screen.split(' > ').map((part, index) => <span key={`${part}-${index}`}>{part}</span>)}</div>
                    <h1>{selected.title}</h1>
                    <p className={styles.summary}>{selected.summary}</p>
                    {selected.id !== contextual?.topic.id && contextual && (
                      <button className={styles.contextButton} onClick={() => selectTopic(contextual.topic)}>Back to help for this page</button>
                    )}
                    <div className={styles.sections}>
                      {selected.sections.map(section => (
                        <section key={section.id} id={section.id} className={section.heading === 'Main operations' ? styles.mainOperations : ''}>
                          <h2>{section.heading}</h2>
                          <HelpMarkdown>{section.content}</HelpMarkdown>
                        </section>
                      ))}
                    </div>
                    {relatedTopics.length > 0 && (
                      <nav className={styles.relatedTopics} aria-label="Related Help topics">
                        <h2>Related Help</h2>
                        <div>{relatedTopics.map(topic => <button key={topic.id} onClick={() => selectTopic(topic)}>{topic.title}<ChevronRight size={14} /></button>)}</div>
                      </nav>
                    )}
                  </>
                ) : (
                  <div className={styles.empty}><BookOpen size={24} /><strong>Help is being prepared for this screen.</strong></div>
                )}
              </article>
            </div>
          ) : null}
      </aside>
    </>
  );
}