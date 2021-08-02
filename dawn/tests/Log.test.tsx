import * as React from 'react';
import * as _ from 'lodash';
import { act, fireEvent, log, render, screen, updateSetting } from './test-utils';
import Log from '../app/components/Log';
import logSlice from '../app/store/log';
import { changeMode, Mode } from '../app/store/runtime';
import { LogLevel, LogOpenCondition } from '../app/store/settings';

beforeEach(() => {
  render(<Log />);
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
    [LogLevel.DEBUG, /^debug$/i],
    [LogLevel.INFO, /^info$/i],
    [LogLevel.WARNING, /^warn$/i],
    [LogLevel.ERROR, /^error$/i],
    [LogLevel.CRITICAL, /^crit$/i],
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
    fireEvent.click(await screen.findByText(/show context/i));
    const [node] = await screen.findAllByText((content, element) => {
      try {
        return _.isEqual(JSON.parse(element.textContent), {
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
    fireEvent.click(await screen.findByRole('button'));
    log.debug('Do not follow this event', { timestamp: '2021-08-03T16:18:23.392159Z' });
    expect(
      await screen.findByText('[2021-08-03T16:18:23.392159Z]')
    ).toBeInTheDocument();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('log open condition', () => {
  beforeEach(() => {
    window.store.dispatch(logSlice.actions.close());
    expect(screen.queryByText(/process started/i)).not.toBeInTheDocument();
  });

  it('opens on start', async () => {
    updateSetting('log.openCondition', LogOpenCondition.START);
    window.store.dispatch(changeMode(Mode.TELEOP));
    expect(await screen.findByText(/process started/i)).toBeInTheDocument();
  });

  it('opens on error', async () => {
    updateSetting('log.openCondition', LogOpenCondition.ERROR);
    log.error('Process terminated', { timestamp: '2021-08-03T16:18:22.392159Z' });
    expect(await screen.findByText(/process started/i)).toBeInTheDocument();
    expect(await screen.findByText(/process terminated/i)).toBeInTheDocument();
  });

  it('does not open automatically', () => {
    updateSetting('log.openCondition', LogOpenCondition.NEVER);
    window.store.dispatch(changeMode(Mode.TELEOP));
    log.error('Process terminated', { timestamp: '2021-08-03T16:18:22.392159Z' });
    expect(screen.queryByText(/process started/i)).not.toBeInTheDocument();
  });
});
