const { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

const allowedRoots = new Set();
const MAX_VAULT_NODES = 10000;
const MAX_EXPORT_TEXT_LENGTH = 5 * 1024 * 1024;
const DEFAULT_PREFERENCES = {
  theme: 'dark',
  font: 'sans',
  textSize: 'normal',
  lineWidth: 'standard',
  sidebarOpen: true,
  recentVaults: [],
};

let mainWindow;
let rendererReady = false;
let closeApproved = false;
let nextOpenDocumentRequestId = 0;
const pendingOpenDocuments = [];

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function isMarkdownPath(filePath) {
  return /\.(md|markdown)$/i.test(filePath);
}

function markdownPathsFromCommandLine(commandLine) {
  if (!Array.isArray(commandLine)) return [];
  const paths = new Set();

  for (const argument of commandLine) {
    if (typeof argument !== 'string' || argument.startsWith('-') || !isMarkdownPath(argument)) continue;
    paths.add(path.resolve(argument));
  }

  return [...paths];
}

function pageChildrenFolder(filePath) {
  return path.join(path.dirname(filePath), path.basename(filePath, path.extname(filePath)));
}

function safeLeafName(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} is required.`);
  const name = value.trim();

  if (!name || name.length > 160 || name === '.' || name === '..') {
    throw new Error(`Choose a valid ${label.toLowerCase()}.`);
  }

  if (/[<>:"/\\|?*\u0000-\u001f]/.test(name)) {
    throw new Error(`${label} contains unsupported characters.`);
  }

  return name;
}

function normalizeRoot(rootPath) {
  if (typeof rootPath !== 'string' || !rootPath) throw new Error('Open a folder first.');
  return path.resolve(rootPath);
}

function assertRoot(rootPath) {
  const root = normalizeRoot(rootPath);
  if (!allowedRoots.has(root)) throw new Error('This folder was not granted to Inkspace.');
  return root;
}

function resolveInVault(rootPath, relativePath = '') {
  const root = assertRoot(rootPath);
  if (typeof relativePath !== 'string') throw new Error('Invalid file path.');

  const resolved = path.resolve(root, relativePath);
  const pathFromRoot = path.relative(root, resolved);
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(pathFromRoot)) {
    throw new Error('The requested path is outside the open folder.');
  }

  return resolved;
}

function relativeToVault(rootPath, absolutePath) {
  return path.relative(rootPath, absolutePath).split(path.sep).join('/');
}

function preferencePath() {
  return path.join(app.getPath('userData'), 'preferences.json');
}

function sanitizePreferences(value) {
  const source = value && typeof value === 'object' ? value : {};
  const theme = ['light', 'dark', 'system'].includes(source.theme) ? source.theme : DEFAULT_PREFERENCES.theme;
  const font = ['sans', 'display', 'serif'].includes(source.font) ? source.font : DEFAULT_PREFERENCES.font;
  const textSize = ['compact', 'normal', 'large'].includes(source.textSize) ? source.textSize : DEFAULT_PREFERENCES.textSize;
  const lineWidth = ['narrow', 'standard', 'wide'].includes(source.lineWidth) ? source.lineWidth : DEFAULT_PREFERENCES.lineWidth;
  const sidebarOpen = source.sidebarOpen !== false;
  const recentVaults = Array.isArray(source.recentVaults)
    ? source.recentVaults.filter((item) => typeof item === 'string' && path.isAbsolute(item)).slice(0, 8)
    : [];

  return { theme, font, textSize, lineWidth, sidebarOpen, recentVaults };
}

async function getPreferences() {
  try {
    const raw = await fs.readFile(preferencePath(), 'utf8');
    return { ...DEFAULT_PREFERENCES, ...sanitizePreferences(JSON.parse(raw)) };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

async function savePreferences(changes) {
  const current = await getPreferences();
  const next = sanitizePreferences({ ...current, ...changes });
  await fs.mkdir(path.dirname(preferencePath()), { recursive: true });
  await fs.writeFile(preferencePath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

async function rememberVault(rootPath) {
  const preferences = await getPreferences();
  const recentVaults = [rootPath, ...preferences.recentVaults.filter((item) => item !== rootPath)].slice(0, 8);
  return savePreferences({ ...preferences, recentVaults });
}

function shouldSkipDirectory(name) {
  return name === 'node_modules' || name === '.git' || name === '.obsidian' || name.startsWith('.');
}

function applyPageHierarchy(tree) {
  for (const child of tree.children || []) {
    if (child.kind === 'folder') applyPageHierarchy(child);
  }

  const pagesByStem = new Map();
  for (const child of tree.children || []) {
    if (child.kind === 'file') pagesByStem.set(path.basename(child.name, path.extname(child.name)).toLocaleLowerCase(), child);
  }

  tree.children = (tree.children || []).filter((child) => {
    if (child.kind !== 'folder') return true;
    const parentPage = pagesByStem.get(child.name.toLocaleLowerCase());
    if (!parentPage) return true;
    parentPage.children = child.children || [];
    return false;
  });

  return tree;
}

async function scanFolder(rootPath, folderPath = '', state = { count: 0 }) {
  const absoluteFolder = resolveInVault(rootPath, folderPath);
  const entries = await fs.readdir(absoluteFolder, { withFileTypes: true });
  const folders = [];
  const files = [];

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const childRelativePath = folderPath ? `${folderPath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) continue;
      state.count += 1;
      if (state.count > MAX_VAULT_NODES) throw new Error('This folder contains too many items to display.');
      folders.push(await scanFolder(rootPath, childRelativePath, state));
      continue;
    }

    if (!entry.isFile() || !isMarkdownPath(entry.name)) continue;
    state.count += 1;
    if (state.count > MAX_VAULT_NODES) throw new Error('This folder contains too many items to display.');

    const absoluteFile = resolveInVault(rootPath, childRelativePath);
    const stats = await fs.stat(absoluteFile);
    files.push({
      kind: 'file',
      name: entry.name,
      relativePath: childRelativePath,
      modifiedAt: stats.mtimeMs,
      size: stats.size,
    });
  }

  folders.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
  files.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));

  return {
    kind: 'folder',
    name: folderPath ? path.basename(folderPath) : path.basename(rootPath),
    relativePath: folderPath,
    children: [...folders, ...files],
  };
}

async function getVault(rootPath) {
  const root = assertRoot(rootPath);
  const stats = await fs.stat(root);
  if (!stats.isDirectory()) throw new Error('The selected location is not a folder.');
  return { rootPath: root, tree: applyPageHierarchy(await scanFolder(root)) };
}

async function openVaultDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Markdown folder',
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled || !result.filePaths[0]) return null;
  const rootPath = path.resolve(result.filePaths[0]);
  allowedRoots.add(rootPath);
  await rememberVault(rootPath);
  return getVault(rootPath);
}

async function openRecentVault(rootPath) {
  const root = normalizeRoot(rootPath);
  const stats = await fs.stat(root);
  if (!stats.isDirectory()) throw new Error('This folder is no longer available.');
  allowedRoots.add(root);
  await rememberVault(root);
  return getVault(root);
}

async function prepareDocumentOpen(filePath) {
  if (typeof filePath !== 'string' || !filePath) throw new Error('Choose a Markdown file to open.');
  const requestedPath = path.resolve(filePath);
  if (!isMarkdownPath(requestedPath)) throw new Error('Only Markdown files can be opened.');

  const stats = await fs.stat(requestedPath);
  if (!stats.isFile()) throw new Error('The selected item is not a file.');

  const absolutePath = await fs.realpath(requestedPath);
  const rootPath = path.dirname(absolutePath);
  allowedRoots.add(rootPath);
  await rememberVault(rootPath);

  return {
    vault: await getVault(rootPath),
    relativePath: relativeToVault(rootPath, absolutePath),
  };
}

async function openDocumentDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Markdown file',
    properties: ['openFile'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  });

  if (result.canceled || !result.filePaths[0]) return null;
  return prepareDocumentOpen(result.filePaths[0]);
}

async function saveDocumentAs(rootPath, relativePath, content) {
  const sourcePath = resolveInVault(rootPath, relativePath);
  if (!isMarkdownPath(sourcePath)) throw new Error('Only Markdown files can be saved.');
  if (typeof content !== 'string') throw new Error('Document content must be text.');

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Markdown As',
    defaultPath: sourcePath,
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    properties: ['showOverwriteConfirmation'],
  });

  if (result.canceled || !result.filePath) return null;
  const destination = path.resolve(result.filePath);
  if (!isMarkdownPath(destination)) throw new Error('Use a .md or .markdown filename.');

  await fs.writeFile(destination, content, 'utf8');
  return prepareDocumentOpen(destination);
}

async function readDocument(rootPath, relativePath) {
  const absolutePath = resolveInVault(rootPath, relativePath);
  if (!isMarkdownPath(absolutePath)) throw new Error('Only Markdown files can be opened.');
  const [content, stats] = await Promise.all([fs.readFile(absolutePath, 'utf8'), fs.stat(absolutePath)]);
  return { content, modifiedAt: stats.mtimeMs, size: stats.size };
}

async function writeDocument(rootPath, relativePath, content) {
  const absolutePath = resolveInVault(rootPath, relativePath);
  if (!isMarkdownPath(absolutePath)) throw new Error('Only Markdown files can be saved.');
  if (typeof content !== 'string') throw new Error('Document content must be text.');
  await fs.writeFile(absolutePath, content, 'utf8');
  const stats = await fs.stat(absolutePath);
  return { modifiedAt: stats.mtimeMs, size: stats.size };
}

async function createDocument(rootPath, folderPath, name, parentRelativePath = '') {
  let folder = resolveInVault(rootPath, folderPath || '');

  if (parentRelativePath) {
    const parentPath = resolveInVault(rootPath, parentRelativePath);
    const parentStats = await fs.lstat(parentPath);
    if (!parentStats.isFile() || !isMarkdownPath(parentPath)) throw new Error('A subpage must belong to a Markdown note.');
    folder = pageChildrenFolder(parentPath);
    resolveInVault(rootPath, relativeToVault(rootPath, folder));
    await fs.mkdir(folder, { recursive: true });
  }

  const folderStats = await fs.stat(folder);
  if (!folderStats.isDirectory()) throw new Error('Choose a folder for the new note.');

  const leaf = safeLeafName(name, 'file name');
  const filename = isMarkdownPath(leaf) ? leaf : `${leaf}.md`;
  const absolutePath = path.join(folder, filename);
  resolveInVault(rootPath, relativeToVault(rootPath, absolutePath));
  await fs.writeFile(absolutePath, `# ${path.basename(filename, path.extname(filename))}\n\n`, { encoding: 'utf8', flag: 'wx' });
  return { relativePath: relativeToVault(rootPath, absolutePath), name: filename };
}

async function createFolder(rootPath, folderPath, name) {
  const folder = resolveInVault(rootPath, folderPath || '');
  const folderStats = await fs.stat(folder);
  if (!folderStats.isDirectory()) throw new Error('Choose a parent folder.');

  const leaf = safeLeafName(name, 'folder name');
  const absolutePath = path.join(folder, leaf);
  resolveInVault(rootPath, relativeToVault(rootPath, absolutePath));
  await fs.mkdir(absolutePath);
  return { relativePath: relativeToVault(rootPath, absolutePath), name: leaf };
}

async function renameNode(rootPath, relativePath, nextName) {
  if (!relativePath) throw new Error('The open folder cannot be renamed from Inkspace.');
  const absolutePath = resolveInVault(rootPath, relativePath);
  const stats = await fs.lstat(absolutePath);
  const requestedName = safeLeafName(nextName, 'name');
  const name = stats.isFile() && !isMarkdownPath(requestedName)
    ? `${requestedName}${path.extname(absolutePath) || '.md'}`
    : requestedName;
  const destination = path.join(path.dirname(absolutePath), name);
  resolveInVault(rootPath, relativeToVault(rootPath, destination));
  const shouldMoveSubpages = stats.isFile() && isMarkdownPath(absolutePath);
  const oldSubpagesFolder = shouldMoveSubpages ? pageChildrenFolder(absolutePath) : null;
  const nextSubpagesFolder = shouldMoveSubpages ? pageChildrenFolder(destination) : null;

  if (oldSubpagesFolder) {
    try {
      const childFolderStats = await fs.lstat(oldSubpagesFolder);
      if (!childFolderStats.isDirectory()) throw new Error('The note subpages path is not a folder.');
      try {
        await fs.lstat(nextSubpagesFolder);
        throw new Error('A subpages folder with this name already exists.');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  await fs.rename(absolutePath, destination);
  if (oldSubpagesFolder) {
    try {
      await fs.rename(oldSubpagesFolder, nextSubpagesFolder);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return { relativePath: relativeToVault(rootPath, destination), name };
}

async function deleteNode(rootPath, relativePath) {
  if (!relativePath) throw new Error('The open folder cannot be removed from Inkspace.');
  const absolutePath = resolveInVault(rootPath, relativePath);
  const stats = await fs.lstat(absolutePath);
  await fs.rm(absolutePath, { recursive: stats.isDirectory(), force: false });
  if (stats.isFile() && isMarkdownPath(absolutePath)) {
    try {
      await fs.rm(pageChildrenFolder(absolutePath), { recursive: true, force: false });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return true;
}

function exportFilename(defaultName, extension) {
  const source = typeof defaultName === 'string' ? path.basename(defaultName) : 'Untitled';
  const stem = source.replace(/\.(md|markdown|html|pdf)$/i, '') || 'Untitled';
  return `${safeLeafName(stem, 'file name')}${extension}`;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function createExportHtml(title, contentHtml) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"><title>${escapeHtml(title)}</title><style>body{max-width:820px;margin:48px auto;padding:0 42px;color:#37352f;background:#fff;font:16px/1.7 -apple-system,BlinkMacSystemFont,"Microsoft YaHei UI","Noto Sans CJK SC",sans-serif}h1{font-size:2em;margin:0 0 .7em}h2{margin-top:1.8em}h3{margin-top:1.45em}h4,h5,h6{margin-top:1.25em}a{color:#2383e2;text-decoration:underline}blockquote{margin:1.2em 0;padding-left:1em;border-left:3px solid #d9d9d7;color:#787774}pre{overflow:auto;padding:14px;border-radius:3px;background:#f7f7f5}code{font-family:"Cascadia Mono",Consolas,monospace}table{width:100%;border-collapse:collapse}td,th{padding:7px 9px;border:1px solid #e9e9e7;text-align:left}th{background:#f7f7f5}.math-inline{display:inline-block;font-family:"Cambria Math","STIX Two Math",serif;vertical-align:-.12em}.math-block{display:block;overflow-x:auto;margin:1.25em 0;padding:.75em 1em;border:1px solid #e9e9e7;border-radius:4px;background:#f7f7f5;text-align:center}.math-block math{font-size:1.08em}.markdown-frontmatter{display:grid;gap:4px;margin:0 0 1.5em;padding:10px 12px;border:1px solid #e9e9e7;border-left:3px solid #2383e2;border-radius:4px;background:#fafaf9;font-size:12px}.markdown-frontmatter div{display:flex;gap:10px}.markdown-frontmatter span{min-width:86px;font-weight:650;color:#787774}.markdown-frontmatter code{background:transparent}.markdown-callout{margin:1.15em 0;padding:11px 13px;border:1px solid #e9e9e7;border-left:3px solid #2383e2;border-radius:4px;background:#fafaf9}.markdown-callout>strong{display:block;margin-bottom:5px;color:#2383e2;font-size:12px;text-transform:uppercase}.markdown-callout>div>:first-child{margin-top:0}.markdown-callout>div>:last-child{margin-bottom:0}.callout-tip,.callout-success{border-left-color:#54a77f}.callout-warning,.callout-caution{border-left-color:#c78635}.markdown-footnotes{margin-top:2.2em;padding-top:.8em;border-top:1px solid #e9e9e7;color:#787774;font-size:.86em}@page{size:A4;margin:18mm}@media print{body{max-width:none;margin:0;padding:0}}</style></head><body>${contentHtml}</body></html>`;
}

async function chooseExportPath(defaultName, extension, label) {
  const filename = exportFilename(defaultName, extension);
  const result = await dialog.showSaveDialog(mainWindow, {
    title: `Export ${label}`,
    defaultPath: path.join(app.getPath('documents'), filename),
    filters: [{ name: label, extensions: [extension.slice(1)] }],
  });
  return result.canceled || !result.filePath ? null : result.filePath;
}

async function exportMarkdown(defaultName, content) {
  const destination = await chooseExportPath(defaultName, '.md', 'Markdown');
  if (!destination) return null;
  await fs.writeFile(destination, String(content || ''), 'utf8');
  return destination;
}

async function exportHtml(defaultName, title, contentHtml) {
  const destination = await chooseExportPath(defaultName, '.html', 'HTML');
  if (!destination) return null;
  await fs.writeFile(destination, createExportHtml(title, contentHtml), 'utf8');
  return destination;
}

async function exportPdf(defaultName, title, contentHtml) {
  const destination = await chooseExportPath(defaultName, '.pdf', 'PDF');
  if (!destination) return null;
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      images: false,
      javascript: false,
      nodeIntegration: false,
      partition: `inkspace-export-${process.pid}-${Date.now()}`,
      sandbox: true,
      webSecurity: true,
    },
  });

  try {
    const exportSession = printWindow.webContents.session;
    exportSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    exportSession.webRequest.onBeforeRequest(
      { urls: ['file://*/*', 'http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (_details, callback) => callback({ cancel: true }),
    );
    printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    printWindow.webContents.on('will-navigate', (event) => event.preventDefault());
    printWindow.webContents.on('will-redirect', (event) => event.preventDefault());
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(createExportHtml(title, contentHtml))}`);
    const pdf = await printWindow.webContents.printToPDF({ pageSize: 'A4', preferCSSPageSize: true, printBackground: true });
    await fs.writeFile(destination, pdf);
    return destination;
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy();
  }
}

function validateExportRequest(request) {
  if (!request || typeof request !== 'object') throw new Error('Invalid export request.');
  const format = request.format;
  if (!['md', 'html', 'pdf'].includes(format)) throw new Error('Choose a supported export format.');
  const name = typeof request.name === 'string' ? request.name : 'Untitled';
  const title = typeof request.title === 'string' ? request.title : 'Untitled';
  const markdown = typeof request.markdown === 'string' ? request.markdown : '';
  const html = typeof request.html === 'string' ? request.html : '';
  if (name.length > 160 || title.length > 320 || markdown.length > MAX_EXPORT_TEXT_LENGTH || html.length > MAX_EXPORT_TEXT_LENGTH) {
    throw new Error('This document is too large to export in one operation.');
  }
  return { format, name, title, markdown, html };
}

async function exportDocument(request) {
  const payload = validateExportRequest(request);
  if (payload.format === 'md') return exportMarkdown(payload.name, payload.markdown);
  if (payload.format === 'html') return exportHtml(payload.name, payload.title, payload.html);
  return exportPdf(payload.name, payload.title, payload.html);
}

function sendCommand(command, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('inkspace:command', command, payload);
}

function sendOpenDocument(request) {
  if (rendererReady && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('inkspace:open-document', request);
    return;
  }
  pendingOpenDocuments.push(request);
}

async function queueOpenDocument(filePath) {
  try {
    const request = {
      id: ++nextOpenDocumentRequestId,
      ...(await prepareDocumentOpen(filePath)),
    };
    sendOpenDocument(request);
  } catch (error) {
    if (rendererReady) sendCommand('open-document-error', error.message || 'Could not open this file.');
  }
}

function queueMarkdownPaths(commandLine) {
  for (const filePath of markdownPathsFromCommandLine(commandLine)) {
    void queueOpenDocument(filePath);
  }
}

async function openDefaultAppSettings() {
  if (process.platform !== 'win32') throw new Error('Default app settings are only available on Windows.');
  await shell.openExternal('ms-settings:defaultapps');
  return true;
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createApplicationMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: '文件',
      submenu: [
        { label: '打开 Markdown 文件...', accelerator: 'Ctrl+O', click: () => sendCommand('open-file') },
        { label: '打开文件夹...', accelerator: 'Ctrl+Shift+O', click: () => sendCommand('open-folder') },
        { label: '新建页面', accelerator: 'Ctrl+N', click: () => sendCommand('new-note') },
        { label: '新建文件夹', accelerator: 'Ctrl+Shift+N', click: () => sendCommand('new-folder') },
        { type: 'separator' },
        { label: '保存', accelerator: 'Ctrl+S', click: () => sendCommand('save') },
        { label: '另存为...', accelerator: 'Ctrl+Shift+S', click: () => sendCommand('save-as') },
        { label: '在资源管理器中显示', click: () => sendCommand('reveal-active-document') },
        { type: 'separator' },
        { label: '导出 Markdown...', accelerator: 'Ctrl+Shift+E', click: () => sendCommand('export-markdown') },
        { label: '导出 HTML...', click: () => sendCommand('export-html') },
        { label: '导出 PDF...', click: () => sendCommand('export-pdf') },
        { type: 'separator' },
        { label: '设置 Markdown 默认应用...', click: () => sendCommand('open-default-app-settings') },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: '编辑',
      submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
    },
    {
      label: '视图',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  const entryPath = path.join(__dirname, '..', 'dist', 'index.html');
  const entryUrl = pathToFileURL(entryPath).href;
  const windowIcon = app.isPackaged ? undefined : path.join(__dirname, '..', 'build', 'icon.ico');
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#191919',
    icon: windowIcon,
    show: false,
    title: 'Inkspace',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  closeApproved = false;
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.on('did-start-loading', () => {
    rendererReady = false;
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== entryUrl) event.preventDefault();
  });
  mainWindow.webContents.on('will-redirect', (event) => event.preventDefault());
  mainWindow.on('close', (event) => {
    if (closeApproved || !rendererReady) return;
    event.preventDefault();
    mainWindow.webContents.send('inkspace:request-close');
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererReady = false;
  });
  mainWindow.loadFile(entryPath);
}

app.on('second-instance', (_event, commandLine) => {
  focusMainWindow();
  queueMarkdownPaths(commandLine);
});

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  void queueOpenDocument(filePath);
});

if (hasSingleInstanceLock) app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.inkspace.local');
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (_details, callback) => callback({ cancel: true }),
  );
  createApplicationMenu();

  ipcMain.handle('vault:select', openVaultDialog);
  ipcMain.handle('vault:open-recent', (_event, rootPath) => openRecentVault(rootPath));
  ipcMain.handle('vault:list', (_event, rootPath) => getVault(rootPath));
  ipcMain.handle('document:select', openDocumentDialog);
  ipcMain.handle('vault:read-document', (_event, rootPath, relativePath) => readDocument(rootPath, relativePath));
  ipcMain.handle('vault:write-document', (_event, rootPath, relativePath, content) => writeDocument(rootPath, relativePath, content));
  ipcMain.handle('document:save-as', (_event, rootPath, relativePath, content) => saveDocumentAs(rootPath, relativePath, content));
  ipcMain.handle('vault:create-document', (_event, rootPath, folderPath, name, parentRelativePath) => createDocument(rootPath, folderPath, name, parentRelativePath));
  ipcMain.handle('vault:create-folder', (_event, rootPath, folderPath, name) => createFolder(rootPath, folderPath, name));
  ipcMain.handle('vault:rename-node', (_event, rootPath, relativePath, name) => renameNode(rootPath, relativePath, name));
  ipcMain.handle('vault:delete-node', (_event, rootPath, relativePath) => deleteNode(rootPath, relativePath));
  ipcMain.handle('document:export', (_event, request) => exportDocument(request));
  ipcMain.handle('vault:reveal', (_event, rootPath, relativePath) => shell.showItemInFolder(resolveInVault(rootPath, relativePath)));
  ipcMain.handle('app:open-default-app-settings', openDefaultAppSettings);
  ipcMain.handle('app:complete-close', () => {
    closeApproved = true;
    mainWindow?.close();
    return true;
  });
  ipcMain.on('app:renderer-ready', () => {
    rendererReady = true;
    while (pendingOpenDocuments.length) {
      const request = pendingOpenDocuments.shift();
      sendOpenDocument(request);
    }
  });
  ipcMain.handle('preferences:get', getPreferences);
  ipcMain.handle('preferences:save', (_event, changes) => savePreferences(changes));

  createWindow();
  queueMarkdownPaths(process.argv);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
