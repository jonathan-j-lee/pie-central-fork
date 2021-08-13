import * as React from 'react';
import * as _ from 'lodash';
import {
  act,
  delay,
  log,
  render,
  screen,
  updateSetting,
  makeCommandTriggers,
  TestEditor,
} from './test-utils';
import userEvent from '@testing-library/user-event';
import Log from '../app/components/Log';
import logSlice from '../app/store/log';
import { changeMode, Mode } from '../app/store/runtime';
import { LogLevel, LogOpenCondition } from '../app/store/settings';

beforeEach(() => {
  render(
    <>
      <TestEditor />
      <Log transitionDuration={0} />
    </>
  );
  log.error('Process started', {
    process: 'device',
    pid: 133298,
    timestamp: '2021-08-03T16:18:21.392159Z',
    exception:
      'Traceback (most recent call last):\n' +
      '  File "/usr/lib/python3.9/asyncio/tasks.py", line 492, in wait_for\n' +
      '    fut.result()\n' +
      'asyncio.exceptions.CancelledError',
  });
});

describe('log event', () => {
  beforeEach(() => {
    window.store.dispatch(logSlice.actions.open());
  });

  it('shows the message', async () => {
    expect(await screen.findByText(/process started/i)).toBeInTheDocument();
  });

  it('shows and hides the timestamp', async () => {
    updateSetting('log.showTimestamp', true);
    const node = await screen.findByText('[2021-08-03T16:18:21.392159Z]');
    expect(node).toBeInTheDocument();
    updateSetting('log.showTimestamp', false);
    expect(screen.queryByText('[2021-08-03T16:18:21.392159Z]')).not.toBeInTheDocument();
  });

  it.each([
    [LogLevel.DEBUG, /^DEBUG$/],
    [LogLevel.INFO, /^INFO$/],
    [LogLevel.WARNING, /^WARN$/],
    [LogLevel.ERROR, /^ERROR$/],
    [LogLevel.CRITICAL, /^CRIT$/],
  ])('shows and hides the log level %s', async (level, match) => {
    log[level.toLowerCase()]('Testing', { timestamp: '2021-08-03T16:18:22.392159Z' });
    updateSetting('log.showLevel', true);
    const labels = await screen.findAllByText(match);
    expect(labels).toBeTruthy();
    expect(labels.length).toBeGreaterThan(0);
    updateSetting('log.showLevel', false);
    expect(screen.queryByText(match)).not.toBeInTheDocument();
  });

  it('shows and hides the error traceback', async () => {
    updateSetting('log.showTraceback', true);
    const pattern = /Traceback.*asyncio.exceptions.CancelledError/i;
    expect(await screen.findByText(pattern)).toBeInTheDocument();
    updateSetting('log.showTraceback', false);
    expect(screen.queryByText(pattern)).not.toBeInTheDocument();
  });

  it('shows contextual data', async () => {
    userEvent.click(await screen.findByText(/show context/i));
    const [node] = await screen.findAllByText((content, element) => {
      try {
        return _.isEqual(JSON.parse(element?.textContent ?? '{}'), {
          process: 'device',
          pid: 133298,
        });
      } catch (err) {
        return false;
      }
    });
    expect(node).toBeInTheDocument();
  });

  it('scrolls to follow the latest event', async () => {
    log.debug('Follow this event', { timestamp: '2021-08-03T16:18:22.392159Z' });
    expect(
      await screen.findByText('[2021-08-03T16:18:22.392159Z]')
    ).toBeInTheDocument();
    const scrollIntoView = window.HTMLElement.prototype.scrollIntoView;
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'end' });
    (scrollIntoView as jest.Mock<typeof scrollIntoView>).mockClear();
    const [pinButton] = document.getElementsByClassName('log-pin');
    userEvent.click(pinButton);
    log.debug('Do not follow this event', { timestamp: '2021-08-03T16:18:23.392159Z' });
    expect(
      await screen.findByText('[2021-08-03T16:18:23.392159Z]')
    ).toBeInTheDocument();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('log open condition', () => {
  it('opens on start', async () => {
    expect(screen.queryByText(/process started/i)).not.toBeInTheDocument();
    updateSetting('log.openCondition', LogOpenCondition.START);
    window.store.dispatch(changeMode(Mode.TELEOP));
    expect(await screen.findByText(/process started/i)).toBeInTheDocument();
  });

  it('opens on error', async () => {
    expect(screen.queryByText(/process started/i)).not.toBeInTheDocument();
    updateSetting('log.openCondition', LogOpenCondition.ERROR);
    log.error('Process terminated', { timestamp: '2021-08-03T16:18:22.392159Z' });
    expect(await screen.findByText(/process started/i)).toBeInTheDocument();
    expect(await screen.findByText(/process terminated/i)).toBeInTheDocument();
  });

  it('does not open automatically', () => {
    expect(screen.queryByText(/process started/i)).not.toBeInTheDocument();
    updateSetting('log.openCondition', LogOpenCondition.NEVER);
    window.store.dispatch(changeMode(Mode.TELEOP));
    log.error('Process terminated', { timestamp: '2021-08-03T16:18:22.392159Z' });
    expect(screen.queryByText(/process started/i)).not.toBeInTheDocument();
  });
});

describe.each(
  makeCommandTriggers({
    toggleConsole: {
      menu: /^Console$/,
      item: /^(open|close)$/i,
      keybinding: '{ctrl}{shift}O',
    },
    copyConsole: { menu: /^Console$/, item: /^copy$/i, keybinding: '{ctrl}{shift}C' },
    clearConsole: { menu: /^Console$/, item: /^clear$/i, keybinding: '{ctrl}{shift}X' },
  })
)('log menu (%s)', (inputMethod, commands) => {
  it('toggles the console', async () => {
    await act(async () => {
      await commands.toggleConsole();
    });
    const event = await screen.findByText(/process started/i);
    expect(event).toBeInTheDocument();
    await act(async () => {
      await commands.toggleConsole();
    });
    await delay(20);
    expect(event).not.toBeInTheDocument();
  });

  it('copies the console', async () => {
    await commands.copyConsole();
    expect(await screen.findByText(/copied console output/i)).toBeInTheDocument();
    expect(JSON.parse(await navigator.clipboard.readText())).toMatchObject({
      event: 'Process started',
      process: 'device',
      pid: 133298,
      timestamp: '2021-08-03T16:18:21.392159Z',
      exception:
        'Traceback (most recent call last):\n' +
        '  File "/usr/lib/python3.9/asyncio/tasks.py", line 492, in wait_for\n' +
        '    fut.result()\n' +
        'asyncio.exceptions.CancelledError',
    });
  });

  it('clears the console', async () => {
    await act(async () => {
      await commands.toggleConsole();
      await commands.clearConsole();
      log.info('Test event', { timestamp: '2021-08-03T16:18:23.392159Z' });
    });
    expect(await screen.findByText(/test event/i)).toBeInTheDocument();
    expect(screen.queryByText(/process started/)).not.toBeInTheDocument();
  });
});
