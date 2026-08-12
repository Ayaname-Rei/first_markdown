import DOMPurify from 'dompurify';
import katex from 'katex';
import { marked } from 'marked';

marked.setOptions({
  gfm: true,
  breaks: true,
});

const MATH_TOKEN = 'INKSPACE_MATH_TOKEN_';
const BLOCK_TOKEN = 'INKSPACE_BLOCK_TOKEN_';

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function renderFormula(source, displayMode = false) {
  const formula = String(source || '').trim();
  if (!formula) return '';
  try {
    return katex.renderToString(formula, { displayMode, output: 'mathml', throwOnError: false, strict: 'ignore' });
  } catch {
    return `<code>${escapeHtml(formula)}</code>`;
  }
}

function replaceMath(source, blocks) {
  const parts = String(source || '').split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g);
  return parts.map((part, index) => {
    if (index % 2 === 1) return part;
    let next = part.replace(/^\s*\$\$\s*\r?\n([\s\S]*?)\r?\n\s*\$\$\s*$/gm, (_match, formula) => {
      const token = `${BLOCK_TOKEN}${blocks.length}__`;
      blocks.push({ token, html: `<div class="math-block" aria-label="数学公式">${renderFormula(formula, true)}</div>` });
      return `\n\n${token}\n\n`;
    });
    next = next.replace(/(?<!\\)\$(?!\$)([^$\n]+?)(?<!\\)\$(?!\$)/g, (_match, formula) => {
      const token = `${MATH_TOKEN}${blocks.length}__`;
      blocks.push({ token, html: `<span class="math-inline" aria-label="数学公式">${renderFormula(formula)}</span>` });
      return token;
    });
    return next;
  }).join('');
}

function replaceFrontmatter(source, blocks) {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (!match) return source;
  const rows = match[1].split(/\r?\n/).map((line) => {
    const separator = line.indexOf(':');
    if (separator < 1) return '';
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    return key ? `<div><span>${escapeHtml(key)}</span><code>${escapeHtml(value)}</code></div>` : '';
  }).filter(Boolean).join('');
  const token = `${BLOCK_TOKEN}${blocks.length}__`;
  blocks.push({ token, html: `<section class="markdown-frontmatter" aria-label="文档属性">${rows}</section>` });
  return `${token}\n\n${source.slice(match[0].length)}`;
}

function replaceCallouts(source, blocks) {
  const lines = String(source || '').split(/\r?\n/);
  const output = [];
  for (let index = 0; index < lines.length;) {
    const header = /^>\s*\[!([A-Za-z]+)\]([+-])?\s*(.*)$/.exec(lines[index]);
    if (!header) {
      output.push(lines[index]);
      index += 1;
      continue;
    }
    const body = [];
    index += 1;
    while (index < lines.length && /^>\s?/.test(lines[index])) {
      body.push(lines[index].replace(/^>\s?/, ''));
      index += 1;
    }
    const type = header[1].toLowerCase();
    const title = header[3] || type[0].toUpperCase() + type.slice(1);
    const allowedTypes = new Set(['note', 'info', 'tip', 'success', 'important', 'warning', 'caution', 'quote', 'example']);
    const safeType = allowedTypes.has(type) ? type : 'note';
    const bodyHtml = renderMarkdown(body.join('\n'));
    const token = `${BLOCK_TOKEN}${blocks.length}__`;
    blocks.push({ token, html: `<aside class="markdown-callout callout-${safeType}" data-callout="${safeType}"><strong>${escapeHtml(title)}</strong><div>${bodyHtml}</div></aside>` });
    output.push(token, '');
  }
  return output.join('\n');
}

function replaceFootnotes(source, blocks) {
  const definitions = new Map();
  const withoutDefinitions = String(source || '').replace(/^\[\^([^\]]+)\]:\s*(.+)$/gm, (_match, id, text) => {
    definitions.set(id, text.trim());
    return '';
  });
  if (!definitions.size) return withoutDefinitions;
  let body = withoutDefinitions;
  const used = [];
  body = body.replace(/\[\^([^\]]+)\]/g, (_match, id) => {
    if (!definitions.has(id)) return _match;
    const number = used.indexOf(id) >= 0 ? used.indexOf(id) + 1 : used.push(id);
    const token = `${MATH_TOKEN}footnote_${id}__`;
    blocks.push({ token, html: `<sup class="footnote-ref"><a href="#fn-${escapeHtml(id)}">[${number}]</a></sup>` });
    return token;
  });
  const items = used.map((id) => `<li id="fn-${escapeHtml(id)}">${escapeHtml(definitions.get(id))}</li>`).join('');
  if (items) {
    const token = `${BLOCK_TOKEN}${blocks.length}__`;
    blocks.push({ token, html: `<section class="markdown-footnotes" aria-label="脚注"><ol>${items}</ol></section>` });
    body += `\n\n${token}`;
  }
  return body;
}

function replaceWikiLinks(source) {
  const parts = String(source || '').split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g);
  return parts.map((part, index) => {
    if (index % 2 === 1) return part;
    return part.replace(/\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g, (_match, target, label) => {
      const page = String(target || '').trim();
      const text = String(label || page).trim();
      if (!page) return _match;
      return `<a class="wiki-link" href="#page-${encodeURIComponent(page)}" title="本地页面链接">${escapeHtml(text)}</a>`;
    });
  }).join('');
}

function prepareMarkdown(markdown) {
  const blocks = [];
  let source = replaceFrontmatter(String(markdown || ''), blocks);
  source = replaceCallouts(source, blocks);
  source = replaceFootnotes(source, blocks);
  source = replaceWikiLinks(source);
  source = replaceMath(source, blocks);
  return { source, blocks };
}

export function renderMarkdown(markdown) {
  const prepared = prepareMarkdown(markdown);
  let raw = marked.parse(prepared.source);
  prepared.blocks.forEach(({ token, html }) => {
    raw = raw.replaceAll(`<p>${token}</p>`, html).replaceAll(token, html);
  });
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [
      'a', 'annotation', 'aside', 'b', 'blockquote', 'br', 'code', 'del', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
      'i', 'input', 'kbd', 'li', 'mark', 'math', 'menclose', 'mfrac', 'mi', 'mmultiscripts', 'mn', 'mo', 'mover', 'mpadded', 'mroot', 'mrow', 'ms', 'mspace', 'msqrt', 'mstyle', 'msub', 'msubsup', 'msup', 'mtable', 'mtd', 'mtext', 'mtr', 'munder', 'munderover', 'none', 'ol', 'p', 'pre', 's', 'section', 'semantics', 'span', 'strong', 'sup',
      'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul',
    ],
    ALLOWED_ATTR: ['accent', 'accentunder', 'aria-label', 'checked', 'class', 'colspan', 'data-callout', 'display', 'disabled', 'encoding', 'href', 'id', 'mathvariant', 'rowspan', 'separator', 'start', 'stretchy', 'title', 'type', 'xmlns'],
    FORBID_ATTR: ['background', 'src', 'srcset', 'style'],
  });
}
