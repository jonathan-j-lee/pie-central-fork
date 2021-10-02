import serve from '../../app/server/routes';
import {
  AllianceColor,
  ControlRequest,
  ControlResponse,
  GameState,
  LogLevel,
  MatchEvent,
  MatchEventType,
  MatchPhase,
  TimerState,
} from '../../app/types';
import RuntimeClient from '@pioneers/runtime-client';
import * as _ from 'lodash';
import request from 'supertest';
import WebSocket from 'ws';

jest.mock('@pioneers/runtime-client');

let controller: AbortController | undefined;
let agent: ReturnType<typeof request.agent>;
let ws: WebSocket;
let matchId: number;
const broadcast = jest.fn();

const CONNECTION_SETTINGS = {
  callPort: 5000,
  logPort: 5001,
  updatePort: 5002,
  multicastGroup: '224.1.1.2',
};

function clientMockClear() {
  (RuntimeClient as jest.Mock).mockClear();
  (RuntimeClient.prototype.open as jest.Mock).mockClear();
  (RuntimeClient.prototype.close as jest.Mock).mockClear();
  (RuntimeClient.prototype.notify as jest.Mock).mockClear();
  (RuntimeClient.prototype.request as jest.Mock).mockClear();
  (RuntimeClient.prototype.sendControl as jest.Mock).mockClear();
}

function delay(duration: number) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

function sendControl(req: ControlRequest) {
  ws.send(JSON.stringify(req));
}

function recvControl(): Promise<ControlResponse> {
  return new Promise((resolve) => {
    broadcast.mockImplementationOnce((payload) => {
      resolve(JSON.parse(payload));
    });
  });
}

beforeEach(async () => {
  controller = new AbortController();
  const { app, server } = await serve(
    {
      port: 0,
      dbFilename: ':memory:',
      sessionSecret: 'test-secret',
      broadcastInterval: 400,
    },
    controller
  );
  const address = server.address();
  if (!address) {
    throw new Error('server has no address');
  }
  ws = new WebSocket(_.isString(address) ? address : `ws://localhost:${address.port}`);
  ws.on('message', broadcast);
  await recvControl();

  agent = request.agent(app);
  await agent.post('/login').send({ username: 'admin', password: 'test' }).expect(200);
  const {
    body: [team1, team2],
  } = await agent
    .put('/teams')
    .send([
      { number: 0, name: 'Berkeley', hostname: '192.168.1.1', ...CONNECTION_SETTINGS },
      { number: 1, name: 'Stanford', hostname: '192.168.1.2', ...CONNECTION_SETTINGS },
      { number: 2, name: 'MIT', hostname: '192.168.1.3', ...CONNECTION_SETTINGS },
    ])
    .expect(200);
  const {
    body: [match],
  } = await agent
    .put('/matches')
    .send([
      {
        events: [
          { type: MatchEventType.JOIN, alliance: AllianceColor.BLUE, team: team1.id },
          { type: MatchEventType.JOIN, alliance: AllianceColor.GOLD, team: team2.id },
          { type: MatchEventType.AUTO, team: team1.id, value: 30000, timestamp: 10000 },
          { type: MatchEventType.AUTO, team: team2.id, value: 30000, timestamp: 10000 },
        ],
      },
    ])
    .expect(200);
  matchId = match.id;
  clientMockClear();
});

afterEach(() => {
  jest.useRealTimers();
  controller?.abort();
  ws.close();
});

it('sets and clears the current match', async () => {
  sendControl({ matchId });
  await recvControl();
  await recvControl();
  expect(await recvControl()).toMatchObject({
    control: {
      matchId,
      timer: { timeRemaining: expect.any(Number), totalTime: 0, stage: 'init' },
      robots: [
        { teamId: 1, updateRate: 0, uids: [] },
        { teamId: 2, updateRate: 0, uids: [] },
      ],
    },
    match: {
      id: matchId,
      fixture: null,
      events: [
        { type: MatchEventType.JOIN, alliance: AllianceColor.BLUE, team: 1 },
        { type: MatchEventType.JOIN, alliance: AllianceColor.GOLD, team: 2 },
        {
          type: MatchEventType.AUTO,
          alliance: AllianceColor.BLUE,
          team: 1,
          value: 30000,
        },
        {
          type: MatchEventType.AUTO,
          alliance: AllianceColor.GOLD,
          team: 2,
          value: 30000,
        },
        { type: MatchEventType.IDLE, alliance: AllianceColor.BLUE, team: 1 },
        { type: MatchEventType.IDLE, alliance: AllianceColor.GOLD, team: 2 },
      ],
    },
  });

  const clients = (RuntimeClient as jest.Mock).mock.instances;
  expect(clients).toHaveLength(2);
  for (const [client, host] of _.zip(clients, ['192.168.1.1', '192.168.1.2'])) {
    expect(client.open).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ host, ...CONNECTION_SETTINGS })
    );
    expect(client.request).toHaveBeenCalledTimes(2);
    expect(client.request).toHaveBeenNthCalledWith(1, 'executor-service', 'auto');
    expect(client.request).toHaveBeenNthCalledWith(2, 'executor-service', 'idle');
  }

  sendControl({ matchId: null });
  expect(await recvControl()).toMatchObject({ control: { matchId: null, robots: [] } });
  for (const client of clients) {
    expect(client.request).toHaveBeenCalledTimes(3);
    expect(client.request).toHaveBeenLastCalledWith('executor-service', 'idle');
    expect(client.close).toHaveBeenCalled();
  }
});

it('reconnects all robots', async () => {
  jest.useFakeTimers(); // Stop timers from advancing
  sendControl({ matchId });
  await recvControl();
  const clients = (RuntimeClient as jest.Mock).mock.instances;
  expect(clients).toHaveLength(2);
  for (const client of clients) {
    expect(client.request).toHaveBeenLastCalledWith('executor-service', 'auto');
    expect(client.close).not.toHaveBeenCalled();
  }

  sendControl({ matchId, reconnect: true });
  await recvControl();
  expect(clients).toHaveLength(4);
  for (const client of clients.slice(0, 2)) {
    expect(client.request).toHaveBeenLastCalledWith('executor-service', 'idle');
    expect(client.close).toHaveBeenCalled();
  }
  for (const client of clients.slice(2)) {
    expect(client.open).toHaveBeenCalled();
    expect(client.request).toHaveBeenLastCalledWith('executor-service', 'auto');
  }
});

it('runs and automatically idles robots', async () => {
  const events = [
    { type: MatchEventType.TELEOP, team: 1, value: 10 },
    { type: MatchEventType.IDLE, team: 2 },
  ];
  sendControl({ matchId, events });
  await recvControl();
  await delay(50);

  const clients = (RuntimeClient as jest.Mock).mock.instances;
  expect(clients).toHaveLength(2);
  const [client1, client2] = clients;
  expect(client1.request).toHaveBeenCalledTimes(2);
  expect(client1.request).toHaveBeenNthCalledWith(1, 'executor-service', 'teleop');
  expect(client1.request).toHaveBeenNthCalledWith(2, 'executor-service', 'idle');
  expect(client2.request).toHaveBeenCalledTimes(1);
  expect(client2.request).toHaveBeenCalledWith('executor-service', 'idle');

  const {
    body: [match],
  } = await agent.get('/matches').expect(200);
  expect(match.events).toHaveLength(7);
  expect(match.events).toMatchObject(
    expect.arrayContaining(events.map((event) => expect.objectContaining(event)))
  );
  expect(_.last(match.events)).toMatchObject({
    type: MatchEventType.IDLE,
    team: 1,
    alliance: AllianceColor.BLUE,
  });
});

it('runs and preemptively idles robots', async () => {
  const autoEvents: Partial<MatchEvent>[] = [
    { type: MatchEventType.AUTO, team: 1, alliance: AllianceColor.BLUE, value: 100000 },
    { type: MatchEventType.AUTO, team: 2, alliance: AllianceColor.GOLD, value: 200000 },
  ];
  sendControl({ matchId, events: autoEvents });
  await recvControl();
  const idleEvents: Partial<MatchEvent>[] = [
    { type: MatchEventType.IDLE, team: 1, alliance: AllianceColor.BLUE },
    { type: MatchEventType.IDLE, team: 2, alliance: AllianceColor.GOLD },
  ];
  sendControl({ matchId, events: idleEvents });
  await recvControl();

  const clients = (RuntimeClient as jest.Mock).mock.instances;
  expect(clients).toHaveLength(2);
  for (const client of clients) {
    expect(client.request).toHaveBeenCalledTimes(2);
    expect(client.request).toHaveBeenNthCalledWith(1, 'executor-service', 'auto');
    expect(client.request).toHaveBeenNthCalledWith(2, 'executor-service', 'idle');
  }

  const {
    body: [match],
  } = await agent.get('/matches').expect(200);
  expect(match.events).toHaveLength(8);
  expect(match.events).toMatchObject(
    expect.arrayContaining(
      autoEvents.concat(idleEvents).map((event) => expect.objectContaining(event))
    )
  );
});

it('extends a match', async () => {
  const teleopEvents = [
    { type: MatchEventType.TELEOP, team: 1, alliance: AllianceColor.BLUE, value: 100 },
    { type: MatchEventType.TELEOP, team: 2, alliance: AllianceColor.GOLD, value: 100 },
  ];
  sendControl({ matchId, events: teleopEvents });
  await recvControl();
  const afterTeleop = Date.now();
  const extendEvents = [
    { type: MatchEventType.EXTEND, team: 1, alliance: AllianceColor.BLUE, value: 200 },
    { type: MatchEventType.EXTEND, team: 2, alliance: AllianceColor.GOLD, value: 200 },
  ];
  sendControl({ matchId, events: extendEvents });
  await recvControl();

  await delay(100);
  expect(Date.now() - afterTeleop).toBeLessThan(300);
  const clients = (RuntimeClient as jest.Mock).mock.instances;
  expect(clients).toHaveLength(2);
  for (const client of clients) {
    // TODO: prevent time extension from calling `*_setup()` again.
    expect(client.request).toHaveBeenCalledTimes(2);
    expect(client.request).toHaveBeenNthCalledWith(1, 'executor-service', 'teleop');
    expect(client.request).toHaveBeenNthCalledWith(2, 'executor-service', 'teleop');
  }

  await delay(200);
  expect(Date.now() - afterTeleop).toBeGreaterThan(300);
  await delay(100);
  for (const client of clients) {
    expect(client.request).toHaveBeenCalledTimes(3);
    expect(client.request).toHaveBeenNthCalledWith(3, 'executor-service', 'idle');
  }
});

it('e-stops robots', async () => {
  const events = [
    { type: MatchEventType.ESTOP, team: 1, alliance: AllianceColor.BLUE },
    { type: MatchEventType.ESTOP, team: 2, alliance: AllianceColor.GOLD },
  ];
  sendControl({ matchId, events });
  await recvControl();

  const clients = (RuntimeClient as jest.Mock).mock.instances;
  expect(clients).toHaveLength(2);
  for (const client of clients) {
    expect(client.notify).toHaveBeenLastCalledWith('executor-service', 'estop');
  }

  const {
    body: [match],
  } = await agent.get('/matches').expect(200);
  expect(match.events).toHaveLength(6);
  expect(match.events).toMatchObject(
    expect.arrayContaining(events.map((event) => expect.objectContaining(event)))
  );
});

it('sends async robot updates', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(50000);
  sendControl({ matchId });
  await recvControl();

  const clients = (RuntimeClient as jest.Mock).mock.instances;
  expect(clients).toHaveLength(2);
  const [[onUpdate]] = clients[0].open.mock.calls;
  onUpdate(new Error('bad decoding'), []);
  onUpdate(null, [
    {
      0: { switch0: true, switch1: false, switch2: true },
      1: { switch0: false, switch1: true, switch2: true },
    },
  ]);
  onUpdate(null, [
    {
      0: { switch0: true, switch1: false, switch2: true },
      2: { switch0: false, switch1: true, switch2: true },
    },
  ]);

  jest.advanceTimersByTime(2000);
  const res = await recvControl();
  expect(res.control.robots).toMatchObject([
    { teamId: 1, updateRate: 1, uids: ['0', '2'] }, // 2 updates in 2s
    { teamId: 2, updateRate: 0, uids: [] },
  ]);
});

it('sends async match updates', async () => {
  sendControl({ matchId });
  await recvControl();
  const {
    body: [match],
  } = await agent.get('/matches').expect(200);
  await agent
    .put('/matches')
    .send([
      {
        ...match,
        events: [
          ...match.events,
          { type: MatchEventType.ADD, alliance: AllianceColor.BLUE, value: 5 },
        ],
      },
    ])
    .expect(200);
  const res = await recvControl();
  const gameBefore = GameState.fromEvents(match.events);
  const gameAfter = GameState.fromEvents(res.match?.events ?? []);
  expect(gameBefore.blue.score).toBeCloseTo(0);
  expect(gameAfter.blue.score).toBeCloseTo(5);
});

it.each([[MatchPhase.AUTO], [MatchPhase.TELEOP]])(
  'sends async timer updates during %s',
  async (phase) => {
    jest.useFakeTimers();
    jest.setSystemTime(50000);
    const timer: TimerState = {
      phase,
      timeRemaining: 10000,
      totalTime: 10000,
      stage: 'init',
    };

    sendControl({ matchId, timer });
    jest.advanceTimersByTime(50000);
    expect((await recvControl()).control.timer).toMatchObject(timer);

    const type =
      phase === MatchPhase.AUTO ? MatchEventType.AUTO : MatchEventType.TELEOP;
    sendControl({
      events: [
        { type, team: 1, value: 10000 },
        { type, team: 2, value: 10000 },
      ],
    });
    for (const i of _.range(10)) {
      expect((await recvControl()).control.timer).toMatchObject({
        ...timer,
        timeRemaining: 10000 - i * 1000,
        stage: 'running',
      });
      jest.advanceTimersByTime(1000);
    }
    expect((await recvControl()).control.timer).toMatchObject({
      ...timer,
      timeRemaining: 0,
      stage: 'done',
    });

    sendControl({ matchId, timer });
    jest.advanceTimersByTime(50000);
    expect((await recvControl()).control.timer).toMatchObject(timer);
  }
);

it('sends async log updates', async () => {
  sendControl({ matchId });
  await recvControl();
  await delay(50); // Knex (SQL query generator) will time out without this delay
  const clients = (RuntimeClient as jest.Mock).mock.instances;
  expect(clients).toHaveLength(2);
  const event = {
    timestamp: '2021-09-30T20:17:45.748Z',
    level: LogLevel.INFO,
    event: 'Process started',
  };
  const teams = [
    { id: 1, number: 0, name: 'Berkeley', hostname: '192.168.1.1' },
    { id: 2, number: 1, name: 'Stanford', hostname: '192.168.1.2' },
  ];
  for (const [client, team] of _.zip(clients, teams)) {
    const [[, onEvent]] = client.open.mock.calls;
    onEvent(new Error('bad decoding'), []);
    onEvent(null, [{ ...event, team }]);
    await recvControl();
    await delay(50);
    const events = _.chain(broadcast.mock.calls)
      .map(([payload]) => JSON.parse(payload).events ?? [])
      .flatten()
      .value();
    expect(events).toMatchObject(expect.arrayContaining([{ ...event, team }]));
  }
});

it('disconnects from a robot', async () => {
  sendControl({ matchId });
  await recvControl();
  const {
    body: [match],
  } = await agent.get('/matches').expect(200);
  await agent
    .put('/matches')
    .send([{ ...match, events: match.events.slice(1) }])
    .expect(200);

  sendControl({ matchId });
  const res = await recvControl();
  const [client1, client2] = (RuntimeClient as jest.Mock).mock.instances;
  expect(client1.request).toHaveBeenLastCalledWith('executor-service', 'idle');
  expect(client1.close).toHaveBeenCalled();
  expect(client2.close).not.toHaveBeenCalled();
  expect(res.control.robots).toMatchObject([{ teamId: 2 }]);
});

it('broadcasts updates to multiple websocket clients', async () => {
  const ws2 = new WebSocket(ws.url);
  const broadcast2 = jest.fn();
  ws2.addEventListener('message', broadcast2);
  await delay(420);
  try {
    expect(broadcast2.mock.calls.length).toBeGreaterThanOrEqual(2);
  } finally {
    ws2.close();
  }
});

it.each([[MatchEventType.AUTO], [MatchEventType.TELEOP]])(
  'does not block when a robot is offline during %s',
  async (type) => {
    sendControl({ matchId });
    await recvControl();
    await delay(50); // Knex (SQL query generator) will time out without this delay
    const [client1, client2] = (RuntimeClient as jest.Mock).mock.instances;
    let done = false;
    client1.request.mockImplementation(async () => {
      // eslint-disable-next-line no-unmodified-loop-condition
      while (!done) {
        await delay(50);
      }
    });

    try {
      sendControl({
        matchId,
        events: [
          { type, team: 1, value: 10000 },
          { type, team: 2, value: 10000 },
        ],
      });
      const res = await recvControl();
      await delay(50);
      expect(res.match?.events ?? []).toHaveLength(8);
      expect(client2.request).toHaveBeenCalledTimes(3);
      expect(client2.request).toHaveBeenCalledWith('executor-service', type);
    } finally {
      done = true;
    }
  }
);
