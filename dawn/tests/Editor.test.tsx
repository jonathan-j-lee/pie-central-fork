import { exit } from '../app/store/editor';
import {
  act,
  delay,
  render,
  screen,
  updateSetting,
  makeCommandTriggers,
  TestEditor,
} from './test-utils';
import userEvent from '@testing-library/user-event';
// @ts-ignore
import ace from 'ace-builds/src-min-noconflict/ace';
import * as React from 'react';
import { mocked } from 'ts-jest/utils';

beforeEach(() => {
  render(<TestEditor />);
  updateSetting('runtime.host', '192.168.1.1');
  updateSetting('runtime.credentials', {
    username: 'pioneers',
    password: 'pwd',
    privateKey: '---private-key---',
  });
  updateSetting('runtime.admin.remotePath', 'teststudentcode.py');
  updateSetting('runtime.admin.restartCommand', 'systemctl restart runtime.service');
  mocked(window.ipc.invoke).mockImplementation(async (channel, ...args) => {
    let method;
    switch (channel) {
      case 'load-settings':
        throw new Error('abort load');
      case 'open-file-prompt':
        return 'test-open.py';
      case 'open-file':
        return 'opened';
      case 'save-file-prompt':
        return 'test-save.py';
      case 'save-file':
        return;
      case 'request':
        [, method] = args;
        if (method === 'lint') {
          return [
            {
              line: 1,
              column: 0,
              type: 'error',
              message: 'Lint error',
              'message-id': 'E999',
              symbol: 'lint-error',
            },
            {
              line: 1,
              column: 0,
              type: 'warning',
              message: 'Lint warning',
              'message-id': 'W999',
              symbol: 'lint-warning',
            },
            {
              line: 1,
              column: 0,
              type: 'convention',
              message: 'Lint message',
              'message-id': 'C999',
              symbol: 'lint-message',
            },
          ];
        }
    }
  });
  mocked(window.ssh.download).mockReturnValue(Promise.resolve('downloaded'));
});

describe('editor status', () => {
  it('indicates when there are unsaved changes', async () => {
    const editor = ace.edit('test-editor');
    const fileStatus = await screen.findByText(/^\(unsaved file\)$/i);
    expect(fileStatus).toBeInTheDocument();
    await act(async () => {
      editor.insert('a');
      editor.remove('left');
    });
    expect(fileStatus).toHaveTextContent(/^\(unsaved file\)\*$/i);
  });

  it('updates the cursor position', async () => {
    const editor = ace.edit('test-editor');
    const cursor = await screen.findByText('1:1');
    expect(cursor).toBeInTheDocument();
    await act(async () => editor.insert('abc'));
    expect(cursor).toHaveTextContent('1:4');
    await act(async () => editor.insert('\nd\n'));
    expect(cursor).toHaveTextContent('3:1');
    await act(async () => editor.moveCursorTo(0, 1));
    expect(cursor).toHaveTextContent('1:2');
    await act(async () => editor.insert('xyz'));
    expect(cursor).toHaveTextContent('1:5');
  });

  it('updates the current selection', async () => {
    const editor = ace.edit('test-editor');
    await act(async () => {
      editor.insert('abcd\nefgh');
      editor.find('bc');
    });
    const highlighted = await screen.findByText('(1, 2)');
    expect(highlighted).toBeInTheDocument();
    await act(async () => {
      editor.find('cd\nef');
    });
    expect(highlighted).toHaveTextContent('(2, 5)');
  });
});

describe.each(
  makeCommandTriggers({
    newFile: { menu: /^File$/, item: /^new file$/i, keybinding: '{ctrl}N' },
    openFile: { menu: /^File$/, item: /^open file$/i, keybinding: '{ctrl}O' },
    saveFile: { menu: /^File$/, item: /^save file$/i, keybinding: '{ctrl}S' },
    saveFileAs: {
      menu: /^File$/,
      item: /^save file as \.\.\.$/i,
      keybinding: '{ctrl}{shift}S',
    },
  })
)('file menu (%s)', (inputMethod, commands) => {
  it('creates a new file', async () => {
    const editor = ace.edit('test-editor');
    await act(async () => {
      updateSetting('editor.filePath', 'tmp.py');
      editor.insert('abc');
      await commands.newFile();
      userEvent.click(await screen.findByText(/^discard$/i));
    });
    expect(await screen.findByText(/^\(unsaved file\)$/i)).toBeInTheDocument();
    expect(editor.getValue()).toEqual('');
    expect(screen.queryAllByText(/created a new file/i).length).toBeGreaterThan(0);
    expect(mocked(window.ipc.invoke).mock.calls).toMatchObject([
      ['save-settings', { editor: { filePath: null } }],
    ]);
  });

  it('opens a file', async () => {
    const editor = ace.edit('test-editor');
    await act(async () => {
      await commands.openFile();
    });
    expect(await screen.findByText(/^test-open\.py$/i)).toBeInTheDocument();
    expect(editor.getValue()).toEqual('opened');
    const notifications = screen.queryAllByText(/opened the selected file/i);
    expect(notifications.length).toBeGreaterThan(0);
    expect(mocked(window.ipc.invoke).mock.calls).toMatchObject([
      ['open-file-prompt'],
      ['open-file', 'test-open.py', 'utf8'],
      ['save-settings', { editor: { filePath: 'test-open.py' } }],
    ]);
  });

  it('saves a file in-place', async () => {
    const editor = ace.edit('test-editor');
    await act(async () => {
      await commands.saveFile();
    });
    expect(await screen.findByText(/^test-save\.py$/i)).toBeInTheDocument();
    expect(screen.queryAllByText(/saved the current file/i).length).toBeGreaterThan(0);
    await act(async () => {
      editor.insert('xyz\n');
      await commands.saveFile();
    });
    expect(mocked(window.ipc.invoke).mock.calls).toMatchObject([
      ['save-file-prompt'],
      ['save-file', 'test-save.py', '', 'utf8'],
      ['save-settings', { editor: { filePath: 'test-save.py' } }],
      ['save-file', 'test-save.py', 'xyz\n', 'utf8'],
      ['save-settings', { editor: { filePath: 'test-save.py' } }],
    ]);
  });

  it('saves a file to a new path', async () => {
    const editor = ace.edit('test-editor');
    await act(async () => {
      updateSetting('editor.filePath', 'tmp.py');
    });
    const filename = await screen.findByText(/^tmp\.py$/i);
    expect(filename).toBeInTheDocument();
    await act(async () => {
      editor.insert('xyz\n');
      await commands.saveFileAs();
    });
    const notifications = screen.queryAllByText(/saved the file to the selected path/i);
    expect(notifications.length).toBeGreaterThan(0);
    expect(filename).toHaveTextContent(/^test-save\.py$/i);
    expect(mocked(window.ipc.invoke).mock.calls).toMatchObject([
      ['save-file-prompt'],
      ['save-file', 'test-save.py', 'xyz\n', 'utf8'],
      ['save-settings', { editor: { filePath: 'test-save.py' } }],
    ]);
  });
});

describe.each(
  makeCommandTriggers({
    cutText: { menu: /^Edit$/, item: /^Cut$/, keybinding: '{ctrl}X' },
    copyText: { menu: /^Edit$/, item: /^copy$/i, keybinding: '{ctrl}C' },
    pasteText: { menu: /^Edit$/, item: /^paste$/i, keybinding: '{ctrl}V' },
  })
)('edit menu (%s)', (inputMethod, commands) => {
  beforeEach(async () => {
    const editor = ace.edit('test-editor');
    await act(async () => {
      editor.insert('abc\ndef');
      const selection = editor.getSelection();
      selection.moveCursorTo(0, 2);
      selection.clearSelection();
      selection.selectTo(1, 1);
    });
  });

  it('cuts and pastes text', async () => {
    const editor = ace.edit('test-editor');
    await act(async () => {
      await commands.cutText();
      editor.getSelection().moveCursorFileEnd();
      editor.clearSelection();
      await commands.pasteText();
    });
    expect(editor.getValue()).toEqual('abefc\nd');
  });

  it('copies and pastes text', async () => {
    const editor = ace.edit('test-editor');
    await act(async () => {
      await commands.copyText();
      editor.getSelection().moveCursorFileEnd();
      editor.clearSelection();
      await commands.pasteText();
    });
    expect(editor.getValue()).toEqual('abc\ndefc\nd');
  });
});

describe.each(
  makeCommandTriggers({
    uploadFile: { item: /^Upload$/, keybinding: '{ctrl}{enter}' },
    downloadFile: { item: /^Download$/, keybinding: '{ctrl}{shift}{enter}' },
    start: { item: /^start$/i, keybinding: '{alt}1' },
    stop: { item: /^Stop$/, keybinding: '{alt}2' },
    estop: { item: /^e-stop$/i, keybinding: '{alt}3' },
  })
)('runtime interactions (%s)', (inputMethod, commands) => {
  it('uploads a file', async () => {
    const editor = ace.edit('test-editor');
    await act(async () => {
      editor.insert('abc\t\n ');
      await commands.uploadFile();
    });
    expect(editor.getValue()).toEqual('abc\t\n ');
    const notifications = screen.queryAllByText(/uploaded code to the robot/i);
    expect(notifications.length).toBeGreaterThan(0);
    expect(mocked(window.ssh.upload)).toHaveBeenCalledWith(
      {
        host: '192.168.1.1',
        username: 'pioneers',
        password: 'pwd',
        privateKey: '---private-key---',
      },
      'teststudentcode.py',
      'abc\t\n '
    );
  });

  it('downloads a file', async () => {
    const editor = ace.edit('test-editor');
    await act(async () => {
      await commands.downloadFile();
    });
    expect(editor.getValue()).toEqual('downloaded');
    expect(await screen.findByText(/^\(unsaved file\)\*/i)).toBeInTheDocument();
    const notifications = screen.queryAllByText(/downloaded code from the robot/i);
    expect(notifications.length).toBeGreaterThan(0);
    expect(mocked(window.ssh.download)).toHaveBeenCalledWith(
      {
        host: '192.168.1.1',
        username: 'pioneers',
        password: 'pwd',
        privateKey: '---private-key---',
      },
      'teststudentcode.py'
    );
  });

  it('starts Runtime', async () => {
    await act(async () => {
      await commands.start();
    });
    expect(screen.queryAllByText(/started robot/i).length).toBeGreaterThan(0);
    expect(mocked(window.ipc.invoke)).toHaveBeenCalledWith(
      'request',
      'executor-service',
      'teleop'
    );
  });

  it('stops Runtime', async () => {
    await act(async () => {
      await commands.stop();
    });
    expect(screen.queryAllByText(/^stopped robot/i).length).toBeGreaterThan(0);
    expect(mocked(window.ipc.invoke)).toHaveBeenCalledWith(
      'request',
      'executor-service',
      'idle'
    );
  });

  it('e-stops Runtime', async () => {
    await act(async () => {
      await commands.estop();
    });
    expect(screen.queryAllByText(/emergency-stopped robot/i).length).toBeGreaterThan(0);
    expect(mocked(window.ipc.send)).toHaveBeenCalledWith(
      'notify',
      'executor-service',
      'estop'
    );
  });
});

describe.each(
  makeCommandTriggers({
    lint: { menu: /debug/i, item: /lint/i, keybinding: '{alt}L' },
    restart: { menu: /debug/i, item: /restart/i, keybinding: '{alt}R' },
  })
)('debug menu (%s)', (inputMethod, commands) => {
  it('lints student code', async () => {
    await act(async () => {
      await commands.lint();
    });
    expect(screen.queryAllByText(/linted current file/i).length).toBeGreaterThan(0);
    /* We don't assert on the DOM because Ace has an opaque internal structure. */
    expect(window.store.getState().editor.annotations).toMatchObject([
      { type: 'error', text: 'Lint error (lint-error, E999)' },
      { type: 'warning', text: 'Lint warning (lint-warning, W999)' },
      { type: 'info', text: 'Lint message (lint-message, C999)' },
    ]);
  });

  it('restarts Runtime', async () => {
    await act(async () => {
      await commands.restart();
    });
    expect(screen.queryAllByText(/restarted runtime/i).length).toBeGreaterThan(0);
    expect(mocked(window.ipc.invoke)).toHaveBeenCalledWith(
      'exec',
      {
        host: '192.168.1.1',
        username: 'pioneers',
        password: 'pwd',
        privateKey: '---private-key---',
      },
      { command: 'systemctl restart runtime.service' }
    );
  });
});

// TODO: test prompt cancel
describe.each([
  [
    'create',
    () => userEvent.type(screen.getByText(/^\d+:\d+$/), '{ctrl}N'),
    (contents: string) => expect(contents).toEqual(''),
  ],
  [
    'open',
    () => userEvent.type(screen.getByText(/^\d+:\d+$/), '{ctrl}O'),
    (contents: string) => expect(contents).toEqual('opened'),
  ],
  [
    'download',
    () => userEvent.type(screen.getByText(/^\d+:\d+$/), '{ctrl}{shift}{enter}'),
    (contents: string) => expect(contents).toEqual('downloaded'),
  ],
  [
    'exit',
    () => window.store.dispatch(exit('quit')),
    () => expect(mocked(window.ipc.send)).toHaveBeenCalledWith('quit'),
  ],
])('overwrite prompt (%s)', (action, callback, check: (contents: string) => void) => {
  beforeEach(async () => {
    const editor = ace.edit('test-editor');
    await act(async () => {
      editor.insert('abc\n');
      callback();
    });
  });

  it('closes the prompt', async () => {
    const editor = ace.edit('test-editor');
    expect(await screen.findByText(/^unsaved changes$/i)).toBeInTheDocument();
    await act(async () => {
      userEvent.click(screen.getByLabelText(/^close$/i));
      await delay(50);
    });
    expect(editor.getValue()).toEqual('abc\n');
    expect(mocked(window.ipc.invoke)).not.toHaveBeenCalledWith(
      'save-file',
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    expect(screen.queryByText(/^unsaved changes$/i)).not.toBeInTheDocument();
  });

  it('discards a dirty buffer', async () => {
    const editor = ace.edit('test-editor');
    expect(await screen.findByText(/^unsaved changes$/i)).toBeInTheDocument();
    await act(async () => {
      userEvent.click(screen.getByText(/^discard$/i));
      await delay(50);
    });
    check(editor.getValue());
    expect(mocked(window.ipc.invoke)).not.toHaveBeenCalledWith(
      'save-file',
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    expect(screen.queryByText(/^unsaved changes$/i)).not.toBeInTheDocument();
  });

  it('saves a dirty buffer', async () => {
    const editor = ace.edit('test-editor');
    expect(await screen.findByText(/^unsaved changes$/i)).toBeInTheDocument();
    await act(async () => {
      userEvent.click(screen.getByText(/^save$/i));
      await delay(50);
    });
    check(editor.getValue());
    expect(mocked(window.ipc.invoke)).toHaveBeenCalledWith(
      'save-file',
      'test-save.py',
      'abc\n',
      'utf8'
    );
    expect(screen.queryByText(/^unsaved changes$/i)).not.toBeInTheDocument();
  });
});

// TODO: check settings open
it('can normalize a file before saving', async () => {
  const editor = ace.edit('test-editor');
  updateSetting('editor.encoding', 'ascii');
  updateSetting('editor.appendNewline', true);
  updateSetting('editor.trimWhitespace', true);
  const save = () => userEvent.type(screen.getByText(/^\d+:\d+$/), '{ctrl}S');
  await act(async () => {
    save();
    await delay(10);
    editor.insert('def main():  \n    pass\t');
    await delay(10);
    save();
  });
  expect(editor.getValue()).toEqual('def main():\n    pass\n');
  expect(mocked(window.ipc.invoke)).toHaveBeenCalledWith(
    'save-file',
    'test-save.py',
    '',
    'ascii'
  );
  expect(mocked(window.ipc.invoke)).toHaveBeenCalledWith(
    'save-file',
    'test-save.py',
    'def main():\n    pass\n',
    'ascii'
  );
});
