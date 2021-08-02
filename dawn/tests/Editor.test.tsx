import * as React from 'react';
import ace from 'ace-builds/src-min/ace';
import {
  act,
  fireEvent,
  log,
  render,
  screen,
  updateSetting,
  waitForElementToBeRemoved,
} from './test-utils';
import { mocked } from 'ts-jest/utils';
import userEvent from '@testing-library/user-event';

import Editor from '../app/components/Editor';
import KeybindingMapper from '../app/components/KeybindingMapper';
import Log from '../app/components/Log';
import OverwriteDialog from '../app/components/OverwriteDialog';
import Toolbar from '../app/components/Toolbar';
import { Mode } from '../app/store/runtime';

const openSettings = jest.fn();
const closeSettings = jest.fn();

beforeEach(() => {
  const TestEditor = (props) => {
    const [editor, setEditor] = React.useState(null);
    return (
      <>
        <KeybindingMapper editor={editor} mode={Mode.TELEOP}>
          <div id="app">
            <Toolbar
              editor={editor}
              openSettings={openSettings}
              closeSettings={closeSettings}
              mode={Mode.TELEOP}
              setMode={(mode) => null}
            />
            <main>
              <div id="editor-pane">
                <Editor name="test-editor" editor={editor} setEditor={setEditor} />
                <Log />
              </div>
            </main>
            <OverwriteDialog editor={editor} />
          </div>
        </KeybindingMapper>
      </>
    );
  };
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
        const [, method] = args;
        if (method === 'lint') {
          return [
            {
              line: 1,
              column: 1,
              type: 'error',
              message: 'Lint error',
              symbol: 'E999',
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
    expect(fileStatus).toHaveTextContent('(Unsaved File)*');
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
    await act(async () => editor.find('cd\nef'));
    expect(highlighted).toHaveTextContent('(2, 5)');
  });
});

describe.each([
  [
    'toolbar',
    {
      newFile: () => userEvent.click(screen.getByText(/^new file$/i)),
      openFile: () => userEvent.click(screen.getByText(/^open file$/i)),
      saveFile: () => userEvent.click(screen.getByText(/^save file$/i)),
      saveFileAs: () => userEvent.click(screen.getByText(/^save file as \.\.\.$/i)),
    },
  ],
  [
    'keybinding',
    {
      newFile: () => userEvent.type(screen.getByText(/^\d+\:\d+$/), '{ctrl}N'),
      openFile: () => userEvent.type(screen.getByText(/^\d+\:\d+$/), '{ctrl}O'),
      saveFile: () => userEvent.type(screen.getByText(/^\d+\:\d+$/), '{ctrl}S'),
      saveFileAs: () =>
        userEvent.type(screen.getByText(/^\d+\:\d+$/), '{ctrl}{shift}S'),
    },
  ],
])('file menu (%s)', (inputMethod, commands) => {
  beforeEach(async () => {
    userEvent.click(await screen.findByRole('button', { name: /file/i }));
  });

  it('creates a new file', async () => {
    const editor = ace.edit('test-editor');
    await act(async () => {
      editor.insert('abc');
      commands.newFile();
      userEvent.click(await screen.findByText(/^discard$/i));
    });
    expect(editor.getValue()).toEqual('');
    expect(await screen.findByText(/^\(unsaved file\)$/i)).toBeInTheDocument();
    expect(await screen.findByText(/created a new file/i)).toBeInTheDocument();
    expect(mocked(window.ipc.invoke).mock.calls).toMatchObject([
      ['save-settings', { editor: { filePath: null } }],
    ]);
  });

  it('opens a file', async () => {
    const editor = ace.edit('test-editor');
    await act(async () => {
      commands.openFile();
    });
    expect(editor.getValue()).toEqual('opened');
    expect(await screen.findByText(/^test\-open\.py$/i)).toBeInTheDocument();
    expect(await screen.findByText(/opened the selected file/i)).toBeInTheDocument();
    expect(mocked(window.ipc.invoke).mock.calls).toMatchObject([
      ['open-file-prompt'],
      ['open-file', 'test-open.py', 'utf8'],
      ['save-settings', { editor: { filePath: 'test-open.py' } }],
    ]);
  });

  it('saves a file in-place', async () => {
    const editor = ace.edit('test-editor');
    await act(async () => await commands.saveFile());
    expect(await screen.findByText(/^test\-save\.py$/i)).toBeInTheDocument();
    expect(await screen.findByText(/saved the current file/i)).toBeInTheDocument();
    await act(async () => {
      editor.insert('xyz\n');
      commands.saveFile();
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
    await act(async () => await commands.saveFileAs());
    expect(await screen.findByText(/^test\-save\.py$/i)).toBeInTheDocument();
    expect(
      await screen.findByText(/saved the file to the selected path/i)
    ).toBeInTheDocument();
    updateSetting('editor.filePath', 'tmp.py');
    expect(await screen.findByText(/^tmp.py$/i)).toBeInTheDocument();
    await act(async () => {
      editor.insert('xyz\n');
      commands.saveFileAs();
    });
    expect(await screen.findByText(/^test\-save\.py$/i)).toBeInTheDocument();
    expect(mocked(window.ipc.invoke).mock.calls).toMatchObject([
      ['save-file-prompt'],
      ['save-file', 'test-save.py', '', 'utf8'],
      ['save-settings', { editor: { filePath: 'test-save.py' } }],
      ['save-file-prompt'],
      ['save-file', 'test-save.py', 'xyz\n', 'utf8'],
      ['save-settings', { editor: { filePath: 'test-save.py' } }],
    ]);
  });
});

describe('edit menu (toolbar)', () => {
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
    const editButton = await screen.findByRole('button', { name: /edit/i });
    await act(async () => {
      userEvent.click(editButton);
      userEvent.click(await screen.findByText(/^Cut$/));
      await new Promise((resolve) => setTimeout(resolve, 20));
      editor.getSelection().moveCursorFileEnd();
      editor.clearSelection();
      userEvent.click(editButton);
      userEvent.click(await screen.findByText(/^paste$/i));
      userEvent.click(editButton);
      userEvent.click(await screen.findByText(/^paste$/i));
    });
    expect(editor.getValue()).toEqual('abefc\ndc\nd');
  }, 6000);

  it('copies and pastes text', async () => {
    const editor = ace.edit('test-editor');
    const editButton = await screen.findByRole('button', { name: /edit/i });
    await act(async () => {
      userEvent.click(editButton);
      userEvent.click(await screen.findByText(/^copy$/i));
      editor.selectAll();
      userEvent.click(editButton);
      userEvent.click(await screen.findByText(/^paste$/i));
      userEvent.click(editButton);
      userEvent.click(await screen.findByText(/^paste$/i));
    });
    expect(editor.getValue()).toEqual('c\ndc\nd');
  }, 6000);
});

describe.each([
  [
    'toolbar',
    {
      uploadFile: () => userEvent.click(screen.getByText(/^Upload$/)),
      downloadFile: () => userEvent.click(screen.getByText(/^Download$/)),
      start: () => userEvent.click(screen.getByText(/^start$/i)),
      stop: () => userEvent.click(screen.getByText(/^Stop$/)),
      estop: () => userEvent.click(screen.getByText(/^e-stop$/i)),
    },
  ],
  [
    'keybinding',
    {
      uploadFile: () => userEvent.type(screen.getByText(/^\d+\:\d+$/), '{ctrl}{enter}'),
      downloadFile: () =>
        userEvent.type(screen.getByText(/^\d+\:\d+$/), '{ctrl}{shift}{enter}'),
      start: () => userEvent.type(screen.getByText(/^\d+\:\d+$/), '{alt}1'),
      stop: () => userEvent.type(screen.getByText(/^\d+\:\d+$/), '{alt}2'),
      estop: () => userEvent.type(screen.getByText(/^\d+\:\d+$/), '{alt}3'),
    },
  ],
])('runtime interactions (%s)', (inputMethod, commands) => {
  it('uploads a file', async () => {
    const editor = ace.edit('test-editor');
    await act(async () => {
      editor.insert('abc\t\n ');
      commands.uploadFile();
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
    await act(async () => commands.downloadFile());
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
    commands.start();
    expect(await screen.findByText(/started robot/i)).toBeInTheDocument();
    expect(mocked(window.ipc.invoke)).toHaveBeenCalledWith(
      'request',
      'executor-service',
      'teleop'
    );
  });

  it('stops Runtime', async () => {
    commands.stop();
    expect(await screen.findByText(/^stopped robot/i)).toBeInTheDocument();
    expect(mocked(window.ipc.invoke)).toHaveBeenCalledWith(
      'request',
      'executor-service',
      'idle'
    );
  });

  it('e-stops Runtime', async () => {
    commands.estop();
    expect(await screen.findByText(/emergency\-stopped robot/i)).toBeInTheDocument();
    expect(mocked(window.ipc.send)).toHaveBeenCalledWith(
      'notify',
      'executor-service',
      'estop'
    );
  });
});

describe.each([
  [
    'toolbar',
    {
      toggleConsole: () => userEvent.click(screen.getByText(/^(open|close)$/i)),
      copyConsole: () => userEvent.click(screen.getByText(/^copy$/i)),
      clearConsole: () => userEvent.click(screen.getByText(/^clear$/i)),
    },
  ],
  [
    'keybinding',
    {
      toggleConsole: () =>
        userEvent.type(screen.getByText(/^\d+\:\d+$/), '{ctrl}{shift}O'),
      copyConsole: () =>
        userEvent.type(screen.getByText(/^\d+\:\d+$/), '{ctrl}{shift}C'),
      clearConsole: () =>
        userEvent.type(screen.getByText(/^\d+\:\d+$/), '{ctrl}{shift}X'),
    },
  ],
])('console menu (%s)', (inputMethod, commands) => {
  beforeEach(async () => {
    log.info('New event', { timestamp: '2021-08-03T16:18:22.392159Z', count: 1 });
    userEvent.click(await screen.findByRole('button', { name: /console/i }));
  });

  it('toggles the console', async () => {
    await act(async () => commands.toggleConsole());
    expect(await screen.findByText(/new event/i)).toBeInTheDocument();
    await act(async () => commands.toggleConsole());
    await waitForElementToBeRemoved(() => screen.queryByText(/new event/i));
  });

  it('copies the console', async () => {
    commands.copyConsole();
    expect(await screen.findByText(/copied console output/i)).toBeInTheDocument();
    expect(JSON.parse(await navigator.clipboard.readText())).toMatchObject({
      event: 'New event',
      timestamp: '2021-08-03T16:18:22.392159Z',
      level: 'info',
      count: 1,
    });
  });

  it('clears the console', async () => {
    await act(async () => {
      commands.toggleConsole();
      commands.clearConsole();
      log.info('Test event', { timestamp: '2021-08-03T16:18:23.392159Z' });
    });
    expect(await screen.findByText(/test event/i)).toBeInTheDocument();
    expect(screen.queryByText(/new event/)).not.toBeInTheDocument();
  });
});

describe.each([
  [
    'toolbar',
    {
      lint: () => userEvent.click(screen.getByText(/lint/i)),
      restart: () => userEvent.click(screen.getByText(/restart/i)),
    },
  ],
  [
    'keybinding',
    {
      lint: () => userEvent.type(screen.getByText(/^\d+\:\d+$/), '{alt}L'),
      restart: () => userEvent.type(screen.getByText(/^\d+\:\d+$/), '{alt}R'),
    },
  ],
])('debug menu (%s)', (inputMethod, commands) => {
  beforeEach(async () => {
    userEvent.click(await screen.findByRole('button', { name: /debug/i }));
  });

  it('lints student code', async () => {
    await act(async () => commands.lint());
    expect(screen.queryAllByText(/linted current file/i).length).toBeGreaterThan(0);
    expect(mocked(window.ipc.invoke)).toHaveBeenCalledWith(
      'request',
      'broker-service',
      'lint'
    );
  });

  it('restarts Runtime', async () => {
    await act(async () => commands.restart());
    expect(await screen.findByText(/restarted runtime/i)).toBeInTheDocument();
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

// TODO: check overwrite on quit
// TODO: test prompt cancel
describe.each([
  ['create', () => userEvent.type(screen.getByText(/^\d+\:\d+$/), '{ctrl}N'), ''],
  ['open', () => userEvent.type(screen.getByText(/^\d+\:\d+$/), '{ctrl}O'), 'opened'],
  [
    'download',
    () => userEvent.type(screen.getByText(/^\d+\:\d+$/), '{ctrl}{shift}{enter}'),
    'downloaded',
  ],
])('overwrite prompt (%s)', (action, callback, contents) => {
  beforeEach(async () => {
    const editor = ace.edit('test-editor');
    await act(async () => {
      editor.insert('abc\n');
      callback();
    });
    expect(
      await screen.findByRole('heading', { name: /^unsaved changes$/i })
    ).toBeInTheDocument();
  });

  it('closes the prompt', async () => {
    const editor = ace.edit('test-editor');
    await act(async () => {
      userEvent.click(screen.getByRole('button', { name: /close/i }));
    });
    expect(editor.getValue()).toEqual('abc\n');
    expect(mocked(window.ipc.invoke)).not.toHaveBeenCalledWith(
      'save-file',
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it('discards a dirty buffer', async () => {
    const editor = ace.edit('test-editor');
    await act(async () => {
      userEvent.click(screen.getByRole('button', { name: /discard/i }));
    });
    expect(editor.getValue()).toEqual(contents);
    expect(mocked(window.ipc.invoke)).not.toHaveBeenCalledWith(
      'save-file',
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it('saves a dirty buffer', async () => {
    const editor = ace.edit('test-editor');
    await act(async () => {
      userEvent.click(screen.getByRole('button', { name: /save/i }));
    });
    expect(editor.getValue()).toEqual(contents);
    expect(mocked(window.ipc.invoke)).toHaveBeenCalledWith(
      'save-file',
      'test-save.py',
      'abc\n',
      'utf8'
    );
  });

  afterEach(async () => {
    await waitForElementToBeRemoved(() =>
      screen.queryByRole('heading', { name: /^unsaved changes$/i })
    );
  });
});

// TODO: check settings open

/*
describe('file export operation', () => {
  updateSetting('editor.encoding', 'ascii');

  it('can append a newline character', async () => {
    const editor = ace.edit('test-editor');
    updateSetting('editor.appendNewline', true);
    await act(async () => {
      editor.insert('abc');
      editor.execCommand('saveFile');
    });
    expect(editor.getValue()).toEqual('abc\n');
    expect(mocked(window.ipc.invoke)).toHaveBeenCalledWith(
      'save-file',
      'test-save.py',
      'abc\n',
      'utf8'
    );
  });

  it('can remove trailing whitespace', async () => {
    const editor = ace.edit('test-editor');
    updateSetting('editor.appendNewline', true);
    updateSetting('editor.trimWhitespace', true);
    await act(async () => {
      editor.insert('abc\t\n ');
      editor.execCommand('saveFile');
    });
    expect(editor.getValue()).toEqual('abc\n');
    expect(mocked(window.ipc.invoke)).toHaveBeenCalledWith(
      'save-file',
      'test-save.py',
      'abc\n',
      'utf8'
    );
  });
});
*/
