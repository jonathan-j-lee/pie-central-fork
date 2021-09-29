import request from 'supertest';
import * as _ from 'lodash';
import serve from '../../app/server/routes';
import {
  Alliance,
  AllianceColor,
  Fixture,
  LogLevel,
  Match,
  MatchEventType,
  Team,
} from '../../app/types';

let controller: AbortController | undefined;
let agent: ReturnType<typeof request.agent>;

const logIn = (username = 'admin', password = 'test', status = 200) => agent
  .post('/login')
  .send({ username, password })
  .expect(status);

const logOut = () => agent
  .post('/logout')
  .expect(200);

beforeEach(async () => {
  controller = new AbortController();
  const { app } = await serve({
    port: 0,
    dbFilename: ':memory:',
    sessionSecret: 'test-secret',
    broadcastInterval: 10000,
  }, controller);
  agent = request.agent(app);
  await logIn();
});

afterEach(() => {
  controller?.abort();
});

describe('user/session data', () => {
  it('rejects bad login attempts', async () => {
    await logOut();
    await logIn('admin', 'not-a-password', 500);
    await logIn('not-a-user', 'not-a-password', 500);
  });

  it('should set session data', async () => {
    await agent
      .put('/session')
      .send({
        user: { darkTheme: false },
        log: {
          maxEvents: 1024,
          level: LogLevel.WARNING,
          filters: [{ exclude: false, key: 'key', value: 5 }],
          pinToBottom: false,
        },
      })
      .expect(200);
    let response = await agent
      .get('/session')
      .expect(200);
    expect(response.body).toMatchObject({
      user: { username: 'admin', darkTheme: false },
      log: {
        maxEvents: 1024,
        level: LogLevel.WARNING,
        filters: [{ exclude: false, key: 'key', value: 5 }],
        pinToBottom: false,
      },
    });
    await agent
      .put('/session')
      .send({
        log: {
          filters: [
            { exclude: true, key: 'key1', value: 5 },
            { exclude: true, key: 'key2', value: 5 },
          ],
        },
      })
      .expect(200);
    await logOut();
    response = await agent
      .get('/session')
      .expect(200);
    expect(response.body).toMatchObject({
      user: { username: null },
      log: {
        filters: [
          { exclude: true, key: 'key1', value: 5 },
          { exclude: true, key: 'key2', value: 5 },
        ],
      },
    });
  });

  it('should persist the theme setting', async () => {
    await agent
      .put('/session')
      .send({ user: { darkTheme: false } })
      .expect(200);
    await logOut();
    await agent
      .put('/session')
      .send({ user: { darkTheme: true } })
      .expect(200);
    await logIn();
    const response = await agent
      .get('/session')
      .expect(200);
    expect(response.body).toMatchObject({ user: { darkTheme: false } });
  });
});

describe.each([
  [
    '/alliances',
    { name: 'Alliance' },
    { name: 'Alliance 2' },
  ],
  [
    '/teams',
    { number: 0, name: 'Berkeley', hostname: 'localhost' },
    { number: 1, hostname: '127.0.0.1', logPort: 7000, multicastGroup: '224.1.1.2' },
  ],
  [
    '/matches',
    { events: [{ type: MatchEventType.ADD, value: 5.5 }] },
    { events: [{ type: MatchEventType.MULTIPLY, value: 1 }] },
  ],
])('%s endpoint', (endpoint, data, update) => {
  it('performs basic CRUD operations on entities', async () => {
    let response = await agent
      .get(endpoint)
      .expect(200);
    expect(response.body).toMatchObject([]);
    await agent
      .put(endpoint)
      .send([data, data])
      .expect(200);
    response = await agent
      .get(endpoint)
      .expect(200);
    const [entity1, entity2] = response.body;
    expect(response.body).toMatchObject([data, data]);
    response = await agent
      .put(endpoint)
      .send([{ ...entity2, ...update }])
      .expect(200);
    expect(response.body).toMatchObject([{ ...data, ...update }]);
    response = await agent
      .delete(endpoint)
      .send([entity1.id])
      .expect(200);
    expect(response.body).toMatchObject([data]);
    response = await agent
      .get(endpoint)
      .expect(200);
    expect(response.body).toMatchObject([{ ...data, ...update }]);
  });

  it('rejects a bad payload', async () => {
    let response = await agent
      .put(endpoint)
      .send(data)
      .expect(400);
    expect(response.body.err).toBeTruthy();
    response = await agent
      .put(endpoint)
      .expect(400);
    expect(response.body.err).toBeTruthy();
    response = await agent
      .delete(endpoint)
      .expect(400);
    expect(response.body.err).toBeTruthy();
  });

  it('rejects updating or deleting nonexistent entities', async () => {
    let response = await agent
      .put(endpoint)
      .send([{ ...data, id: 9999 }])
      .expect(400);
    expect(response.body.err).toBeTruthy();
  });

  it('rejects unauthenticated writes', async () => {
    const response = await agent
      .put(endpoint)
      .send([data])
      .expect(200);
    const [entity] = response.body;
    await logOut();
    await agent
      .put(endpoint)
      .send([data])
      .expect(401);
    await agent
      .delete(endpoint)
      .send([entity.id])
      .expect(401);
  });
});

describe('entity relationships', () => {
  let alliance: Alliance;
  let team: Team;
  let match: Match;

  beforeEach(async () => {
    let response = await agent
      .put('/alliances')
      .send([{ name: 'Berkeley' }])
      .expect(200);
    alliance = response.body[0];
    response = await agent
      .put('/teams')
      .send([
        { number: 0, name: 'Berkeley', hostname: 'localhost', alliance: alliance.id },
      ])
      .expect(200);
    team = response.body[0];
    await agent
      .put('/matches')
      .send([
        {
          events: [
            { type: MatchEventType.JOIN, alliance: AllianceColor.BLUE, team: team.id },
            { type: MatchEventType.JOIN, alliance: AllianceColor.GOLD },
            {
              type: MatchEventType.JOIN,
              timestamp: 1,
              alliance: AllianceColor.GOLD,
              team: team.id,
            },
            { type: MatchEventType.ADD, team: team.id },
          ],
        },
      ])
      .expect(200);
    response = await agent
      .get('/matches')
      .expect(200);
    match = response.body[0];
  });

  it('casacdes alliance deletion', async () => {
    await agent
      .delete('/alliances')
      .send([alliance.id])
      .expect(200);
    const response = await agent
      .get('/teams')
      .expect(200);
    expect(response.body).toMatchObject([{ name: 'Berkeley', alliance: null }]);
  });

  it('casacdes team deletion', async () => {
    await agent
      .delete('/teams')
      .send([team.id])
      .expect(200);
    const response = await agent
      .get('/matches')
      .expect(200);
    expect(response.body).toMatchObject([{ events: [] }]);
  });

  it('cascades bracket deletion', async () => {
    await agent
      .post('/bracket')
      .expect(200);
    let response = await agent
      .get('/bracket')
      .expect(200);
    const fixture = response.body.id;
    response = await agent
      .put('/matches')
      .send([{ id: match.id, fixture, events: match.events }])
      .expect(200);
    expect(response.body).toMatchObject([{ fixture }]);
    await agent
      .delete('/bracket')
      .expect(200);
    response = await agent
      .get('/matches')
      .expect(200);
    expect(response.body).toMatchObject([{ fixture: null }]);
  });

  it('prevents alliance deletion when it exists in a bracket', async () => {
    await agent
      .post('/bracket')
      .expect(200);
    await agent
      .delete('/alliances')
      .send([alliance.id])
      .expect(200);
    const response = await agent
      .get('/alliances')
      .expect(200);
    expect(response.body.length).toBe(1);
  });

  it('validates match events', async () => {
    expect(match).toMatchObject({
      events: [
        {
          type: MatchEventType.JOIN,
          timestamp: 0,
          alliance: AllianceColor.GOLD,
          team: team.id,
        },
        { type: MatchEventType.ADD, alliance: AllianceColor.GOLD, team: team.id },
      ],
    });
  });
});

interface SymmetricFixture {
  winner: number | null;
  children?: [SymmetricFixture, SymmetricFixture];
}

describe.each([
  [1, { winner: 1 }],
  [2, { winner: null, children: [{ winner: 1 }, { winner: 2 }] } as SymmetricFixture],
  [
    3,
    {
      winner: null,
      children: [
        { winner: 1 },
        { winner: null, children: [{ winner: 2 }, { winner: 3 }] },
      ],
    } as SymmetricFixture,
  ],
  [
    4,
    {
      winner: null,
      children: [
        { winner: null, children: [{ winner: 1 }, { winner: 4 }] },
        { winner: null, children: [{ winner: 2 }, { winner: 3 }] },
      ],
    } as SymmetricFixture,
  ],
  [
    9,
    {
      winner: null,
      children: [
        {
          winner: null,
          children: [
            {
              winner: null,
              children: [
                { winner: 1 },
                { winner: null, children: [{ winner: 8 }, { winner: 9 }] },
              ],
            },
            { winner: null, children: [{ winner: 4 }, { winner: 5 }] },
          ],
        },
        {
          winner: null,
          children: [
            { winner: null, children: [{ winner: 2 }, { winner: 7 }] },
            { winner: null, children: [{ winner: 3 }, { winner: 6 }] },
          ],
        },
      ],
    } as SymmetricFixture,
  ],
])('bracket generation with %s alliances', (numAlliances, expected: SymmetricFixture | null) => {
  const allianceIds = _.range(1, 1 + numAlliances);

  beforeEach(async () => {
    await agent
      .put('/alliances')
      .send(allianceIds.map((i) => ({ name: `Alliance ${i}` })))
      .expect(200);
  });

  function matchesTree(current: Fixture | null, expected: SymmetricFixture | null): boolean {
    if (!current || !expected) {
      return current === expected;
    } else if (current.winner !== expected.winner) {
      return false;
    }
    const [child1, child2] = expected.children ?? [null, null];
    return matchesTree(current.blue, child1) && matchesTree(current.gold, child2)
      || matchesTree(current.gold, child1) && matchesTree(current.blue, child2);
  }

  it('generates the correct structure', async () => {
    let response = await agent
      .get('/bracket')
      .expect(200);
    expect(response.body).toBeNull();
    await agent
      .post('/bracket')
      .send(allianceIds)
      .expect(200);
    response = await agent
      .get('/bracket')
      .expect(200);
    expect(matchesTree(response.body, expected)).toBeTruthy();
  });

  it('can delete a bracket', async () => {
    await agent
      .post('/bracket')
      .send(allianceIds)
      .expect(200);
    await agent
      .delete('/bracket')
      .expect(200);
    await agent
      .delete('/bracket')
      .expect(200);
    const response = await agent
      .get('/bracket')
      .expect(200);
    expect(response.body).toBeNull();
  });

  it('rejects unauthentiated bracket creation/deletion', async () => {
    await agent
      .post('/bracket')
      .send(allianceIds)
      .expect(200);
    await logOut();
    await agent
      .post('/bracket')
      .expect(401);
    await agent
      .delete('/bracket')
      .expect(401);
    await logIn();
    const response = await agent
      .get('/bracket')
      .expect(200);
    expect(response.body).not.toBeNull();
  });
});

function searchBracket(
  fixture: Fixture | null,
  alliance1: number | null,
  alliance2: number | null,
): Fixture | null {
  if (!fixture) {
    return null;
  }
  const blue = fixture.blue?.winner ?? null;
  const gold = fixture.gold?.winner ?? null;
  if (blue === alliance1 && gold === alliance2 || blue === alliance2 && gold === alliance1) {
    return fixture;
  }
  return searchBracket(fixture.blue, alliance1, alliance2)
    ?? searchBracket(fixture.gold, alliance1, alliance2);
}

it.each([null, 9])('overwrites a bracket winner (%d)', async (winner) => {
  const allianceIds = _.range(1, 10);
  await agent
    .put('/alliances')
    .send(allianceIds.map((i) => ({ name: `Alliance ${i}` })))
    .expect(200);
  await agent
    .post('/bracket')
    .send(allianceIds)
    .expect(200);
  const competitors = [9, 1, null, null];
  for (const competitor of competitors) {
    const response = await agent
      .get('/bracket')
      .expect(200);
    await agent
      .put('/bracket')
      .send({ id: searchBracket(response.body, 8, competitor)?.id, winner: 8 })
      .expect(200);
  }
  let response = await agent
    .get('/bracket')
    .expect(200);
  await agent
    .put('/bracket')
    .send({ id: searchBracket(response.body, 8, 9)?.id, winner })
    .expect(200);
  response = await agent
    .get('/bracket')
    .expect(200);
  expect(searchBracket(response.body, 8, 9)?.winner).toEqual(winner);
  expect(searchBracket(response.body, 8, 1)).toBeNull();
  expect(searchBracket(response.body, 8, null)).toBeNull();
  // TODO: reject unknown winner
});
