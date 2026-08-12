const now = () => Date.now();

export const makePage = (overrides = {}) => {
  const createdAt = now();

  return {
    id: crypto.randomUUID(),
    title: 'Untitled',
    icon: '+',
    content: '',
    parentId: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
};

const lines = (items) => items.join('\n');

export const starterWorkspace = () => {
  const welcome = makePage({
    id: 'welcome',
    title: 'Welcome to Inkspace',
    icon: '*',
    content: lines([
      'A calm Markdown workspace for the current session. Nothing is saved to browser storage or sent to a server.',
      '',
      '## Start here',
      '',
      '- Create a page from the left sidebar, or press Ctrl / Cmd + N.',
      '- Type a slash for the block menu.',
      '- Type a hash, dash, 1., quote, or [] to turn a line into a block.',
      '- Use the toolbar for rich text, links and tasks.',
      '- Export a Markdown file when you want to keep a page.',
      '',
      '> This session is temporary. Download a Markdown file before closing the app.',
      '',
      '## A short checklist',
      '',
      '- [x] Write your first thought',
      '- [ ] Name a page',
      '- [ ] Try the preview mode',
      '',
      '---',
      '',
      'Use the display settings in the right panel to find a comfortable font and page width.',
    ]),
  });
  const notes = makePage({
    id: 'notes',
    title: 'Scratch notes',
    icon: '~',
    content: lines([
      'A place for fragments before they become something larger.',
      '',
      '- Ideas',
      '- Reading notes',
      '- Small reminders',
    ]),
  });
  const reading = makePage({
    id: 'reading',
    title: 'Reading list',
    icon: '=',
    parentId: notes.id,
    content: lines([
      '- [ ] Add a book you are reading',
      '- [ ] Save one useful idea',
    ]),
  });
  const projects = makePage({
    id: 'projects',
    title: 'Projects',
    icon: 'o',
    content: lines([
      '## This week',
      '',
      '- [ ] Define one next action',
      '- [ ] Finish one meaningful piece of work',
    ]),
  });

  return {
    pages: [welcome, notes, reading, projects],
    activePageId: welcome.id,
    settings: {
      font: 'sans',
      width: 'standard',
      theme: 'light',
      smallText: false,
    },
  };
};

export function workspaceFilename(title) {
  const sanitized = title
    .trim()
    .replace(/[\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80);

  return (sanitized || 'untitled') + '.md';
}
