import Log from '../../app/client/components/Log';
import { LogLevel } from '../../app/types';
import { delay, init, render, recvControl, refresh, updateSession } from './test-utils';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as _ from 'lodash';
import * as React from 'react';

beforeEach(async () => {
  render(<Log />);
  init();
  await refresh();
  recvControl({ control: { matchId: 1 } });
  recvControl({
    control: {},
    events: [
      {
        event: 'Process started',
        level: LogLevel.ERROR,
        process: 'device',
        pid: 133298,
        timestamp: '1970-01-01T00:00:10.000Z',
        exception:
          'Traceback (most recent call last):\n' +
          '  File "/usr/lib/python3.9/asyncio/tasks.py", line 492, in wait_for\n' +
          '    fut.result()\n' +
          'asyncio.exceptions.CancelledError',
        student_code: true,
        team: { id: 1, number: 0, name: 'Berkeley', hostname: 'localhost' },
      },
    ],
  });
});

describe('log event', () => {
  it('shows message fields', () => {
    expect(screen.getByText(/process started/i)).toBeInTheDocument();
    expect(screen.getByText('[1970-01-01T00:00:10.000Z]')).toBeInTheDocument();
    expect(
      screen.getByText(/Traceback.*asyncio\.exceptions\.CancelledError/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/berkeley \(#0\)/i)).toBeInTheDocument();
    expect(screen.getByText(/^blue$/i)).toBeInTheDocument();
  });

  it('shows contextual data', () => {
    userEvent.click(screen.getByText(/show context/i));
    const [node] = screen.getAllByText((content, element) => {
      try {
        return _.isEqual(JSON.parse(element?.textContent ?? '{}'), {
          process: 'device',
          pid: 133298,
          student_code: true,
          alliance: 'blue',
          team: {
            id: 1,
            number: 0,
            name: 'Berkeley',
            hostname: 'localhost',
          },
        });
      } catch {
        return false;
      }
    });
    expect(node).toBeInTheDocument();
  });

  it('scrolls to follow the latest event', async () => {
    const scrollIntoView = window.HTMLElement.prototype.scrollIntoView;
    (scrollIntoView as jest.Mock).mockClear();
    const event = { event: 'Testing', level: LogLevel.INFO, team: {} };
    recvControl({
      control: {},
      events: [{ ...event, timestamp: '2021-08-03T16:18:22.392159Z' }],
    });
    expect(
      await screen.findByText('[2021-08-03T16:18:22.392159Z]')
    ).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'end' });
    (scrollIntoView as jest.Mock).mockClear();
    userEvent.click(screen.getByText(/^tail$/i));
    recvControl({
      control: {},
      events: [{ ...event, timestamp: '2021-08-03T16:18:23.392159Z' }],
    });
    expect(
      await screen.findByText('[2021-08-03T16:18:23.392159Z]')
    ).toBeInTheDocument();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('log filters', () => {
  beforeEach(() => {
    const events = [
      LogLevel.DEBUG,
      LogLevel.INFO,
      LogLevel.WARNING,
      LogLevel.CRITICAL,
    ].map((level, index) => ({
      level,
      event: 'Testing',
      timestamp: new Date(10000 * (index + 2)).toISOString(),
      team: {},
    }));
    recvControl({ control: {}, events });
  });

  it('filters by context', async () => {
    const filters = screen.getByPlaceholderText(/enter filters/i);
    userEvent.type(filters, 'student_code:true {enter}');
    await delay(20);
    expect(screen.getByText(/process started/i)).toBeInTheDocument();
    expect(screen.queryAllByText(/^testing$/i)).toHaveLength(0);
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        log: expect.objectContaining({
          filters: [{ exclude: false, key: 'student_code', value: true }],
        }),
      })
    );
    updateSession.mockClear();

    userEvent.type(filters, '{backspace}{backspace}!team:{{"number": 0}{enter}');
    await delay(20);
    expect(screen.queryByText(/process started/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/testing/i)).toHaveLength(3);
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        log: expect.objectContaining({
          filters: [{ exclude: true, key: 'team', value: { number: 0 } }],
        }),
      })
    );
    updateSession.mockClear();

    userEvent.type(filters, 'student_code:true{enter}');
    await delay(20);
    expect(screen.queryAllByText(/^testing$/i)).toHaveLength(0);
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        log: expect.objectContaining({
          filters: [
            { exclude: true, key: 'team', value: { number: 0 } },
            { exclude: false, key: 'student_code', value: true },
          ],
        }),
      })
    );
  });

  it('truncates the log to a maximum length', async () => {
    userEvent.type(screen.getByDisplayValue(/400/), '{selectall}5');
    userEvent.click(screen.getByPlaceholderText(/enter filters/i));
    expect(screen.getByText(/process started/i)).toBeInTheDocument();
    recvControl({
      control: {},
      events: [
        {
          level: LogLevel.INFO,
          event: 'Testing',
          timestamp: new Date(70000).toISOString(),
          team: {},
        },
      ],
    });
    await delay(20);
    expect(screen.queryByText(/process started/i)).not.toBeInTheDocument();
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({ log: expect.objectContaining({ maxEvents: 5 }) })
    );
  });

  it.each([
    [LogLevel.DEBUG, [/^DEBUG$/, /^INFO$/, /^WARN$/, /^ERROR$/, /^CRIT$/]],
    [LogLevel.INFO, [/^INFO$/, /^WARN$/, /^ERROR$/, /^CRIT$/]],
    [LogLevel.WARNING, [/^WARN$/, /^ERROR$/, /^CRIT$/]],
    [LogLevel.ERROR, [/^ERROR$/, /^CRIT$/]],
    [LogLevel.CRITICAL, [/^CRIT$/]],
  ])('filters by minimum log level %s', async (level, patterns) => {
    userEvent.selectOptions(screen.getByDisplayValue(/^info$/i), [level]);
    for (const pattern of patterns) {
      expect(screen.getByText(pattern)).toBeInTheDocument();
    }
    await delay(20);
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({ log: expect.objectContaining({ level }) })
    );
  });
});

describe('log actions', () => {
  it('copies the console', async () => {
    userEvent.click(screen.getByText(/^Copy$/));
    expect(await screen.findByText(/copied log/i)).toBeInTheDocument();
    expect(JSON.parse(await navigator.clipboard.readText())).toMatchObject({
      event: 'Process started',
      level: LogLevel.ERROR,
      process: 'device',
      pid: 133298,
      timestamp: '1970-01-01T00:00:10.000Z',
      exception:
        'Traceback (most recent call last):\n' +
        '  File "/usr/lib/python3.9/asyncio/tasks.py", line 492, in wait_for\n' +
        '    fut.result()\n' +
        'asyncio.exceptions.CancelledError',
      student_code: true,
      team: { id: 1, number: 0, name: 'Berkeley', hostname: 'localhost' },
    });
  });

  it('clears the console', async () => {
    userEvent.click(screen.getByText(/^clear$/i));
    expect(await screen.findByText(/cleared log/i)).toBeInTheDocument();
    expect(screen.queryByText(/process started/i)).not.toBeInTheDocument();
  });
});
