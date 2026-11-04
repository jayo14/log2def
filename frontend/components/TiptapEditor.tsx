'use client';

import React, { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { MaterialIcon } from '@/components/ui/material-icon';

interface TiptapEditorProps {
  content: string;
  onChange: (html: string) => void;
  editable?: boolean;
}

export function TiptapEditor({ content, onChange, editable = true }: TiptapEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit, TableKit],
    content: content || '',
    editable,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[380px] p-4 text-foreground font-serif leading-relaxed text-justify',
      },
    },
  });

  // Keep editor content in sync when active section changes
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content || '', { emitUpdate: false });
    }
  }, [content, editor]);

  if (!editor) {
    return null;
  }

  const isInTable = editor.isActive('table');

  return (
    <div className="border border-border rounded-lg bg-white overflow-hidden flex flex-col flex-1 shadow-2xs">
      {/* Editor Toolbar */}
      <div className="border-b border-border bg-[#FAF9F5] px-3 py-2 flex items-center flex-wrap gap-1" role="toolbar" aria-label="Formatting toolbar">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`p-1.5 rounded transition-colors focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none ${
            editor.isActive('bold') ? 'bg-emerald-800 text-white' : 'text-zinc-700 hover:bg-zinc-200'
          }`}
          title="Bold (Ctrl+B)"
          aria-label="Bold"
        >
          <MaterialIcon name="format_bold" size={18} />
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`p-1.5 rounded transition-colors focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none ${
            editor.isActive('italic') ? 'bg-emerald-800 text-white' : 'text-zinc-700 hover:bg-zinc-200'
          }`}
          title="Italic (Ctrl+I)"
          aria-label="Italic"
        >
          <MaterialIcon name="format_italic" size={18} />
        </button>

        <span className="w-px h-4 bg-zinc-300 mx-1" aria-hidden="true" />

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className={`p-1.5 rounded transition-colors focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none ${
            editor.isActive('heading', { level: 1 }) ? 'bg-emerald-800 text-white' : 'text-zinc-700 hover:bg-zinc-200'
          }`}
          title="Chapter Heading (H1)"
          aria-label="Heading 1"
        >
          <MaterialIcon name="format_h1" size={18} />
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className={`p-1.5 rounded transition-colors focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none ${
            editor.isActive('heading', { level: 2 }) ? 'bg-emerald-800 text-white' : 'text-zinc-700 hover:bg-zinc-200'
          }`}
          title="Section Heading (H2)"
          aria-label="Heading 2"
        >
          <MaterialIcon name="format_h2" size={18} />
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className={`p-1.5 rounded transition-colors focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none ${
            editor.isActive('heading', { level: 3 }) ? 'bg-emerald-800 text-white' : 'text-zinc-700 hover:bg-zinc-200'
          }`}
          title="Subsection Heading (H3)"
          aria-label="Heading 3"
        >
          <MaterialIcon name="format_h3" size={18} />
        </button>

        <span className="w-px h-4 bg-zinc-300 mx-1" aria-hidden="true" />

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={`p-1.5 rounded transition-colors focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none ${
            editor.isActive('bulletList') ? 'bg-emerald-800 text-white' : 'text-zinc-700 hover:bg-zinc-200'
          }`}
          title="Bullet List"
          aria-label="Bullet List"
        >
          <MaterialIcon name="format_list_bulleted" size={18} />
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`p-1.5 rounded transition-colors focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none ${
            editor.isActive('orderedList') ? 'bg-emerald-800 text-white' : 'text-zinc-700 hover:bg-zinc-200'
          }`}
          title="Numbered List"
          aria-label="Numbered List"
        >
          <MaterialIcon name="format_list_numbered" size={18} />
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          className={`p-1.5 rounded transition-colors focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none ${
            editor.isActive('blockquote') ? 'bg-emerald-800 text-white' : 'text-zinc-700 hover:bg-zinc-200'
          }`}
          title="Blockquote"
          aria-label="Blockquote"
        >
          <MaterialIcon name="format_quote" size={18} />
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          className="p-1.5 rounded text-zinc-700 hover:bg-zinc-200 focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none transition-colors"
          title="Divider Line"
          aria-label="Divider Line"
        >
          <MaterialIcon name="horizontal_rule" size={18} />
        </button>

        <span className="w-px h-4 bg-zinc-300 mx-1" aria-hidden="true" />

        {/* Table Management Commands */}
        {!isInTable ? (
          <button
            type="button"
            onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
            className="p-1.5 rounded text-zinc-700 hover:bg-zinc-200 focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none transition-colors flex items-center gap-1 text-xs"
            title="Insert Table (3x3)"
            aria-label="Insert Table"
          >
            <MaterialIcon name="table_chart" size={18} />
            <span className="hidden sm:inline font-sans text-xs">Table</span>
          </button>
        ) : (
          <div className="flex items-center gap-1 bg-emerald-50 px-1 py-0.5 rounded border border-emerald-200">
            <button
              type="button"
              onClick={() => editor.chain().focus().addRowAfter().run()}
              className="p-1 rounded text-emerald-900 hover:bg-emerald-200 text-xs font-sans"
              title="Add Row Below"
            >
              +Row
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().addColumnAfter().run()}
              className="p-1 rounded text-emerald-900 hover:bg-emerald-200 text-xs font-sans"
              title="Add Column Right"
            >
              +Col
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().deleteRow().run()}
              className="p-1 rounded text-red-700 hover:bg-red-100 text-xs font-sans"
              title="Delete Row"
            >
              -Row
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().deleteColumn().run()}
              className="p-1 rounded text-red-700 hover:bg-red-100 text-xs font-sans"
              title="Delete Column"
            >
              -Col
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().deleteTable().run()}
              className="p-1 rounded text-red-700 hover:bg-red-100 text-xs font-sans"
              title="Remove Table"
            >
              Del Table
            </button>
          </div>
        )}

        <span className="w-px h-4 bg-zinc-300 mx-1" aria-hidden="true" />

        <button
          type="button"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          className="p-1.5 rounded text-zinc-700 hover:bg-zinc-200 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none transition-colors"
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
        >
          <MaterialIcon name="undo" size={18} />
        </button>

        <button
          type="button"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          className="p-1.5 rounded text-zinc-700 hover:bg-zinc-200 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:outline-none transition-colors"
          title="Redo (Ctrl+Y)"
          aria-label="Redo"
        >
          <MaterialIcon name="redo" size={18} />
        </button>
      </div>

      {/* Editor Content Area */}
      <div className="flex-1 overflow-y-auto bg-white">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
