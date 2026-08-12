import React, { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { Check, Pencil, X } from 'lucide-react';
import katex from 'katex';

function renderFormula(formula, displayMode) {
  try {
    return katex.renderToString(String(formula || ''), {
      displayMode,
      output: 'mathml',
      strict: 'ignore',
      throwOnError: false,
    });
  } catch {
    return String(formula || '');
  }
}

function FormulaNodeView({ node, updateAttributes }) {
  const displayMode = node.type.name === 'blockMath';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.attrs.formula || '');
  const inputRef = useRef(null);

  useEffect(() => {
    setDraft(node.attrs.formula || '');
  }, [node.attrs.formula]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function commit() {
    const formula = draft.trim();
    if (formula) updateAttributes({ formula });
    setEditing(false);
  }

  function cancel() {
    setDraft(node.attrs.formula || '');
    setEditing(false);
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
    if (event.key === 'Enter' && (!displayMode || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      commit();
    }
  }

  const className = `live-math-node ${displayMode ? 'live-math-block-node' : 'live-math-inline-node'}`;
  const Wrapper = displayMode ? 'div' : 'span';

  if (editing) {
    return (
      <NodeViewWrapper as={Wrapper} className={className} contentEditable={false}>
        <span className={`live-math-editor ${displayMode ? 'live-math-block-editor' : ''}`}>
          {displayMode ? <textarea ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleKeyDown} aria-label='编辑块级公式' rows={Math.min(6, Math.max(2, draft.split(/\r?\n/).length))} /> : <input ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleKeyDown} aria-label='编辑行内公式' />}
          <span className='live-math-draft-preview' aria-label='公式实时预览' dangerouslySetInnerHTML={{ __html: renderFormula(draft, displayMode) }} />
          <span className='live-math-editor-actions'>
            <button type='button' onMouseDown={(event) => event.preventDefault()} onClick={commit} title='应用公式' aria-label='应用公式'><Check size={14} /></button>
            <button type='button' onMouseDown={(event) => event.preventDefault()} onClick={cancel} title='取消编辑' aria-label='取消编辑'><X size={14} /></button>
          </span>
        </span>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as={Wrapper}
      className={className}
      contentEditable={false}
      title='点击编辑公式'
      role='button'
      tabIndex={0}
      onClick={(event) => { event.preventDefault(); setEditing(true); }}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setEditing(true); } }}
    >
      <span className='live-math-render' dangerouslySetInnerHTML={{ __html: renderFormula(node.attrs.formula, displayMode) }} />
      <Pencil className='live-math-edit-icon' size={12} aria-hidden='true' />
    </NodeViewWrapper>
  );
}

function inlineTokenizer(src) {
  const match = /^\$(?!\$)([^$\r\n]+?)\$(?!\$)/.exec(src);
  if (!match) return undefined;
  return { type: 'inlineMath', raw: match[0], text: match[1], formula: match[1] };
}

export const InlineMath = Node.create({
  name: 'inlineMath',
  priority: 1100,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { formula: { default: '' } };
  },

  parseHTML() {
    return [{ tag: 'span[data-inline-math]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-inline-math': '', 'data-formula': node.attrs.formula })];
  },

  markdownTokenName: 'inlineMath',
  parseMarkdown(token, helpers) {
    return helpers.createNode('inlineMath', { formula: token.formula || token.text || '' });
  },
  renderMarkdown(node) {
    return `$${node.attrs.formula || ''}$`;
  },
  markdownTokenizer: {
    name: 'inlineMath',
    level: 'inline',
    start(src) { return src.indexOf('$'); },
    tokenize: inlineTokenizer,
  },

  addNodeView() {
    return ReactNodeViewRenderer(FormulaNodeView, { as: 'span' });
  },
});

function blockTokenizer(src) {
  // Keep the delimiters on their own lines, matching Obsidian/KaTeX display math.
  const match = /^[ \t]{0,3}\$\$[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\$\$[ \t]*(?:\r?\n|$)/.exec(src);
  if (!match) return undefined;
  return { type: 'blockMath', raw: match[0], text: match[1], formula: match[1] };
}

export const BlockMath = Node.create({
  name: 'blockMath',
  priority: 1100,
  group: 'block',
  atom: true,
  selectable: true,
  isolating: true,

  addAttributes() {
    return { formula: { default: '' } };
  },

  parseHTML() {
    return [{ tag: 'div[data-block-math]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-block-math': '', 'data-formula': node.attrs.formula })];
  },

  markdownTokenName: 'blockMath',
  parseMarkdown(token, helpers) {
    return helpers.createNode('blockMath', { formula: token.formula || token.text || '' });
  },
  renderMarkdown(node) {
    return `$$\n${node.attrs.formula || ''}\n$$`;
  },
  markdownTokenizer: {
    name: 'blockMath',
    level: 'block',
    start: '$$',
    tokenize: blockTokenizer,
  },

  addNodeView() {
    return ReactNodeViewRenderer(FormulaNodeView, { as: 'div' });
  },
});
