'use client';

import { useEffect, useId, useState } from 'react';
import { Color } from '@tiptap/extension-color';
import { FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Braces,
  Eraser,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Underline,
  Undo2,
  Unlink,
} from 'lucide-react';
import styles from './RichTextEditor.module.css';

const fonts = [
  ['Default', ''],
  ['Arial', 'Arial, sans-serif'],
  ['Georgia', 'Georgia, serif'],
  ['Helvetica', 'Helvetica, Arial, sans-serif'],
  ['Times New Roman', "'Times New Roman', serif"],
  ['Verdana', 'Verdana, sans-serif'],
] as const;
const sizes = ['', '12px', '14px', '16px', '18px', '20px', '24px', '30px', '36px'];

export function RichTextEditor({ value, onChange, label, minHeight = 150, maxLength = 20_000 }: {
  value: string;
  onChange: (html: string) => void;
  label: string;
  minHeight?: number;
  maxLength?: number;
}) {
  const labelId = useId();
  const [sourceMode, setSourceMode] = useState(false);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true, defaultProtocol: 'https' } }),
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: value,
    editorProps: { attributes: { 'aria-labelledby': labelId, class: styles.content } },
    onUpdate: ({ editor: activeEditor }) => onChange(activeEditor.getHTML().slice(0, maxLength)),
  });

  useEffect(() => {
    if (editor && value !== editor.getHTML()) editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  if (!editor) return null;
  const command = (action: () => void) => (event: React.MouseEvent) => {
    event.preventDefault();
    action();
  };
  const toolbarButton = (title: string, icon: React.ReactNode, action: () => void, active = false, disabled = false) => (
    <button type="button" title={title} aria-label={title} aria-pressed={active || undefined} disabled={disabled} onMouseDown={command(action)}>{icon}</button>
  );
  const setLink = () => {
    const current = editor.getAttributes('link').href as string | undefined;
    const href = window.prompt('Link URL', current ?? 'https://');
    if (href === null) return;
    if (!href.trim()) editor.chain().focus().unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
  };

  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <span id={labelId}>{label}</span>
        <button className={styles.sourceToggle} type="button" onClick={() => setSourceMode(current => !current)} aria-pressed={sourceMode}>
          <Braces size={13} /> {sourceMode ? 'Visual editor' : 'HTML source'}
        </button>
      </div>
      {sourceMode ? (
        <textarea className={styles.source} value={value} maxLength={maxLength} rows={8} onChange={event => onChange(event.target.value)} aria-labelledby={labelId} />
      ) : (
        <div className={styles.editor}>
          <div className={styles.toolbar} role="toolbar" aria-label={`${label} formatting`}>
            <div className={styles.group}>
              {toolbarButton('Undo', <Undo2 size={15} />, () => editor.chain().focus().undo().run(), false, !editor.can().undo())}
              {toolbarButton('Redo', <Redo2 size={15} />, () => editor.chain().focus().redo().run(), false, !editor.can().redo())}
            </div>
            <select aria-label="Text style" value={editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : editor.isActive('heading', { level: 4 }) ? 'h4' : 'p'} onChange={event => {
              const style = event.target.value;
              if (style === 'p') editor.chain().focus().setParagraph().run();
              else editor.chain().focus().toggleHeading({ level: Number(style.slice(1)) as 2 | 3 | 4 }).run();
            }}><option value="p">Paragraph</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option><option value="h4">Heading 4</option></select>
            <select aria-label="Font family" value={editor.getAttributes('textStyle').fontFamily ?? ''} onChange={event => event.target.value ? editor.chain().focus().setFontFamily(event.target.value).run() : editor.chain().focus().unsetFontFamily().run()}>{fonts.map(([name, font]) => <option key={name} value={font}>{name}</option>)}</select>
            <select aria-label="Font size" value={editor.getAttributes('textStyle').fontSize ?? ''} onChange={event => event.target.value ? editor.chain().focus().setFontSize(event.target.value).run() : editor.chain().focus().unsetFontSize().run()}><option value="">Size</option>{sizes.slice(1).map(size => <option key={size} value={size}>{size.replace('px', '')}</option>)}</select>
            <div className={styles.group}>
              {toolbarButton('Bold', <Bold size={15} />, () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'))}
              {toolbarButton('Italic', <Italic size={15} />, () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'))}
              {toolbarButton('Underline', <Underline size={15} />, () => editor.chain().focus().toggleUnderline().run(), editor.isActive('underline'))}
              {toolbarButton('Strikethrough', <Strikethrough size={15} />, () => editor.chain().focus().toggleStrike().run(), editor.isActive('strike'))}
            </div>
            <label className={styles.textColour} title="Text colour"><span style={{ backgroundColor: editor.getAttributes('textStyle').color ?? '#17201c' }} /><input type="color" value={editor.getAttributes('textStyle').color ?? '#17201c'} onChange={event => editor.chain().focus().setColor(event.target.value).run()} aria-label="Text colour" /></label>
            <div className={styles.group}>
              {toolbarButton('Align left', <AlignLeft size={15} />, () => editor.chain().focus().setTextAlign('left').run(), editor.isActive({ textAlign: 'left' }))}
              {toolbarButton('Align centre', <AlignCenter size={15} />, () => editor.chain().focus().setTextAlign('center').run(), editor.isActive({ textAlign: 'center' }))}
              {toolbarButton('Align right', <AlignRight size={15} />, () => editor.chain().focus().setTextAlign('right').run(), editor.isActive({ textAlign: 'right' }))}
              {toolbarButton('Justify', <AlignJustify size={15} />, () => editor.chain().focus().setTextAlign('justify').run(), editor.isActive({ textAlign: 'justify' }))}
            </div>
            <div className={styles.group}>
              {toolbarButton('Bulleted list', <List size={15} />, () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'))}
              {toolbarButton('Numbered list', <ListOrdered size={15} />, () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'))}
              {toolbarButton('Quote', <Quote size={15} />, () => editor.chain().focus().toggleBlockquote().run(), editor.isActive('blockquote'))}
            </div>
            <div className={styles.group}>
              {toolbarButton('Add or edit link', <LinkIcon size={15} />, setLink, editor.isActive('link'))}
              {toolbarButton('Remove link', <Unlink size={15} />, () => editor.chain().focus().unsetLink().run(), false, !editor.isActive('link'))}
              {toolbarButton('Clear text formatting', <RemoveFormatting size={15} />, () => editor.chain().focus().unsetAllMarks().run())}
              {toolbarButton('Clear content', <Eraser size={15} />, () => editor.chain().focus().clearContent().run())}
            </div>
          </div>
          <EditorContent editor={editor} style={{ '--rich-text-min-height': `${minHeight}px` } as React.CSSProperties} />
        </div>
      )}
    </div>
  );
}
