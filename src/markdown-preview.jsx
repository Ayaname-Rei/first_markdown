import React, { useMemo } from 'react';
import { renderMarkdown } from './markdown';

function blockLinkInteraction(event) {
  if (!(event.target instanceof Element) || !event.target.closest('a')) return;
  event.preventDefault();
}

export default function MarkdownPreview({ markdown }) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown]);
  return <article className='markdown-preview' dangerouslySetInnerHTML={{ __html: html }} onClick={blockLinkInteraction} onAuxClick={blockLinkInteraction} onContextMenu={blockLinkInteraction} onDragStart={blockLinkInteraction} />;
}
