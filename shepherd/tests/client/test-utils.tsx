import * as React from 'react';
import { Action, Dispatch, Middleware, MiddlewareAPI } from 'redux';
import { Provider } from 'react-redux';
import * as _ from 'lodash';
import { AppStore, makeStore } from '../../app/client/store';
import controlSlice, {
  init as initControl,
  refresh as refreshData,
} from '../../app/client/store/control';
import logSlice from '../../app/client/store/log';
import matchesSlice from '../../app/client/store/matches';
import { logIn as logInUser } from '../../app/client/store/user';
import {
  AllianceColor,
  ControlRequest,
  ControlResponse,
  Match,
  MatchEventType,
} from '../../app/types';
import { render as rtlRender, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { rest } from 'msw';
import { setupServer } from 'msw/node';
import 'jest-canvas-mock';

declare global {
  interface Window {
    store: AppStore;
    ws: WebSocket;
  }
}

const ORIGIN = 'http://localhost';

let matchId = 1;
let eventId = 1;

interface MatchGenerationOptions {
  blueScore?: number;
  goldScore?: number;
  fixture?: number;
}

function makeMatch({
  blueScore,
  goldScore,
  fixture,
}: MatchGenerationOptions = {}): Match {
  const match = matchId++;
  return {
    id: match,
    fixture: fixture ?? null,
    events: [
      {
        id: eventId++,
        match,
        type: MatchEventType.JOIN,
        timestamp: 0,
        alliance: AllianceColor.BLUE,
        team: 1,
        value: null,
        description: null,
      },
      {
        id: eventId++,
        match,
        type: MatchEventType.JOIN,
        timestamp: 0,
        alliance: AllianceColor.GOLD,
        team: 2,
        value: null,
        description: null,
      },
      {
        id: eventId++,
        match,
        type: MatchEventType.AUTO,
        timestamp: 10000,
        alliance: AllianceColor.BLUE,
        team: 1,
        value: 30000,
        description: null,
      },
      {
        id: eventId++,
        match,
        type: MatchEventType.AUTO,
        timestamp: 10000,
        alliance: AllianceColor.GOLD,
        team: 2,
        value: 30000,
        description: null,
      },
      {
        id: eventId++,
        match,
        type: MatchEventType.IDLE,
        timestamp: 30000,
        alliance: AllianceColor.BLUE,
        team: 1,
        value: null,
        description: null,
      },
      {
        id: eventId++,
        match,
        type: MatchEventType.IDLE,
        timestamp: 30000,
        alliance: AllianceColor.GOLD,
        team: 2,
        value: null,
        description: null,
      },
      {
        id: eventId++,
        match,
        type: MatchEventType.ADD,
        timestamp: 40000,
        alliance: AllianceColor.BLUE,
        team: null,
        value: blueScore ?? 0,
        description: null,
      },
      {
        id: eventId++,
        match,
        type: MatchEventType.ADD,
        timestamp: 40000,
        alliance: AllianceColor.GOLD,
        team: null,
        value: goldScore ?? 0,
        description: null,
      },
    ],
  };
}

const matches = [
  makeMatch({ blueScore: -5, goldScore: 5, fixture: 1 }),
  makeMatch({ blueScore: 4, goldScore: -4 }),
  makeMatch({ blueScore: 0, goldScore: 0 }),
];

export const upsertEntities = jest.fn();
export const deleteEntities = jest.fn();

function makeMutationEndpoints(endpoint: string) {
  return [
    rest.put(new URL(endpoint, ORIGIN).href, (req, res, ctx) => {
      upsertEntities(endpoint, req.body);
      return res(ctx.json(req.body));
    }),
    rest.delete(new URL(endpoint, ORIGIN).href, (req, res, ctx) => {
      deleteEntities(endpoint, req.body);
      return res(ctx.json(req.body));
    }),
  ];
}

const server = setupServer(
  rest.get(new URL('session', ORIGIN).href, (req, res, ctx) => {
    const username = sessionStorage.getItem('username');
    return res(
      ctx.json({
        user: { username, darkTheme: false, game: null },
        log: {
        },
      })
    );
  }),
  rest.post(new URL('login', ORIGIN).href, (req, res, ctx) => {
    const { username, password } = req.body as Record<string, any>;
    const authenticated = username === 'admin' && password === 'test';
    if (authenticated) {
      sessionStorage.setItem('username', username);
    }
    return res(ctx.status(authenticated ? 200 : 500));
  }),
  rest.post(new URL('logout', ORIGIN).href, (req, res, ctx) => {
    sessionStorage.removeItem('username');
    return res(ctx.status(200));
  }),
  rest.get(new URL('teams', ORIGIN).href, (req, res, ctx) => {
    const robotOptions = {
      hostname: 'localhost',
      callPort: 6000,
      logPort: 6001,
      updatePort: 6003,
      multicastGroup: '224.1.1.1',
    };
    return res(
      ctx.json([
        {
          id: 1,
          number: 0,
          name: 'Berkeley',
          alliance: 1,
          ...robotOptions,
        },
        {
          id: 2,
          number: 1,
          name: 'Stanford',
          alliance: 2,
          ...robotOptions,
        },
      ]),
    );
  }),
  ...makeMutationEndpoints('teams'),
  rest.get(new URL('bracket', ORIGIN).href, (req, res, ctx) => {
    return res(
      ctx.json({
        id: 1,
        root: true,
        winner: null,
        blue: {
          id: 2,
          root: false,
          winner: 1,
          blue: null,
          gold: null,
        },
        gold: {
          id: 3,
          root: false,
          winner: 2,
          blue: null,
          gold: null,
        },
      }),
    );
  }),
  rest.post(new URL('bracket', ORIGIN).href, (req, res, ctx) => {
    upsertEntities('bracket', req.body);
    return res(ctx.status(200));
  }),
  rest.delete(new URL('bracket', ORIGIN).href, (req, res, ctx) => {
    deleteEntities('bracket');
    return res(ctx.status(200));
  }),
  rest.get(new URL('matches', ORIGIN).href, (req, res, ctx) => {
    return res(ctx.json(matches));
  }),
  ...makeMutationEndpoints('matches'),
  rest.get(new URL('alliances', ORIGIN).href, (req, res, ctx) => {
    return res(ctx.json([{ id: 1, name: 'Alameda' }, { id: 2, name: 'Santa Clara' }]));
  }),
  ...makeMutationEndpoints('alliances'),
);

beforeAll(() => server.listen());
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  jest.clearAllMocks();
});

export function render(ui: React.ReactElement<any>) {
  // https://html.spec.whatwg.org/multipage/web-sockets.html#the-websocket-interface
  jest
    .spyOn(window, 'WebSocket')
    .mockImplementation((url: string, protocols?: string | string[]) => {
      window.ws = {
        CONNECTING: 0,
        OPEN: 1,
        CLOSING: 2,
        CLOSED: 3,
        readyState: 0,
        bufferedAmount: 0,
        protocol: '',
        url: 'ws://localhost',
        onopen: jest.fn(),
        onclose: jest.fn(),
        onerror: jest.fn(),
        onmessage: jest.fn(),
        close: jest.fn(),
        send: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
        binaryType: 'blob',
        extensions: '',
      } as WebSocket;
      return window.ws;
    });
  window.ResizeObserver =
    window.ResizeObserver ??
    jest.fn(() => {
      return {
        disconnect: jest.fn(),
        observe: jest.fn(),
        unobserve: jest.fn(),
      };
    });
  window.store = makeStore();
  function Wrapper({ children }: { children?: React.ReactNode }) {
    return <Provider store={window.store}>{children}</Provider>;
  }
  return rtlRender(ui, { wrapper: Wrapper });
}

export function recvControl(res: ControlResponse) {
  const calls = (window.ws.addEventListener as jest.Mock).mock.calls as [
    string,
    (event: { data: string }) => void
  ][];
  const handler = _.chain(calls)
    .filter(([channel]) => channel === 'message')
    .map(([, handler]) => handler)
    .last()
    .value();
  if (handler) {
    handler({ data: JSON.stringify(res) });
  }
}

export function delay(duration: number) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

export function init() {
  window.store.dispatch(initControl());
}

export async function refresh() {
  await window.store.dispatch(refreshData()).unwrap();
}

export async function logIn() {
  await window.store.dispatch(logInUser({ username: 'admin', password: 'test' })).unwrap();
}

export function getRows(table: HTMLTableElement) {
  const [tableBody] = table.getElementsByTagName('tbody') ?? [];
  return [...tableBody.getElementsByTagName('tr')] as HTMLTableRowElement[];
}

export function getColumn(table: HTMLTableElement, index: number): HTMLTableCellElement[] {
  const rows = getRows(table);
  return rows.map((row) => row.getElementsByTagName('td')[index]);
}

export * from '@testing-library/react';
