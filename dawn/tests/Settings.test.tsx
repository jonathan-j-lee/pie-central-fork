import * as React from 'react';
import {
  act,
  delay,
  fireEvent,
  render,
  screen,
  waitForElementToBeRemoved,
  TextMatch,
} from './test-utils';
import { mocked } from 'ts-jest/utils';
import Settings from '../app/components/Settings';
import userEvent from '@testing-library/user-event';

const close = jest.fn();

const fill = (label: TextMatch, content: string) =>
  userEvent.type(screen.getByLabelText(label), content, { delay: 1 });

beforeEach(() => {
  render(<Settings isOpen={true} close={close} platform="win" />);
  jest.clearAllMocks();
});

describe('runtime settings', () => {
  beforeEach(async () => {
    userEvent.click(await screen.findByRole('tab', { name: /runtime/i, hidden: true }));
  });

  // it('modifies', async () => {
  // });

  it('modifies admin settings', async () => {
    await act(async () => {
      const tab = screen.getByRole('tab', { name: /administration/i, hidden: true });
      userEvent.click(tab);
      await fill(/student code path/i, '{selectall}test.py');
      await fill(/restart command/i, '{selectall}echo "restart"');
      await fill(/update command/i, '{selectall}echo "update"');
      await fill(/user/i, '{selectall}testuser');
      await fill(/password/i, '{selectall}testpassword');
      await fill(/private key/i, '{selectall}---begin key---{enter}---end key---');
      userEvent.click(tab);
      await delay(20);
      userEvent.click(screen.getByRole('button', { name: /confirm/i, hidden: true }));
    });
    const [[channel, settings]] = mocked(window.ipc.invoke).mock.calls;
    expect(channel).toEqual('save-settings');
    expect(settings).toMatchObject({
      runtime: {
        admin: {
          remotePath: 'test.py',
          restartCommand: 'echo "restart"',
          updateCommand: 'echo "update"',
        },
        credentials: {
          username: 'testuser',
          password: 'testpassword',
          privateKey: '---begin key---\n---end key---',
        },
      },
    });
  });

  it('modifies performance settings', async () => {
    await act(async () => {
      const tab = screen.getByRole('tab', { name: /performance/i, hidden: true });
      userEvent.click(tab);
      /* Note: Blueprint sliders do not wrap an `input[type="range"]`, so we cannot
         simulate a value change. */
      userEvent.selectOptions(screen.getByLabelText(/baud rate/i), ['38400']);
      userEvent.click(tab);
      await delay(20);
      userEvent.click(screen.getByRole('button', { name: /confirm/i, hidden: true }));
    });
    const [[channel, settings]] = mocked(window.ipc.invoke).mock.calls;
    expect(channel).toEqual('save-settings');
    expect(settings).toMatchObject({ runtime: { perf: { baudRate: 38400 } } });
  });

  it('modifies address settings', async () => {
    await act(async () => {
      const tab = screen.getByRole('tab', { name: /addresses/i, hidden: true });
      userEvent.click(tab);
      await fill(/multicast group/i, '{selectall}192.168.101.101');
      await fill(/remote call port/i, '{selectall}9990');
      await fill(/log publisher port/i, '{selectall}9991');
      await fill(/control port/i, '{selectall}9992');
      await fill(/update port/i, '{selectall}9993');
      await fill(/vsd port/i, '{selectall}9994');
      userEvent.click(tab);
      await delay(20);
      userEvent.click(screen.getByRole('button', { name: /confirm/i, hidden: true }));
    });
    const [[channel, settings]] = mocked(window.ipc.invoke).mock.calls;
    expect(channel).toEqual('save-settings');
    expect(settings).toMatchObject({
      runtime: {
        addressing: {
          multicastGroup: '192.168.101.101',
          callPort: 9990,
          logPort: 9991,
          controlPort: 9992,
          updatePort: 9993,
          vsdPort: 9994,
        },
      },
    });
  });

  it('modifies monitoring settings', async () => {
    const tab = screen.getByRole('tab', { name: /monitoring/i, hidden: true });
    userEvent.click(tab);
    const interval = screen.getByLabelText(/health check interval/i);
    await act(async () => {
      await userEvent.type(interval, '{selectall}-1', { delay: 5 });
      userEvent.selectOptions(screen.getByLabelText(/log level/i), ['critical']);
      userEvent.click(screen.getByLabelText(/enable debug mode/i));
    });
    expect(interval).toHaveValue('10');
    await act(async () => {
      await userEvent.type(interval, '{selectall}1000', { delay: 5 });
      userEvent.click(tab);
      await delay(20);
      userEvent.click(screen.getByRole('button', { name: /confirm/i, hidden: true }));
    });
    const [[channel, settings]] = mocked(window.ipc.invoke).mock.calls;
    expect(channel).toEqual('save-settings');
    expect(settings).toMatchObject({
      runtime: {
        monitoring: {
          healthCheckInterval: 300,
          logLevel: 'critical',
          debug: true,
        },
      },
    });
  });

  afterEach(async () => {
    expect(screen.queryAllByText(/saved settings/i).length).toBeGreaterThan(0);
  });
});

it('modifies editor settings', async () => {
  userEvent.click(screen.getByRole('tab', { name: /editor/i, hidden: true }));
  const fontSize = screen.getByLabelText(/font size/i);
  const tabSize = screen.getByLabelText(/tab size/i);
  await act(async () => {
    userEvent.click(screen.getByLabelText(/dark theme/i));
    userEvent.selectOptions(screen.getByLabelText(/syntax theme/i), ['monokai']);
    await userEvent.type(fontSize, '{selectall}1000', { delay: 5 });
    await userEvent.type(tabSize, '{selectall}-1', { delay: 5 });
    userEvent.selectOptions(screen.getByLabelText(/file encoding/i), ['ascii']);
    const labels = [
      /enable syntax highlighting/i,
      /show line numbers/i,
      /show long line marker/i,
      /highlight current line/i,
      /wrap lines/i,
      /enable basic autocompletion/i,
      /enable live autocompletion/i,
      /ensure file ends with a newline character/i,
      /remove trailing whitespace/i,
    ];
    for (const label of labels) {
      userEvent.click(screen.getByLabelText(label));
    }
  });
  expect(fontSize).toHaveValue('64');
  expect(tabSize).toHaveValue('1');
  await act(async () => {
    await userEvent.type(fontSize, '{selectall}0', { delay: 5 });
    await userEvent.type(tabSize, '{selectall}100', { delay: 5 });
    userEvent.click(fontSize);
    await delay(20);
    userEvent.click(screen.getByRole('button', { name: /confirm/i, hidden: true }));
  });
  expect(screen.queryAllByText(/saved settings/i).length).toBeGreaterThan(0);
  const [[channel, settings]] = mocked(window.ipc.invoke).mock.calls;
  expect(channel).toEqual('save-settings');
  expect(settings).toMatchObject({
    editor: {
      editorTheme: 'dark',
      syntaxTheme: 'monokai',
      fontSize: 10,
      tabSize: 32,
      encoding: 'ascii',
      syntaxHighlighting: false,
      lineNumbers: false,
      marginMarker: false,
      highlightLine: false,
      wrapLines: false,
      basicAutocomplete: false,
      liveAutocomplete: false,
      appendNewline: false,
      trimWhitespace: false,
    },
  });
});

it('modifies console settings', async () => {
  const tab = screen.getByRole('tab', { name: /console/i, hidden: true });
  userEvent.click(tab);
  const maxLines = screen.getByLabelText(/max lines/i);
  await act(async () => {
    await userEvent.type(maxLines, '{selectall}10000', { delay: 5 });
    userEvent.selectOptions(screen.getByLabelText(/open console automatically/i), [
      'error',
    ]);
    const labels = [
      /show system events/i,
      /show event timestamps/i,
      /show event severity/i,
      /show event tracebacks/i,
      /pin to bottom/i,
    ];
    for (const label of labels) {
      userEvent.click(screen.getByLabelText(label));
    }
  });
  expect(maxLines).toHaveValue('1000');
  await act(async () => {
    await userEvent.type(maxLines, '{selectall}-1', { delay: 5 });
    userEvent.click(tab);
    await delay(20);
    userEvent.click(screen.getByRole('button', { name: /confirm/i, hidden: true }));
  });
  expect(screen.queryAllByText(/saved settings/i).length).toBeGreaterThan(0);
  const [[channel, settings]] = mocked(window.ipc.invoke).mock.calls;
  expect(channel).toEqual('save-settings');
  expect(settings).toMatchObject({
    log: {
      maxEvents: 0,
      openCondition: 'error',
      showSystem: false,
      showTimestamp: false,
      showLevel: false,
      showTraceback: false,
      pinToBottom: false,
    },
  });
});

it('modifies keybindings', async () => {
  const tab = screen.getByRole('tab', { name: /keybindings/i, hidden: true });
  userEvent.click(tab);
  const keybindings = {
    newFile: { win: 'alt+a' },
    openFile: { win: 'alt+b' },
    saveFile: { win: 'alt+c' },
    saveFileAs: { win: 'alt+d' },
    uploadFile: { win: 'alt+e' },
    downloadFile: { win: 'alt+f' },
    cutText: { win: 'alt+g' },
    copyText: { win: 'alt+h' },
    pasteText: { win: 'alt+i' },
    start: { win: 'alt+j' },
    stop: { win: 'alt+k' },
    estop: { win: 'alt+l' },
    toggleConsole: { win: 'alt+m' },
    copyConsole: { win: 'alt+n' },
    clearConsole: { win: 'alt+o' },
    lint: { win: 'alt+p' },
    restart: { win: 'alt+q' },
  };
  await act(async () => {
    const nodes = screen.queryAllByPlaceholderText(/ctrl\s*\+\s*shift\s*\+\s*p/i);
    expect(nodes.length).toBe(Object.keys(keybindings).length);
    for (let index = 0; index < nodes.length; index++) {
      const finalKey = String.fromCharCode('a'.charCodeAt(0) + index);
      await userEvent.type(nodes[index], '{selectall}alt+' + finalKey, { delay: 5 });
    }
    userEvent.click(tab);
    await delay(20);
    userEvent.click(screen.getByRole('button', { name: /confirm/i, hidden: true }));
  });
  expect(screen.queryAllByText(/saved settings/i).length).toBeGreaterThan(0);
  const [[channel, settings]] = mocked(window.ipc.invoke).mock.calls;
  expect(channel).toEqual('save-settings');
  expect(settings).toMatchObject({ keybindings });
}, 10000);

// TODO: check password button show

it('validates keybindings', async () => {
  const tab = screen.getByRole('tab', { name: /keybindings/i, hidden: true });
  userEvent.click(tab);
  const input = screen.getByDisplayValue(/ctrl\s*\+\s*n/i);
  await userEvent.type(input, '{selectall}{backspace}', { delay: 1 });
  userEvent.click(tab);
  expect(await screen.findByText(/invalid keybinding/i)).toBeInTheDocument();
  await userEvent.type(input, '{selectall}CTRL+P', { delay: 1 });
  userEvent.click(tab);
  await waitForElementToBeRemoved(() => screen.queryByText(/invalid keybinding/i));
  await userEvent.type(input, '{selectall}ctrl+', { delay: 1 });
  userEvent.click(tab);
  expect(await screen.findByText(/invalid keybinding/i)).toBeInTheDocument();
  userEvent.click(screen.getByRole('button', { name: /confirm/i, hidden: true }));
  const [[, settings]] = mocked(window.ipc.invoke).mock.calls;
  expect(settings).not.toMatchObject({ keybindings: { newFile: { win: 'ctrl+' } } });
});

it('can revert settings', async () => {
  userEvent.click(await screen.findByRole('button', { name: /confirm/i }));
});

it('can restore default settings', async () => {
  userEvent.click(await screen.findByRole('button', { name: /confirm/i }));
});

afterEach(() => {
  expect(close).toHaveBeenCalled();
});
