import React, { lazy, Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import UnderlineExtension from '@tiptap/extension-underline';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import {
  AlignLeft,
  Bold,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Columns2,
  Copy,
  Download,
  Eye,
  File,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Link2,
  List,
  ListChecks,
  Minus,
  ListOrdered,
  Menu,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  Quote,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Sigma,
  SlidersHorizontal,
  Strikethrough,
  Sun,
  Table2,
  Trash2,
  Underline,
  X,
} from 'lucide-react';
import { countWords, extractHeadings } from './markdown-meta';
import { BlockMath, InlineMath } from './live-math';
import './styles.css';

const LazyMarkdownPreview = lazy(() => import('./markdown-preview'));

const DEFAULT_PREFERENCES = {
  theme: 'dark',
  font: 'sans',
  textSize: 'normal',
  lineWidth: 'standard',
  sidebarOpen: true,
  recentVaults: [],
};

const SLASH_COMMANDS = [
  { id: 'text', label: '文本', detail: '普通段落', icon: AlignLeft },
  { id: 'heading', label: '标题', detail: '二级标题', icon: Heading2 },
  { id: 'bullets', label: '无序列表', detail: '项目列表', icon: List },
  { id: 'numbered', label: '有序列表', detail: '步骤列表', icon: ListOrdered },
  { id: 'tasks', label: '待办清单', detail: '可勾选项目', icon: ListChecks },
  { id: 'quote', label: '引用', detail: '引用内容', icon: Quote },
  { id: 'code', label: '代码块', detail: '代码片段', icon: Code2 },
  { id: 'inline-code', label: '行内代码', detail: '突出显示一小段代码', icon: Code2 },
  { id: 'math', label: '数学公式', detail: '插入块级 LaTeX 公式', icon: Sigma },
  { id: 'rule', label: '分隔线', detail: '插入一条水平分隔线', icon: Minus },
  { id: 'table', label: '表格', detail: '三列三行表格', icon: Table2 },
];

const CODE_BLOCK_LANGUAGES = [
  ['', '纯文本'],
  ['javascript', 'JavaScript'],
  ['typescript', 'TypeScript'],
  ['jsx', 'JSX'],
  ['tsx', 'TSX'],
  ['json', 'JSON'],
  ['html', 'HTML'],
  ['css', 'CSS'],
  ['markdown', 'Markdown'],
  ['bash', 'Bash'],
  ['python', 'Python'],
  ['java', 'Java'],
  ['c', 'C'],
  ['cpp', 'C++'],
  ['csharp', 'C#'],
  ['sql', 'SQL'],
  ['yaml', 'YAML'],
  ['xml', 'XML'],
  ['mermaid', 'Mermaid'],
  ['latex', 'LaTeX'],
];

const desktop = typeof window !== 'undefined' ? window.inkspace : undefined;

function classNames(...values) {
  return values.filter(Boolean).join(' ');
}

function fileStem(relativePath) {
  const leaf = (relativePath || '').split('/').pop() || 'Untitled';
  return leaf.replace(/\.(md|markdown)$/i, '');
}

function parentPath(relativePath) {
  const parts = (relativePath || '').split('/');
  parts.pop();
  return parts.join('/');
}

function pageChildrenPath(relativePath) {
  const parent = parentPath(relativePath);
  const folder = fileStem(relativePath);
  return parent ? `${parent}/${folder}` : folder;
}

function formatDate(value) {
  if (!value) return 'Not saved';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value);
}

function normalizeName(value, extension = '.md') {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /\.(md|markdown)$/i.test(trimmed) ? trimmed : trimmed + extension;
}

function pathExtension(relativePath) {
  const match = /\.(md|markdown)$/i.exec(relativePath || '');
  return match ? match[0] : '.md';
}

function normalizeViewOverrides(value) {
  const source = value && typeof value === 'object' ? value : {};
  const overrides = {};
  if (['sans', 'display', 'serif'].includes(source.font)) overrides.font = source.font;
  if (['compact', 'normal', 'large'].includes(source.textSize)) overrides.textSize = source.textSize;
  if (['narrow', 'standard', 'wide'].includes(source.lineWidth)) overrides.lineWidth = source.lineWidth;
  return overrides;
}

function readDocumentView(markdown) {
  const source = String(markdown || '');
  const match = /^<!-- inkspace:view ([^\r\n]{1,240}) -->\r?\n?/.exec(source);
  if (!match) return { content: source, viewOverrides: {} };
  try {
    const viewOverrides = normalizeViewOverrides(JSON.parse(match[1]));
    return { content: source.slice(match[0].length), viewOverrides };
  } catch {
    return { content: source, viewOverrides: {} };
  }
}

function writeDocumentView(content, viewOverrides) {
  const view = normalizeViewOverrides(viewOverrides);
  if (!Object.keys(view).length) return String(content || '');
  return `<!-- inkspace:view ${JSON.stringify(view)} -->\n${String(content || '')}`;
}

function effectiveDocumentView(document, preferences) {
  return {
    font: document?.viewOverrides?.font || preferences.font,
    textSize: document?.viewOverrides?.textSize || preferences.textSize,
    lineWidth: document?.viewOverrides?.lineWidth || preferences.lineWidth,
  };
}

function findFirstFile(node) {
  if (!node) return null;
  if (node.kind === 'file') return node;
  for (const child of node.children || []) {
    const found = findFirstFile(child);
    if (found) return found;
  }
  return null;
}

function findTreeNode(node, relativePath) {
  if (!node || !relativePath) return null;
  if (node.relativePath === relativePath) return node;
  for (const child of node.children || []) {
    const found = findTreeNode(child, relativePath);
    if (found) return found;
  }
  return null;
}

function expandAncestors(relativePath) {
  const parts = (relativePath || '').split('/');
  const paths = new Set(['']);
  let current = '';
  parts.slice(0, -1).forEach((part) => {
    current = current ? `${current}/${part}` : part;
    paths.add(current);
  });
  return paths;
}

function filterTree(node, query) {
  if (!query) return node;
  const normalized = query.toLowerCase();
  if (node.kind === 'file') {
    const children = (node.children || []).map((child) => filterTree(child, query)).filter(Boolean);
    return node.name.toLowerCase().includes(normalized) || children.length ? { ...node, children } : null;
  }
  const children = (node.children || []).map((child) => filterTree(child, query)).filter(Boolean);
  if (!node.relativePath || node.name.toLowerCase().includes(normalized) || children.length) {
    return { ...node, children };
  }
  return null;
}

function isLinkTarget(target) {
  return target instanceof Element && Boolean(target.closest('a'));
}

function blockLinkInteraction(event) {
  if (!isLinkTarget(event.target)) return false;
  event.preventDefault();
  return true;
}

function withNonCodeMarkdownParts(markdown, transform) {
  return String(markdown || '').split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g).map((part, index) => (index % 2 ? part : transform(part))).join('');
}

function mathFingerprint(value) {
  // Markdown parsers may consume escapes before punctuation. Compare formulas in that normalized form.
  return String(value || '').replace(/\\\\/g, '\\').replace(/\\_/g, '_').replace(/\\([^\w\s])/g, '$1').replace(/\s+/g, ' ').trim();
}

function preserveUnchangedMath(previousMarkdown, nextMarkdown) {
  const blockPattern = /\$\$([\s\S]*?)\$\$/g;
  const inlinePattern = /(?<!\\)\$(?!\$)([^\r\n$]+?)(?<!\\)\$(?!\$)/g;
  const originalBlocks = new Map();
  const originalInline = new Map();

  withNonCodeMarkdownParts(previousMarkdown, (part) => {
    for (const match of part.matchAll(blockPattern)) {
      const key = mathFingerprint(match[1]);
      const entries = originalBlocks.get(key) || [];
      entries.push(match[0]);
      originalBlocks.set(key, entries);
    }
    for (const match of part.matchAll(inlinePattern)) {
      const key = mathFingerprint(match[1]);
      const entries = originalInline.get(key) || [];
      entries.push(match[0]);
      originalInline.set(key, entries);
    }
    return part;
  });

  return withNonCodeMarkdownParts(nextMarkdown, (part) => {
    // The Markdown extension represents unsupported display math as a plain paragraph.
    // Restore an unchanged paragraph to its original $$ block before saving.
    const paragraphs = part.split(/(\r?\n[ \t]*\r?\n)/);
    for (let index = 0; index < paragraphs.length; index += 2) {
      const entries = originalBlocks.get(mathFingerprint(paragraphs[index]));
      if (entries?.length) paragraphs[index] = entries.shift();
    }

    return paragraphs.join('').replace(inlinePattern, (source, formula) => {
      const entries = originalInline.get(mathFingerprint(formula));
      return entries?.length ? entries.shift() : source;
    }).replace(blockPattern, (source, formula) => {
      const entries = originalBlocks.get(mathFingerprint(formula));
      return entries?.length ? entries.shift() : source;
    });
  });
}

function currentCodeBlock(editor) {
  const { selection, doc } = editor.state;
  for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
    const node = selection.$from.node(depth);
    if (node.type.name === 'codeBlock') return node;
  }
  const selectedNode = doc.nodeAt(selection.from);
  return selectedNode?.type.name === 'codeBlock' ? selectedNode : null;
}

function App() {
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [vault, setVault] = useState(null);
  const [activeDocument, setActiveDocument] = useState(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [selectedFolder, setSelectedFolder] = useState('');
  const [expandedFolders, setExpandedFolders] = useState(new Set(['']));
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [mode, setMode] = useState('live');
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [nodeMenu, setNodeMenu] = useState(null);
  const [nameDialog, setNameDialog] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState({ url: '', text: '' });
  const [saveState, setSaveState] = useState('idle');
  const [toast, setToast] = useState('');
  const [editorTick, setEditorTick] = useState(0);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const vaultRef = useRef(vault);
  const documentRef = useRef(activeDocument);
  const applyingContentRef = useRef(false);
  const saveTimerRef = useRef();
  const saveChainRef = useRef(Promise.resolve());
  const linkSelectionRef = useRef(null);
  const titleInputRef = useRef(null);
  const ignoreEditorUpdateRef = useRef(false);
  const openRequestChainRef = useRef(Promise.resolve());
  const closingRef = useRef(false);
  const fileDialogOpenRef = useRef(false);
  const vaultDialogOpenRef = useRef(false);
  const saveAsActiveRef = useRef(false);

  const activeMarkdown = activeDocument?.content || '';
  const deferredMarkdown = useDeferredValue(activeMarkdown);
  const activeView = effectiveDocumentView(activeDocument, preferences);
  const previewEnabled = mode === 'split' || mode === 'preview';
  const previewMarkdown = previewEnabled ? deferredMarkdown : '';
  const headings = useMemo(() => extractHeadings(deferredMarkdown), [deferredMarkdown]);
  const words = useMemo(() => countWords(deferredMarkdown), [deferredMarkdown]);
  const visibleTree = useMemo(() => filterTree(vault?.tree, searchQuery.trim()), [vault, searchQuery]);
  const activePageNode = useMemo(() => findTreeNode(vault?.tree, activeDocument?.relativePath), [vault, activeDocument?.relativePath]);
  const filteredSlashCommands = useMemo(
    () => SLASH_COMMANDS.filter((item) => `${item.id} ${item.label} ${item.detail}`.toLowerCase().includes(slashQuery)),
    [slashQuery],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        codeBlock: { enableTabIndentation: true, tabSize: 2 },
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
        // Keep a writable paragraph after atom nodes such as display math.
        trailingNode: { node: 'paragraph' },
      }),
      Placeholder.configure({ placeholder: 'Write, paste, or type / for blocks...' }),
      Highlight,
      UnderlineExtension,
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      InlineMath,
      BlockMath,
      Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
    ],
    content: '',
    contentType: 'markdown',
    editorProps: {
      attributes: { class: 'editor-content', spellcheck: 'true' },
      handleDOMEvents: {
        keydown: () => {
          ignoreEditorUpdateRef.current = false;
          return false;
        },
        beforeinput: () => {
          ignoreEditorUpdateRef.current = false;
          return false;
        },
        paste: () => {
          ignoreEditorUpdateRef.current = false;
          return false;
        },
        drop: () => {
          ignoreEditorUpdateRef.current = false;
          return false;
        },
        click: (_view, event) => {
          const blocked = blockLinkInteraction(event);
          if (!blocked) ignoreEditorUpdateRef.current = false;
          return blocked;
        },
        auxclick: (_view, event) => blockLinkInteraction(event),
        contextmenu: (_view, event) => blockLinkInteraction(event),
      },
    },
    onUpdate: ({ editor: updatedEditor }) => {
      if (applyingContentRef.current || ignoreEditorUpdateRef.current) return;
      const current = documentRef.current;
      const currentVault = vaultRef.current;
      if (!current || !currentVault) return;

      const content = preserveUnchangedMath(current.content, updatedEditor.getMarkdown());
      const next = { ...current, content, dirty: true };
      documentRef.current = next;
      setActiveDocument(next);
      setSaveState('pending');
      queueSave(currentVault.rootPath, current.relativePath, content, next.viewOverrides);
      setEditorTick((tick) => tick + 1);

      const selection = updatedEditor.state.selection;
      const line = selection.$from.parent.textContent.slice(0, selection.$from.parentOffset);
      const match = /\/([a-zA-Z]*)$/.exec(line);
      if (match) {
        setSlashQuery(match[1].toLowerCase());
        setSlashOpen(true);
      } else {
        setSlashOpen(false);
      }
    },
    onSelectionUpdate: () => setEditorTick((tick) => tick + 1),
  });

  useEffect(() => {
    vaultRef.current = vault;
  }, [vault]);

  useEffect(() => {
    documentRef.current = activeDocument;
  }, [activeDocument]);

  useEffect(() => {
    if (!desktop?.isDesktop) return;
    desktop.getPreferences().then((next) => setPreferences({ ...DEFAULT_PREFERENCES, ...next })).catch((error) => setToast(error.message));
  }, []);

  useEffect(() => {
    const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = preferences.theme === 'system' ? (isSystemDark ? 'dark' : 'light') : preferences.theme;
    document.documentElement.dataset.theme = theme;
  }, [preferences.theme]);

  useEffect(() => {
    document.title = activeDocument ? `${fileStem(activeDocument.relativePath)} - Inkspace` : 'Inkspace';
  }, [activeDocument]);

  useEffect(() => {
    if (!editor) return;
    const markdown = activeDocument?.content || '';
    if (editor.getMarkdown() === markdown) return;
    ignoreEditorUpdateRef.current = true;
    applyingContentRef.current = true;
    editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false });
    applyingContentRef.current = false;
  }, [activeDocument?.relativePath, activeDocument?.content, editor]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => () => {
    window.clearTimeout(saveTimerRef.current);
  }, []);

  useEffect(() => {
    if (!desktop?.onCommand) return undefined;
    return desktop.onCommand((command, payload) => {
      if (command === 'open-file') openFile();
      if (command === 'open-folder') openVault();
      if (command === 'new-note') openNameDialog('new-file', selectedFolder || parentPath(documentRef.current?.relativePath));
      if (command === 'new-folder') openNameDialog('new-folder', selectedFolder || parentPath(documentRef.current?.relativePath));
      if (command === 'save') saveCurrentDocument();
      if (command === 'save-as') saveDocumentAs();
      if (command === 'reveal-active-document') revealActiveDocument();
      if (command === 'export-markdown') exportActiveDocument('md');
      if (command === 'export-html') exportActiveDocument('html');
      if (command === 'export-pdf') exportActiveDocument('pdf');
      if (command === 'open-default-app-settings') openDefaultAppSettings();
      if (command === 'open-document-error') setToast(payload || '无法打开此 Markdown 文件。');
    });
  }, [vault, selectedFolder]);

  useEffect(() => {
    if (!desktop?.onOpenDocument) return undefined;
    return desktop.onOpenDocument((request) => {
      openRequestChainRef.current = openRequestChainRef.current
        .catch(() => undefined)
        .then(() => activateOpenedDocument(request));
    });
  }, []);

  useEffect(() => {
    if (!desktop?.onRequestClose) return undefined;
    return desktop.onRequestClose(() => {
      void finishCloseRequest();
    });
  }, []);

  useEffect(() => {
    if (desktop?.signalReady) desktop.signalReady();
  }, []);

  useEffect(() => {
    const handleShortcut = (event) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setCommandOpen(true);
        setCommandQuery('');
      }
      if (modifier && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        if (event.shiftKey) openVault();
        else openFile();
        return;
      }
      if (modifier && event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveDocumentAs();
        return;
      }
      if (modifier && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveCurrentDocument();
      }
      if (event.key === 'Escape') {
        setSearchOpen(false);
        setNodeMenu(null);
        setSlashOpen(false);
        setCommandOpen(false);
        setExportMenuOpen(false);
        setLinkDialogOpen(false);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  });

  function queueSave(rootPath, relativePath, content, viewOverrides = {}) {
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => persistDocument(rootPath, relativePath, content, viewOverrides), 650);
  }

  async function persistDocument(rootPath, relativePath, content, viewOverrides = {}) {
    if (!desktop?.writeDocument) return false;
    const operation = saveChainRef.current.then(async () => {
      try {
        setSaveState('saving');
        const result = await desktop.writeDocument(rootPath, relativePath, writeDocumentView(content, viewOverrides));
        const current = documentRef.current;
        if (vaultRef.current?.rootPath === rootPath && current?.relativePath === relativePath && current.content === content && JSON.stringify(current.viewOverrides || {}) === JSON.stringify(normalizeViewOverrides(viewOverrides))) {
          const saved = { ...current, dirty: false, modifiedAt: result.modifiedAt, size: result.size };
          documentRef.current = saved;
          setActiveDocument(saved);
          setSaveState('saved');
        }
        return true;
      } catch (error) {
        setSaveState('error');
        setToast(error.message || 'Could not save this file.');
        return false;
      }
    });
    saveChainRef.current = operation.catch(() => false);
    return operation;
  }

  async function saveCurrentDocument() {
    const current = documentRef.current;
    const currentVault = vaultRef.current;
    if (!current || !currentVault) return true;
    window.clearTimeout(saveTimerRef.current);
    return persistDocument(currentVault.rootPath, current.relativePath, current.content, current.viewOverrides);
  }

  async function flushPendingDocument() {
    return documentRef.current?.dirty ? saveCurrentDocument() : true;
  }

  async function refreshVault() {
    const currentVault = vaultRef.current;
    if (!currentVault || !desktop?.listVault) return;
    try {
      const next = await desktop.listVault(currentVault.rootPath);
      setVault(next);
    } catch (error) {
      setToast(error.message || 'Could not refresh the folder.');
    }
  }

  async function openVault() {
    if (!desktop?.selectVault) return;
    if (vaultDialogOpenRef.current) return;
    vaultDialogOpenRef.current = true;
    try {
      const next = await desktop.selectVault();
      if (!next) return;
      if (!(await flushPendingDocument())) return;
      setVault(next);
      vaultRef.current = next;
      setSelectedFolder('');
      setExpandedFolders(new Set(['']));
      const firstFile = findFirstFile(next.tree);
      if (firstFile) await openDocument(firstFile.relativePath, next, { skipSave: true });
      else {
        documentRef.current = null;
        setActiveDocument(null);
        setTitleDraft('');
      }
    } catch (error) {
      setToast(error.message || 'Could not open this folder.');
    } finally {
      vaultDialogOpenRef.current = false;
    }
  }

  async function openRecentVault(rootPath) {
    try {
      const next = await desktop.openRecentVault(rootPath);
      if (!(await flushPendingDocument())) return;
      setVault(next);
      vaultRef.current = next;
      setSelectedFolder('');
      setExpandedFolders(new Set(['']));
      const firstFile = findFirstFile(next.tree);
      if (firstFile) await openDocument(firstFile.relativePath, next, { skipSave: true });
      else {
        documentRef.current = null;
        setActiveDocument(null);
        setTitleDraft('');
      }
    } catch (error) {
      setToast(error.message || 'This folder is no longer available.');
    }
  }

  async function openDocument(relativePath, sourceVault = vaultRef.current, options = {}) {
    if (!sourceVault || !desktop?.readDocument) return false;
    const current = documentRef.current;
    if (!options.skipSave && current?.dirty && !(await flushPendingDocument())) return false;
    try {
      setSaveState('loading');
      const payload = await desktop.readDocument(sourceVault.rootPath, relativePath);
      const parsed = readDocumentView(payload.content);
      const next = { relativePath, content: parsed.content, viewOverrides: parsed.viewOverrides, modifiedAt: payload.modifiedAt, size: payload.size, dirty: false };
      documentRef.current = next;
      setActiveDocument(next);
      setTitleDraft(fileStem(relativePath));
      setExpandedFolders((previous) => new Set([...previous, ...expandAncestors(relativePath)]));
      setSelectedFolder(parentPath(relativePath));
      setSaveState('saved');
      setNodeMenu(null);
      return true;
    } catch (error) {
      setSaveState('error');
      setToast(error.message || 'Could not read this file.');
      return false;
    }
  }

  async function activateOpenedDocument(request, options = {}) {
    if (!request?.vault?.rootPath || !request?.relativePath) return false;
    if (!options.skipSave && !(await flushPendingDocument())) return false;

    const nextVault = request.vault;
    setVault(nextVault);
    vaultRef.current = nextVault;
    setSearchQuery('');
    setSelectedFolder('');
    setExpandedFolders(new Set(['']));
    return openDocument(request.relativePath, nextVault, { skipSave: true });
  }

  async function openFile() {
    if (!desktop?.selectDocument) return;
    if (fileDialogOpenRef.current) return;
    fileDialogOpenRef.current = true;
    try {
      const request = await desktop.selectDocument();
      if (!request) return;
      await activateOpenedDocument(request);
    } catch (error) {
      setToast(error.message || '无法打开此 Markdown 文件。');
    } finally {
      fileDialogOpenRef.current = false;
    }
  }

  function toggleFolder(relativePath) {
    setExpandedFolders((previous) => {
      const next = new Set(previous);
      if (next.has(relativePath)) next.delete(relativePath);
      else next.add(relativePath);
      return next;
    });
    setSelectedFolder(relativePath);
  }

  function openNameDialog(type, folderPath = '', node = null) {
    if (!vaultRef.current) {
      openVault();
      return;
    }
    setNodeMenu(null);
    setNameDialog({ type, folderPath: folderPath || '', node, value: node?.name || '' });
  }

  async function submitNameDialog(value) {
    const dialog = nameDialog;
    const currentVault = vaultRef.current;
    if (!dialog || !currentVault) return;
    const trimmed = value.trim();
    if (!trimmed) return;

    try {
      if (dialog.type === 'new-file') {
        const result = await desktop.createDocument(currentVault.rootPath, dialog.folderPath, trimmed);
        await refreshVault();
        setExpandedFolders((previous) => new Set([...previous, ...expandAncestors(result.relativePath)]));
        await openDocument(result.relativePath);
        setToast('New note created');
      }
      if (dialog.type === 'new-subpage') {
        const result = await desktop.createDocument(currentVault.rootPath, dialog.folderPath, trimmed, dialog.node.relativePath);
        await refreshVault();
        setExpandedFolders((previous) => new Set([...previous, ...expandAncestors(result.relativePath)]));
        await openDocument(result.relativePath);
        setToast('Subpage created');
      }
      if (dialog.type === 'new-folder') {
        const result = await desktop.createFolder(currentVault.rootPath, dialog.folderPath, trimmed);
        await refreshVault();
        setExpandedFolders((previous) => new Set([...previous, dialog.folderPath, result.relativePath]));
        setSelectedFolder(result.relativePath);
        setToast('New folder created');
      }
      if (dialog.type === 'rename') {
        await renameNodeOnDisk(dialog.node, trimmed);
      }
      setNameDialog(null);
    } catch (error) {
      setToast(error.message || 'That name cannot be used.');
    }
  }

  async function renameFromTitle() {
    const current = documentRef.current;
    if (!current || !titleDraft.trim()) return;
    const extension = /\.(md|markdown)$/i.exec(current.relativePath)?.[0] || '.md';
    const expectedName = normalizeName(titleDraft, extension);
    const currentName = current.relativePath.split('/').pop();
    if (expectedName === currentName) return;
    await renameNodeOnDisk({ kind: 'file', relativePath: current.relativePath, name: currentName }, titleDraft);
  }

  async function renameNodeOnDisk(node, value) {
    const currentVault = vaultRef.current;
    if (!currentVault || !node || !desktop?.renameNode) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    const current = documentRef.current;
    if (node.kind === 'file' && current?.relativePath === node.relativePath && current.dirty) {
      await saveCurrentDocument();
    }
    const extension = pathExtension(node.relativePath);
    const requestedName = node.kind === 'file' ? normalizeName(trimmed, extension) : trimmed;
    const currentName = node.relativePath.split('/').pop();
    if (requestedName === currentName) {
      if (current?.relativePath === node.relativePath) setTitleDraft(fileStem(node.relativePath));
      return;
    }
    const result = await desktop.renameNode(currentVault.rootPath, node.relativePath, requestedName);
    if (current?.relativePath === node.relativePath || (node.kind === 'file' && current?.relativePath.startsWith(pageChildrenPath(node.relativePath) + '/'))) {
      const relativePath = current.relativePath === node.relativePath
        ? result.relativePath
        : pageChildrenPath(result.relativePath) + current.relativePath.slice(pageChildrenPath(node.relativePath).length);
      const next = { ...current, relativePath };
      documentRef.current = next;
      setActiveDocument(next);
      if (current.relativePath === node.relativePath) setTitleDraft(fileStem(result.relativePath));
    }
    await refreshVault();
    setToast('Renamed');
  }

  function requestRename(node) {
    openNameDialog('rename', parentPath(node.relativePath), node);
  }

  function requestDelete(node) {
    setNodeMenu(null);
    setConfirmDialog({
      title: node.kind === 'folder' ? 'Delete folder?' : 'Delete note?',
      detail: node.kind === 'folder'
        ? 'All Markdown notes inside this folder will be removed from disk.'
        : 'This Markdown file and any nested subpages in its matching folder will be removed from disk.',
      node,
    });
  }

  async function confirmDelete() {
    const dialog = confirmDialog;
    const currentVault = vaultRef.current;
    if (!dialog || !currentVault) return;
    try {
      await desktop.deleteNode(currentVault.rootPath, dialog.node.relativePath);
      const current = documentRef.current;
      const nestedPath = dialog.node.kind === 'file' ? pageChildrenPath(dialog.node.relativePath) : dialog.node.relativePath;
      if (current && (current.relativePath === dialog.node.relativePath || current.relativePath.startsWith(nestedPath + '/'))) {
        documentRef.current = null;
        setActiveDocument(null);
        setTitleDraft('');
      }
      await refreshVault();
      setConfirmDialog(null);
      setToast('Removed from disk');
    } catch (error) {
      setToast(error.message || 'Could not remove this item.');
    }
  }

  async function exportActiveDocument(format = 'md') {
    const current = documentRef.current;
    if (!current || !desktop?.exportDocument) return;
    await saveCurrentDocument();
    try {
      const label = { md: 'Markdown', html: 'HTML', pdf: 'PDF' }[format] || 'document';
      const html = format === 'md' ? '' : (await import('./markdown')).renderMarkdown(current.content);
      const destination = await desktop.exportDocument({
        format,
        name: current.relativePath.split('/').pop(),
        title: fileStem(current.relativePath),
        markdown: writeDocumentView(current.content, current.viewOverrides),
        html,
      });
      if (destination) setToast(`${label} exported`);
    } catch (error) {
      setToast(error.message || 'Could not export this file.');
    } finally {
      setExportMenuOpen(false);
    }
  }

  async function saveDocumentAs() {
    if (saveAsActiveRef.current || !desktop?.saveDocumentAs) return;
    saveAsActiveRef.current = true;

    window.clearTimeout(saveTimerRef.current);
    try {
      if (!(await flushPendingDocument())) return;
      const current = documentRef.current;
      const currentVault = vaultRef.current;
      if (!current || !currentVault) return;
      setSaveState('saving');
      const request = await desktop.saveDocumentAs(
        currentVault.rootPath,
        current.relativePath,
        writeDocumentView(current.content, current.viewOverrides),
      );
      if (!request) {
        setSaveState(current.dirty ? 'pending' : 'saved');
        return;
      }
      await activateOpenedDocument(request, { skipSave: true });
      setToast('已另存为新文件');
    } catch (error) {
      setSaveState('error');
      setToast(error.message || '无法另存为该文件。');
    } finally {
      saveAsActiveRef.current = false;
    }
  }

  async function revealActiveDocument() {
    const current = documentRef.current;
    const currentVault = vaultRef.current;
    if (!current || !currentVault || !desktop?.reveal) return;
    try {
      await desktop.reveal(currentVault.rootPath, current.relativePath);
    } catch (error) {
      setToast(error.message || '无法在资源管理器中显示该文件。');
    }
  }

  async function openDefaultAppSettings() {
    if (!desktop?.openDefaultAppSettings) return;
    try {
      await desktop.openDefaultAppSettings();
      setToast('请在 Windows 设置中将 Inkspace 设为 .md 的默认应用。');
    } catch (error) {
      setToast(error.message || '无法打开 Windows 默认应用设置。');
    }
  }

  async function finishCloseRequest() {
    if (closingRef.current) return;
    closingRef.current = true;
    const saved = await flushPendingDocument();
    if (saved) {
      await desktop?.completeClose?.();
      return;
    }
    closingRef.current = false;
    setToast('保存失败，窗口未关闭。请修正后再试。');
  }

  async function revealNode(node) {
    if (!vaultRef.current) return;
    try {
      await desktop.reveal(vaultRef.current.rootPath, node.relativePath);
    } catch (error) {
      setToast(error.message || 'Could not reveal this item.');
    }
    setNodeMenu(null);
  }

  function updatePreferences(changes) {
    setPreferences((previous) => ({ ...previous, ...changes }));
    desktop?.savePreferences(changes).catch((error) => setToast(error.message || 'Could not save settings.'));
  }

  function updateDocumentView(changes) {
    const current = documentRef.current;
    const currentVault = vaultRef.current;
    if (!current || !currentVault) return;
    const overrides = { ...(current.viewOverrides || {}) };
    for (const [key, value] of Object.entries(changes)) {
      if (preferences[key] === value) delete overrides[key];
      else overrides[key] = value;
    }
    const next = { ...current, viewOverrides: normalizeViewOverrides(overrides), dirty: true };
    documentRef.current = next;
    setActiveDocument(next);
    setSaveState('pending');
    queueSave(currentVault.rootPath, next.relativePath, next.content, next.viewOverrides);
  }

  function runSlashCommand(command) {
    if (!editor) return;
    const selection = editor.state.selection;
    const before = selection.$from.parent.textContent.slice(0, selection.$from.parentOffset);
    const slash = /\/[a-zA-Z]*$/.exec(before);
    if (slash) {
      editor.chain().focus().deleteRange({ from: selection.from - slash[0].length, to: selection.from }).run();
    }
    const chain = editor.chain().focus();
    if (command.id === 'text') chain.setParagraph().run();
    if (command.id === 'heading') chain.setNode('heading', { level: 2 }).run();
    if (command.id === 'bullets') chain.toggleBulletList().run();
    if (command.id === 'numbered') chain.toggleOrderedList().run();
    if (command.id === 'tasks') chain.toggleTaskList().run();
    if (command.id === 'quote') chain.toggleBlockquote().run();
    if (command.id === 'code') chain.toggleCodeBlock().run();
    if (command.id === 'inline-code') chain.toggleCode().run();
    if (command.id === 'math') chain.insertContent({ type: 'blockMath', attrs: { formula: 'x^2' } }).run();
    if (command.id === 'rule') chain.setHorizontalRule().run();
    if (command.id === 'table') chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    setSlashOpen(false);
  }

  async function copyActiveCodeBlock() {
    if (!editor || !editor.isActive('codeBlock')) return;
    const codeBlock = currentCodeBlock(editor);
    if (!codeBlock) return;
    const text = codeBlock.textContent;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const fallback = document.createElement('textarea');
        fallback.value = text;
        fallback.setAttribute('readonly', '');
        fallback.style.position = 'fixed';
        fallback.style.opacity = '0';
        document.body.appendChild(fallback);
        fallback.select();
        document.execCommand('copy');
        fallback.remove();
      }
      setToast('代码已复制');
    } catch {
      setToast('复制失败，请使用 Ctrl/Cmd+C');
    }
  }

  function openLinkDialog() {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, ' ');
    const previousCharacter = from > 0 ? editor.state.doc.textBetween(from - 1, from, '') : '';
    linkSelectionRef.current = {
      from,
      to,
      selectedText,
      needsLeadingSpace: from === to && Boolean(previousCharacter) && !/\s/.test(previousCharacter),
    };
    setLinkDraft({ url: editor.getAttributes('link').href || '', text: selectedText });
    setLinkDialogOpen(true);
  }

  function insertLink() {
    if (!editor) return;
    const rawUrl = linkDraft.url.trim();
    if (!rawUrl) return;
    const href = /^(https?:\/\/|mailto:)/i.test(rawUrl) ? rawUrl : 'https://' + rawUrl;
    const selection = linkSelectionRef.current;
    const text = linkDraft.text.trim() || selection?.selectedText || href;
    const linkNode = { type: 'text', text, marks: [{ type: 'link', attrs: { href } }] };
    const chain = editor.chain().focus();
    if (selection && selection.from !== selection.to) {
      chain.insertContentAt({ from: selection.from, to: selection.to }, linkNode).run();
    } else {
      const content = selection?.needsLeadingSpace ? [{ type: 'text', text: ' ' }, linkNode] : linkNode;
      chain.insertContent(content).run();
    }
    setLinkDialogOpen(false);
    linkSelectionRef.current = null;
  }

  function removeLink() {
    if (!editor) return;
    const selection = linkSelectionRef.current;
    const chain = editor.chain().focus();
    if (selection) chain.setTextSelection({ from: selection.from, to: selection.to });
    chain.unsetLink().run();
    setLinkDialogOpen(false);
    linkSelectionRef.current = null;
  }

  function focusHeading(text) {
    if (!editor) return;
    let position = null;
    editor.state.doc.descendants((node, positionAtNode) => {
      if (node.type.name === 'heading' && node.textContent === text && position === null) {
        position = positionAtNode + 1;
        return false;
      }
      return true;
    });
    if (position !== null) editor.chain().focus().setTextSelection(position).scrollIntoView().run();
  }

  const commandItems = [
    { label: 'Open file', detail: 'Choose a local Markdown document', icon: FileText, action: openFile },
    { label: 'Open folder', detail: 'Choose a local Markdown library', icon: FolderOpen, action: openVault },
    { label: 'New note', detail: 'Create a Markdown file', icon: FilePlus2, action: () => openNameDialog('new-file', selectedFolder || parentPath(activeDocument?.relativePath)) },
    { label: 'New folder', detail: 'Create a folder in the library', icon: FolderPlus, action: () => openNameDialog('new-folder', selectedFolder || parentPath(activeDocument?.relativePath)) },
    { label: 'Save note', detail: 'Write changes to disk', icon: Save, action: saveCurrentDocument },
    { label: 'Save note as', detail: 'Write a copy to another path', icon: Save, action: saveDocumentAs },
    { label: 'Show in Explorer', detail: 'Reveal the current file', icon: Folder, action: revealActiveDocument },
    { label: 'Export Markdown', detail: 'Save a local Markdown copy', icon: Download, action: () => exportActiveDocument('md') },
    { label: 'Export HTML', detail: 'Save a local HTML document', icon: Download, action: () => exportActiveDocument('html') },
    { label: 'Export PDF', detail: 'Save a local PDF document', icon: Download, action: () => exportActiveDocument('pdf') },
    { label: 'Settings', detail: 'Theme, type and width', icon: Settings2, action: () => setSettingsOpen(true) },
  ];

  if (!desktop?.isDesktop) return <DesktopRequired />;

  return (
    <div className={classNames('desktop-app', 'font-' + activeView.font, 'text-' + activeView.textSize, 'width-' + activeView.lineWidth, !preferences.sidebarOpen && 'sidebar-collapsed', inspectorOpen && 'inspector-visible')}>
      <aside className='ribbon' aria-label='工作区控制'>
        <button className='ribbon-mark' type='button' onClick={openFile} title='打开 Markdown 文件' aria-label='打开 Markdown 文件'>I</button>
        <div className='ribbon-actions'>
          <button className='ribbon-button active' type='button' onClick={openFile} title='打开 Markdown 文件' aria-label='打开 Markdown 文件'><FileText size={19} /></button>
          <button className='ribbon-button' type='button' onClick={openVault} title='打开文件夹' aria-label='打开文件夹'><FolderOpen size={19} /></button>
          <button className='ribbon-button' type='button' onClick={() => openNameDialog('new-file', selectedFolder || parentPath(activeDocument?.relativePath))} title='新建页面' aria-label='新建页面'><FilePlus2 size={19} /></button>
          <button className='ribbon-button' type='button' onClick={() => setSearchOpen((open) => !open)} title='搜索文件' aria-label='搜索文件'><Search size={19} /></button>
          <button className='ribbon-button' type='button' onClick={() => updatePreferences({ sidebarOpen: !preferences.sidebarOpen })} title={preferences.sidebarOpen ? '收起侧栏' : '展开侧栏'} aria-label={preferences.sidebarOpen ? '收起侧栏' : '展开侧栏'}>{preferences.sidebarOpen ? <PanelLeftClose size={19} /> : <PanelLeftOpen size={19} />}</button>
        </div>
        <div className='ribbon-spacer' />
        <button className='ribbon-button' type='button' onClick={() => setSettingsOpen(true)} title='设置' aria-label='设置'><Settings2 size={19} /></button>
      </aside>

      <aside className='vault-panel'>
        <div className='vault-heading'>
          <button className='vault-name' type='button' onClick={openFile} title={vault?.rootPath || '打开 Markdown 文件'}>
            <FolderOpen size={17} />
            <span>{vault?.tree?.name || '未打开文件夹'}</span>
            <ChevronDown size={15} />
          </button>
          <button className='tree-action' type='button' onClick={() => openNameDialog('new-file', selectedFolder || parentPath(activeDocument?.relativePath))} title='新建页面' aria-label='新建页面'><FilePlus2 size={16} /></button>
          <button className='tree-action' type='button' onClick={() => openNameDialog('new-folder', selectedFolder || parentPath(activeDocument?.relativePath))} title='新建文件夹' aria-label='新建文件夹'><FolderPlus size={16} /></button>
        </div>
        <div className='vault-path' title={vault?.rootPath || ''}>{vault?.rootPath || '选择一个 Markdown 文件或文件夹开始'}</div>
        <div className='file-search'>
          <Search size={15} />
          <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder='筛选页面' aria-label='筛选页面' />
          {searchQuery && <button type='button' onClick={() => setSearchQuery('')} aria-label='清除筛选'><X size={14} /></button>}
        </div>
        <div className='tree-scroll'>
          {visibleTree ? (
            <VaultTree
              node={visibleTree}
              depth={0}
              expandedFolders={searchQuery ? new Set() : expandedFolders}
              forceExpanded={Boolean(searchQuery)}
              activePath={activeDocument?.relativePath}
              selectedFolder={selectedFolder}
              nodeMenu={nodeMenu}
              onToggleFolder={toggleFolder}
              onOpenFile={openDocument}
              onOpenMenu={(node) => setNodeMenu((current) => current?.relativePath === node.relativePath ? null : node)}
              onCreateFile={(folderPath) => openNameDialog('new-file', folderPath)}
              onCreateFolder={(folderPath) => openNameDialog('new-folder', folderPath)}
              onCreateSubpage={(node) => openNameDialog('new-subpage', parentPath(node.relativePath), node)}
              onRename={requestRename}
              onDelete={requestDelete}
              onReveal={revealNode}
            />
          ) : (
            <div className='empty-tree'><FolderSearch size={22} /><p>{vault ? '没有匹配的 Markdown 页面。' : '打开 Markdown 文件或文件夹后，这里会显示同目录页面。'}</p><button type='button' onClick={openFile}>打开 Markdown 文件</button></div>
          )}
        </div>
        <div className='vault-footer'>
          <button type='button' onClick={refreshVault} title='刷新文件夹'><RefreshCw size={14} /> 刷新</button>
          {vault && <button type='button' onClick={() => desktop.reveal(vault.rootPath, '')} title='在资源管理器中显示'><Folder size={14} /> 显示</button>}
        </div>
      </aside>

      <main className='editor-workspace'>
        {activeDocument ? (
          <>
            <header className='document-topbar'>
              <div className='document-crumb'><FileText size={16} /><span>{activeDocument.relativePath}</span></div>
              <div className='document-status'>
                <span className={classNames('save-indicator', saveState)}>{saveState === 'saving' || saveState === 'pending' ? <RefreshCw size={14} /> : saveState === 'error' ? <X size={14} /> : <Check size={14} />}{saveState === 'saving' ? '保存中' : saveState === 'pending' ? '已修改' : saveState === 'error' ? '保存失败' : '已保存'}</span>
                <ModeSwitch mode={mode} onChange={setMode} />
                <DocumentAppearanceControls view={activeView} onChange={updateDocumentView} />
                <button className='top-icon' type='button' onClick={saveCurrentDocument} title='立即保存' aria-label='立即保存'><Save size={17} /></button>
                <button className='top-icon' type='button' onClick={saveDocumentAs} title='另存为' aria-label='另存为'><Copy size={17} /></button>
                <button className='top-icon' type='button' onClick={revealActiveDocument} title='在资源管理器中显示' aria-label='在资源管理器中显示'><FolderOpen size={17} /></button>
                <div className='export-control'><button className='top-icon' type='button' onClick={() => setExportMenuOpen((open) => !open)} title='导出文档' aria-label='导出文档'><Download size={17} /></button>{exportMenuOpen && <div className='export-menu'><button type='button' onClick={() => exportActiveDocument('md')}>Markdown (.md)</button><button type='button' onClick={() => exportActiveDocument('html')}>HTML (.html)</button><button type='button' onClick={() => exportActiveDocument('pdf')}>PDF (.pdf)</button></div>}</div>
                <button className='top-icon' type='button' onClick={() => setInspectorOpen((open) => !open)} title={inspectorOpen ? '隐藏大纲' : '显示大纲'} aria-label={inspectorOpen ? '隐藏大纲' : '显示大纲'}>{inspectorOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}</button>
              </div>
            </header>
            <section className='document-shell' key={activeDocument.relativePath}>
              <div className='document-content'>
                <div className='document-heading'>
                  <div className='title-icon'><File size={20} /></div>
                  <input
                    ref={titleInputRef}
                    className='document-title'
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onBlur={renameFromTitle}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') { event.preventDefault(); titleInputRef.current?.blur(); }
                      if (event.key === 'Escape') setTitleDraft(fileStem(activeDocument.relativePath));
                    }}
                    aria-label='Document filename'
                  />
                  <div className='document-meta'><span>{words} words</span><span>Updated {formatDate(activeDocument.modifiedAt)}</span></div>
                </div>
                <EditorToolbar editor={editor} tick={editorTick} onAddLink={openLinkDialog} onCopyCode={copyActiveCodeBlock} onInteraction={() => { ignoreEditorUpdateRef.current = false; }} />
                <div className={classNames('document-body', 'mode-' + mode)}>
                  {mode !== 'preview' && <div className={classNames('editor-pane', mode === 'live' && 'live-editor-pane')}><EditorContent editor={editor} />{slashOpen && <SlashMenu commands={filteredSlashCommands} onRun={runSlashCommand} />}</div>}
                  {mode !== 'edit' && mode !== 'live' && <div className={classNames('preview-pane', mode === 'split' && 'live-preview-pane')}>
                    {mode === 'split' && <div className='live-preview-label'><Eye size={14} /><span>实时预览</span><span className='live-preview-dot' /></div>}
                    <PreviewSurface markdown={previewMarkdown} />
                  </div>}
                </div>
                <SubpageList pages={activePageNode?.children || []} onOpen={openDocument} onCreate={activePageNode ? () => openNameDialog('new-subpage', parentPath(activeDocument.relativePath), activePageNode) : null} />
              </div>
              {inspectorOpen && <Inspector headings={headings} onFocusHeading={focusHeading} document={activeDocument} />}
            </section>
          </>
        ) : (
          <WelcomeScreen preferences={preferences} onOpenFile={openFile} onOpenVault={openVault} onOpenRecent={openRecentVault} onOpenDefaultAppSettings={openDefaultAppSettings} />
        )}
      </main>

      {searchOpen && <SearchOverlay vault={vault} tree={visibleTree || vault?.tree} onOpenFile={(path) => { openDocument(path); setSearchOpen(false); }} onClose={() => setSearchOpen(false)} />}
      {commandOpen && <CommandPalette query={commandQuery} onQueryChange={setCommandQuery} commands={commandItems} onClose={() => setCommandOpen(false)} />}
      {settingsOpen && <SettingsDialog preferences={preferences} onChange={updatePreferences} onClose={() => setSettingsOpen(false)} />}
      {nameDialog && <NameDialog dialog={nameDialog} onSubmit={submitNameDialog} onClose={() => setNameDialog(null)} />}
      {confirmDialog && <ConfirmDialog dialog={confirmDialog} onConfirm={confirmDelete} onClose={() => setConfirmDialog(null)} />}
      {linkDialogOpen && <LinkDialog draft={linkDraft} onChange={setLinkDraft} onSubmit={insertLink} onRemove={removeLink} onClose={() => { setLinkDialogOpen(false); linkSelectionRef.current = null; }} />}
      {toast && <div className='toast' role='status'>{toast}</div>}
    </div>
  );
}

function DesktopRequired() {
  return (
    <main className='desktop-required'>
      <div className='desktop-required-mark'>I</div>
      <h1>请通过 Inkspace 桌面应用打开本地文件夹。</h1>
      <p>开发环境可运行 <code>npm run desktop</code>。</p>
    </main>
  );
}

function WelcomeScreen({ preferences, onOpenFile, onOpenVault, onOpenRecent, onOpenDefaultAppSettings }) {
  return (
    <section className='welcome-screen'>
      <div className='welcome-symbol'>I</div>
      <h1>本地 Markdown，直接编辑并保存。</h1>
      <p>打开单个 Markdown 文件或文件夹后，Inkspace 会直接读写磁盘上的原文件，不会上传或同步内容。</p>
      <div className='welcome-actions'><button className='primary-command' type='button' onClick={onOpenFile}><FileText size={18} /> 打开 Markdown 文件</button><button className='secondary-command' type='button' onClick={onOpenVault}><FolderOpen size={18} /> 打开文件夹</button></div>
      <button className='default-app-link' type='button' onClick={onOpenDefaultAppSettings}>将 Inkspace 设为 Markdown 默认应用</button>
      {preferences.recentVaults?.length > 0 && <div className='recent-vaults'><h2>最近打开的文件夹</h2>{preferences.recentVaults.map((rootPath) => <button key={rootPath} type='button' onClick={() => onOpenRecent(rootPath)}><Folder size={16} /><span>{rootPath}</span></button>)}</div>}
    </section>
  );
}

function VaultTree({ node, depth, expandedFolders, forceExpanded, activePath, selectedFolder, nodeMenu, onToggleFolder, onOpenFile, onOpenMenu, onCreateFile, onCreateFolder, onCreateSubpage, onRename, onDelete, onReveal }) {
  if (node.kind === 'file') {
    return <div className='tree-page-branch'><FileRow node={node} depth={depth} activePath={activePath} nodeMenu={nodeMenu} onOpenFile={onOpenFile} onOpenMenu={onOpenMenu} onCreateSubpage={onCreateSubpage} onRename={onRename} onDelete={onDelete} onReveal={onReveal} />{node.children?.length > 0 && <div className='tree-children page-children'>{node.children.map((child) => <VaultTree key={child.relativePath} node={child} depth={depth + 1} expandedFolders={expandedFolders} forceExpanded={forceExpanded} activePath={activePath} selectedFolder={selectedFolder} nodeMenu={nodeMenu} onToggleFolder={onToggleFolder} onOpenFile={onOpenFile} onOpenMenu={onOpenMenu} onCreateFile={onCreateFile} onCreateFolder={onCreateFolder} onCreateSubpage={onCreateSubpage} onRename={onRename} onDelete={onDelete} onReveal={onReveal} />)}</div>}</div>;
  }

  const isRoot = !node.relativePath;
  const expanded = forceExpanded || isRoot || expandedFolders.has(node.relativePath);
  return (
    <div className={classNames('tree-folder', isRoot && 'tree-root')}>
      {!isRoot && <div className={classNames('tree-row', selectedFolder === node.relativePath && 'selected')} style={{ '--depth': depth }}>
        <button className='tree-main folder-main' type='button' onClick={() => onToggleFolder(node.relativePath)}>
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          {expanded ? <FolderOpen size={15} /> : <Folder size={15} />}
          <span>{node.name}</span>
        </button>
        <button className='tree-more' type='button' onClick={(event) => { event.stopPropagation(); onOpenMenu(node); }} title='Folder actions' aria-label='Folder actions'><MoreHorizontal size={15} /></button>
        {nodeMenu?.relativePath === node.relativePath && <NodeMenu node={node} onNewFile={() => onCreateFile(node.relativePath)} onNewFolder={() => onCreateFolder(node.relativePath)} onNewSubpage={() => onCreateSubpage(node)} onRename={() => onRename(node)} onDelete={() => onDelete(node)} onReveal={() => onReveal(node)} />}
      </div>}
      {expanded && <div className='tree-children'>{(node.children || []).map((child) => <VaultTree key={child.relativePath} node={child} depth={isRoot ? depth : depth + 1} expandedFolders={expandedFolders} forceExpanded={forceExpanded} activePath={activePath} selectedFolder={selectedFolder} nodeMenu={nodeMenu} onToggleFolder={onToggleFolder} onOpenFile={onOpenFile} onOpenMenu={onOpenMenu} onCreateFile={onCreateFile} onCreateFolder={onCreateFolder} onCreateSubpage={onCreateSubpage} onRename={onRename} onDelete={onDelete} onReveal={onReveal} />)}</div>}
    </div>
  );
}

function FileRow({ node, depth, activePath, nodeMenu, onOpenFile, onOpenMenu, onCreateSubpage, onRename, onDelete, onReveal }) {
  return (
    <div className={classNames('tree-row', 'file-row', activePath === node.relativePath && 'active')} style={{ '--depth': depth }}>
      <button className='tree-main file-main' type='button' onClick={() => onOpenFile(node.relativePath)}><FileText size={15} /><span>{fileStem(node.name)}</span></button>
      <button className='tree-more' type='button' onClick={(event) => { event.stopPropagation(); onOpenMenu(node); }} title='File actions' aria-label='File actions'><MoreHorizontal size={15} /></button>
      {nodeMenu?.relativePath === node.relativePath && <NodeMenu node={node} onNewSubpage={() => onCreateSubpage(node)} onRename={() => onRename(node)} onDelete={() => onDelete(node)} onReveal={() => onReveal(node)} />}
    </div>
  );
}

function NodeMenu({ node, onNewFile, onNewFolder, onNewSubpage, onRename, onDelete, onReveal }) {
  return (
    <div className='node-menu'>
      {node.kind === 'folder' && <><button type='button' onClick={onNewFile}><FilePlus2 size={15} /> 新建页面</button><button type='button' onClick={onNewFolder}><FolderPlus size={15} /> 新建文件夹</button></>}
      {node.kind === 'file' && <button type='button' onClick={onNewSubpage}><FilePlus2 size={15} /> 新建子页面</button>}
      <button type='button' onClick={onRename}><Pencil size={15} /> 重命名</button>
      <button type='button' onClick={onReveal}><Folder size={15} /> 在资源管理器中显示</button>
      <button className='danger' type='button' onClick={onDelete}><Trash2 size={15} /> 删除</button>
    </div>
  );
}

function ModeSwitch({ mode, onChange }) {
  const items = [{ id: 'edit', label: '编辑', title: '普通编辑', icon: FileText }, { id: 'live', label: '实时编辑', title: '单栏实时编辑', icon: Pencil }, { id: 'split', label: '实时', title: '左右实时预览', icon: Columns2 }, { id: 'preview', label: '预览', icon: Eye }];
  return <div className='mode-switch' aria-label='编辑模式'>{items.map((item) => { const Icon = item.icon; return <button key={item.id} className={mode === item.id ? 'active' : ''} type='button' onClick={() => onChange(item.id)} title={item.title || item.label}><Icon size={15} /><span>{item.label}</span></button>; })}</div>;
}

function DocumentAppearanceControls({ view, onChange }) {
  return (
    <div className='document-appearance' aria-label='当前页面样式'>
      <label className='appearance-select' title='当前页面字体'><AlignLeft size={14} /><select value={view.font} onChange={(event) => onChange({ font: event.target.value })} aria-label='当前页面字体'><option value='sans'>规范</option><option value='display'>艺术</option><option value='serif'>衬线</option></select></label>
      <label className='appearance-select' title='当前页面字号'><SlidersHorizontal size={14} /><select value={view.textSize} onChange={(event) => onChange({ textSize: event.target.value })} aria-label='当前页面字号'><option value='compact'>紧凑</option><option value='normal'>标准</option><option value='large'>大号</option></select></label>
      <label className='appearance-select' title='当前页面宽度'><Columns2 size={14} /><select value={view.lineWidth} onChange={(event) => onChange({ lineWidth: event.target.value })} aria-label='当前页面宽度'><option value='narrow'>窄</option><option value='standard'>标准</option><option value='wide'>宽</option></select></label>
    </div>
  );
}

function EditorToolbar({ editor, tick, onAddLink, onCopyCode, onInteraction }) {
  if (!editor) return <div className='editor-toolbar' />;
  void tick;
  const codeBlockActive = editor.isActive('codeBlock');
  const activeCodeLanguage = codeBlockActive ? editor.getAttributes('codeBlock').language || '' : '';
  const codeLanguageOptions = CODE_BLOCK_LANGUAGES.some(([value]) => value === activeCodeLanguage)
    ? CODE_BLOCK_LANGUAGES
    : [[activeCodeLanguage, activeCodeLanguage], ...CODE_BLOCK_LANGUAGES];
  const tools = [
    { label: '加粗', icon: Bold, active: editor.isActive('bold'), action: () => editor.chain().focus().toggleBold().run() },
    { label: '斜体', icon: Italic, active: editor.isActive('italic'), action: () => editor.chain().focus().toggleItalic().run() },
    { label: '删除线', icon: Strikethrough, active: editor.isActive('strike'), action: () => editor.chain().focus().toggleStrike().run() },
    { label: '下划线', icon: Underline, active: editor.isActive('underline'), action: () => editor.chain().focus().toggleUnderline().run() },
    { label: '高亮', icon: Highlighter, active: editor.isActive('highlight'), action: () => editor.chain().focus().toggleHighlight().run() },
    { label: '行内代码', icon: Code2, active: editor.isActive('code'), action: () => editor.chain().focus().toggleCode().run() },
    { label: '插入公式', icon: Sigma, active: editor.isActive('inlineMath') || editor.isActive('blockMath'), action: () => editor.chain().focus().insertContent({ type: 'inlineMath', attrs: { formula: 'x^2' } }).run() },
    { label: '插入链接', icon: Link2, active: editor.isActive('link'), action: onAddLink },
    { label: '一级标题', icon: Heading1, active: editor.isActive('heading', { level: 1 }), action: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { label: '二级标题', icon: Heading2, active: editor.isActive('heading', { level: 2 }), action: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: '三级标题', icon: Heading3, active: editor.isActive('heading', { level: 3 }), action: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { label: '无序列表', icon: List, active: editor.isActive('bulletList'), action: () => editor.chain().focus().toggleBulletList().run() },
    { label: '有序列表', icon: ListOrdered, active: editor.isActive('orderedList'), action: () => editor.chain().focus().toggleOrderedList().run() },
    { label: '待办清单', icon: ListChecks, active: editor.isActive('taskList'), action: () => editor.chain().focus().toggleTaskList().run() },
    { label: '引用', icon: Quote, active: editor.isActive('blockquote'), action: () => editor.chain().focus().toggleBlockquote().run() },
    { label: '代码块', icon: Code2, active: editor.isActive('codeBlock'), action: () => editor.chain().focus().toggleCodeBlock().run() },
    { label: '分隔线', icon: Minus, active: false, action: () => editor.chain().focus().setHorizontalRule().run() },
    { label: '插入表格', icon: Table2, active: editor.isActive('table'), action: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  ];
  return (
    <div className='editor-toolbar' aria-label='Formatting tools'>
      {tools.map((tool) => { const Icon = tool.icon; return <button key={tool.label} className={classNames('tool-button', tool.active && 'active')} type='button' onClick={() => { onInteraction?.(); tool.action(); }} title={tool.label} aria-label={tool.label}><Icon size={16} /></button>; })}
      <div className={classNames('code-block-controls', codeBlockActive && 'active')} aria-label='代码块工具'>
        <label title={codeBlockActive ? '代码块语言' : '将光标置于代码块后可选择语言'}>
          <Code2 size={14} />
          <select
            value={activeCodeLanguage}
            disabled={!codeBlockActive}
            onChange={(event) => {
              onInteraction?.();
              editor.chain().focus().updateAttributes('codeBlock', { language: event.target.value || null }).run();
            }}
            aria-label='代码块语言'
          >
            {codeLanguageOptions.map(([value, label]) => <option key={value || 'plain'} value={value}>{label}</option>)}
          </select>
        </label>
        <button type='button' disabled={!codeBlockActive} onMouseDown={(event) => event.preventDefault()} onClick={() => { onInteraction?.(); onCopyCode?.(); }} title={codeBlockActive ? '复制代码' : '将光标置于代码块后复制'} aria-label='复制代码'><Copy size={14} /></button>
      </div>
    </div>
  );
}

function SlashMenu({ commands, onRun }) {
  return <div className='slash-menu' role='menu'>{commands.map((command) => { const Icon = command.icon; return <button key={command.id} type='button' onMouseDown={(event) => event.preventDefault()} onClick={() => onRun(command)}><Icon size={16} /><span><strong>{command.label}</strong><small>{command.detail}</small></span></button>; })}{!commands.length && <p>No matching blocks</p>}</div>;
}

function PreviewSurface({ markdown }) {
  return (
    <Suspense fallback={<article className='markdown-preview preview-loading' aria-busy='true'>正在加载预览...</article>}>
      <LazyMarkdownPreview markdown={markdown} />
    </Suspense>
  );
}

function SubpageList({ pages, onOpen, onCreate }) {
  if (!pages.length && !onCreate) return null;
  return (
    <section className='subpage-section' aria-label='子页面'>
      <div className='subpage-heading'><span>子页面</span>{onCreate && <button className='subpage-create' type='button' onClick={onCreate}><FilePlus2 size={15} /> 新建子页面</button>}</div>
      {pages.length > 0 && <div className='subpage-list'>{pages.map((page) => <button className='subpage-card' key={page.relativePath} type='button' onClick={() => onOpen(page.relativePath)}><FileText size={18} /><span><strong>{fileStem(page.name)}</strong><small>{page.children?.length ? `${page.children.length} 个子页面` : '点击打开'}</small></span><ChevronRight size={16} /></button>)}</div>}
    </section>
  );
}

function Inspector({ headings, onFocusHeading, document }) {
  return (
    <aside className='inspector'>
      <section><div className='inspector-title'><h2>大纲</h2><span>{headings.length}</span></div>{headings.length ? <nav className='outline-list'>{headings.map((heading, index) => <button key={`${heading.text}-${index}`} type='button' style={{ '--outline-level': heading.level }} onClick={() => onFocusHeading(heading.text)}>{heading.text}</button>)}</nav> : <p className='quiet-copy'>文档中的标题会显示在这里。</p>}</section>
      <section><div className='inspector-title'><h2>文件</h2></div><dl className='file-facts'><div><dt>路径</dt><dd title={document.relativePath}>{document.relativePath}</dd></div><div><dt>修改时间</dt><dd>{formatDate(document.modifiedAt)}</dd></div><div><dt>大小</dt><dd>{document.size ? `${Math.max(1, Math.round(document.size / 1024))} KB` : '0 KB'}</dd></div></dl></section>
    </aside>
  );
}

function SearchOverlay({ vault, tree, onOpenFile, onClose }) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => flattenFiles(tree).filter((file) => file.relativePath.toLowerCase().includes(query.toLowerCase())).slice(0, 20), [tree, query]);
  return <div className='overlay' onMouseDown={onClose}><section className='search-dialog' role='dialog' aria-modal='true' aria-label='Search files' onMouseDown={(event) => event.stopPropagation()}><div className='dialog-search'><Search size={17} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${vault?.tree?.name || 'files'}`} /><button type='button' onClick={onClose} aria-label='Close search'><X size={16} /></button></div><div className='search-result-list'>{results.map((file) => <button key={file.relativePath} type='button' onClick={() => onOpenFile(file.relativePath)}><FileText size={16} /><span>{fileStem(file.name)}<small>{file.relativePath}</small></span></button>)}{!results.length && <p>No matching Markdown files.</p>}</div></section></div>;
}

function flattenFiles(node, items = []) {
  if (!node) return items;
  if (node.kind === 'file') {
    items.push(node);
    (node.children || []).forEach((child) => flattenFiles(child, items));
  } else (node.children || []).forEach((child) => flattenFiles(child, items));
  return items;
}

function CommandPalette({ query, onQueryChange, commands, onClose }) {
  const matches = commands.filter((item) => (item.label + item.detail).toLowerCase().includes(query.toLowerCase()));
  return <div className='overlay' onMouseDown={onClose}><section className='command-dialog' role='dialog' aria-modal='true' aria-label='Command palette' onMouseDown={(event) => event.stopPropagation()}><div className='dialog-search'><Menu size={17} /><input autoFocus value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder='Search commands' /><kbd>Esc</kbd></div><div className='command-list'>{matches.map((item) => { const Icon = item.icon; return <button key={item.label} type='button' onClick={() => { item.action(); onClose(); }}><Icon size={17} /><span><strong>{item.label}</strong><small>{item.detail}</small></span></button>; })}</div></section></div>;
}

function SettingsDialog({ preferences, onChange, onClose }) {
  return <div className='overlay' onMouseDown={onClose}><section className='settings-dialog' role='dialog' aria-modal='true' aria-label='设置' onMouseDown={(event) => event.stopPropagation()}><header><h2>设置</h2><button className='top-icon' type='button' onClick={onClose} aria-label='关闭设置'><X size={17} /></button></header><section><h3>外观</h3><SettingChoice label='主题' value={preferences.theme} options={[['light', '浅色', Sun], ['dark', '深色', Moon], ['system', '跟随系统', SlidersHorizontal]]} onChange={(theme) => onChange({ theme })} /><SettingChoice label='页面字体' value={preferences.font} options={[['sans', '规范正文', AlignLeft], ['display', '艺术标题', Highlighter], ['serif', '阅读衬线', FileText]]} onChange={(font) => onChange({ font })} /><SettingChoice label='文字大小' value={preferences.textSize} options={[['compact', '紧凑', ChevronDown], ['normal', '标准', AlignLeft], ['large', '大号', ChevronRight]]} onChange={(textSize) => onChange({ textSize })} /><SettingChoice label='页面宽度' value={preferences.lineWidth} options={[['narrow', '窄', ChevronLeftIcon], ['standard', '标准', AlignLeft], ['wide', '宽', ChevronRight]]} onChange={(lineWidth) => onChange({ lineWidth })} /></section><section><h3>本地存储</h3><p className='quiet-copy'>页面正文直接保存在所打开文件夹。子页面保存在父页面同名文件夹中，例如 <code>hello.md</code> 的子页面为 <code>hello\hello_next.md</code>。</p></section></section></div>;
}

function ChevronLeftIcon(props) {
  return <ChevronRight {...props} className='mirrored-icon' />;
}

function SettingChoice({ label, value, options, onChange }) {
  return <div className='setting-choice'><span>{label}</span><div className='choice-buttons'>{options.map(([id, text, Icon]) => <button key={id} className={value === id ? 'active' : ''} type='button' onClick={() => onChange(id)} title={text}><Icon size={14} /><span>{text}</span></button>)}</div></div>;
}

function NameDialog({ dialog, onSubmit, onClose }) {
  const [value, setValue] = useState(dialog.value || '');
  const labels = { 'new-file': ['新建页面', '页面名称'], 'new-subpage': ['新建子页面', '子页面名称'], 'new-folder': ['新建文件夹', '文件夹名称'], rename: ['重命名', '名称'] };
  const [title, placeholder] = labels[dialog.type];
  return <div className='overlay' onMouseDown={onClose}><section className='name-dialog' role='dialog' aria-modal='true' aria-label={title} onMouseDown={(event) => event.stopPropagation()}><header><h2>{title}</h2><button className='top-icon' type='button' onClick={onClose} aria-label='关闭对话框'><X size={17} /></button></header><form onSubmit={(event) => { event.preventDefault(); onSubmit(value); }}><label>{placeholder}<input autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={placeholder} /></label><footer><button className='dialog-button subtle' type='button' onClick={onClose}>取消</button><button className='dialog-button primary' type='submit'>{dialog.type === 'rename' ? '重命名' : '创建'}</button></footer></form></section></div>;
}

function ConfirmDialog({ dialog, onConfirm, onClose }) {
  return <div className='overlay' onMouseDown={onClose}><section className='confirm-dialog' role='dialog' aria-modal='true' aria-label={dialog.title} onMouseDown={(event) => event.stopPropagation()}><header><h2>{dialog.title}</h2><button className='top-icon' type='button' onClick={onClose} aria-label='Close dialog'><X size={17} /></button></header><p>{dialog.detail}</p><footer><button className='dialog-button subtle' type='button' onClick={onClose}>Cancel</button><button className='dialog-button danger' type='button' onClick={onConfirm}>Delete</button></footer></section></div>;
}

function LinkDialog({ draft, onChange, onSubmit, onRemove, onClose }) {
  return <div className='overlay' onMouseDown={onClose}><section className='link-dialog' role='dialog' aria-modal='true' aria-label='Insert link' onMouseDown={(event) => event.stopPropagation()}><header><h2>Insert link</h2><button className='top-icon' type='button' onClick={onClose} aria-label='Close link dialog'><X size={17} /></button></header><form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}><label>Address<input autoFocus value={draft.url} onChange={(event) => onChange((current) => ({ ...current, url: event.target.value }))} placeholder='https://example.com' /></label><label>Text<input value={draft.text} onChange={(event) => onChange((current) => ({ ...current, text: event.target.value }))} placeholder='Visible link text' /></label><footer><button className='dialog-button subtle' type='button' onClick={onRemove}>Remove link</button><button className='dialog-button primary' type='submit'>Insert link</button></footer></form></section></div>;
}

createRoot(document.getElementById('root')).render(<App />);
