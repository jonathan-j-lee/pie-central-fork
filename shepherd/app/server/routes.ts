import * as http from 'http'; // TODO: support HTTPS
import * as path from 'path';
import * as _ from 'lodash';
import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import session from 'express-session';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import winston from 'winston';
import { Server as WebSocketServer } from 'ws';
import { Strategy as LocalStrategy } from 'passport-local';
import { BaseEntity, EntityRepository, RequestContext } from '@mikro-orm/core';

import db, { User as UserModel, Alliance, Fixture, Team, Match, MatchEvent } from './db';
import FieldControl from './control';
import games from './games';
import { FixtureUpdate, LogSettings, User } from '../types';

declare global {
  namespace Express {
    interface User extends UserModel {}
  }
}

declare module 'express-session' {
  interface SessionData {
    user?: Partial<User>;
    log?: Partial<LogSettings>;
  }
}

const logger = winston.createLogger({
  level: 'debug',
  transports: [new winston.transports.Console()],
});

function ensureAuthenticated(req: Request, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV === 'development' || req.isAuthenticated()) {
    next();
  } else {
    res.sendStatus(401);
  }
}

// TODO: type the data parameter
function crud<T extends BaseEntity<T, any>>(
  app: Express,
  repository: EntityRepository<T>,
  baseRoute: string,
  pkName: keyof T,
  options: {
    noRetrieve?: boolean;
    mapUpdate?: (data: any) => any;
    update?: (entity: T, data: any) => Promise<T>;
  } = {}
) {
  const mapUpdate = options.mapUpdate ?? ((data) => data);
  const update = options.update ?? (async (entity) => entity);
  // TODO: log requests/errors

  if (!options.noRetrieve) {
    app.get(baseRoute, async (req, res) => {
      const entities: T[] = await repository.findAll();
      res.json(entities.map((entity) => entity.toJSON()));
    });
  }

  app.put(baseRoute, ensureAuthenticated, async (req, res) => {
    try {
      const entities = [];
      for (const data of req.body.map(mapUpdate)) {
        const id = data[pkName];
        if (id === null || id === undefined) {
          entities.push(repository.create(data));
        } else {
          const entity = (await repository.findOneOrFail(id)).assign(data);
          entities.push(await update(entity, data));
        }
      }
      await repository.persistAndFlush(entities);
      res.json(entities.map((entity) => entity.toJSON()));
    } catch (err) {
      return res.status(400).send({ err: err.message });
    }
  });

  app.delete(baseRoute, ensureAuthenticated, async (req, res) => {
    try {
      const entities = await repository.find({ [pkName]: { $in: req.body } });
      await repository.removeAndFlush(entities);
      res.json(entities.map((entity) => entity.toJSON()));
    } catch (err) {
      return res.status(400).send({ err: err.message });
    }
  });
}

interface RoutingOptions {
  port: number;
  dbFilename: string;
  sessionSecret: string;
  game?: string;
}

export default async function (options: RoutingOptions, controller?: AbortController) {
  const app = express();
  const orm = await db.init(options.dbFilename);
  const users = orm.em.getRepository(UserModel);
  const allianceRepo = orm.em.getRepository(Alliance);
  const fixtureRepo = orm.em.getRepository(Fixture);
  const server = http.createServer(app);
  const wsServer = new WebSocketServer({ server });
  const fc = new FieldControl(orm, wsServer);
  const dirname = path.dirname(__filename);

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const user = await UserModel.authenticate(users, username, password);
        done(null, user);
      } catch (err) {
        done(err);
      }
    })
  );

  passport.serializeUser<string>((user, done) => {
    done(null, user.username);
  });

  passport.deserializeUser<string>(async (username, done) => {
    try {
      done(null, await users.findOneOrFail({ username }, { refresh: true }));
    } catch (err) {
      done(err);
    }
  });

  app.use(helmet());
  app.use('/static', express.static(path.join(dirname, 'static')));
  app.use(cookieParser());
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(bodyParser.json());
  app.use(
    session({
      secret: options.sessionSecret,
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use(passport.initialize());
  app.use(passport.session());
  app.use((req, res, next) => RequestContext.create(orm.em, next));

  app.post('/login', passport.authenticate('local'), (req, res) => {
    const username = req.user?.username;
    logger.info('Logged in', { username });
    res.sendStatus(200);
  });

  app.post('/logout', (req, res) => {
    const username = req.user?.username;
    req.logout();
    logger.info('Logged out', { username });
    res.sendStatus(200);
  });

  app.get('/session', (req, res) => {
    res.json({
      user: {
        username: req.user?.username ?? null,
        darkTheme: req.user?.darkTheme ?? req.session.user?.darkTheme ?? true,
        game: options.game ?? null,
      },
      log: req.session.log,
    });
  });

  function mergeStrategy(obj: any, src: any) {
    if (_.isArray(src)) {
      return src;
    }
  }

  app.put('/session', async (req, res) => {
    req.session.user = _.mergeWith(req.session.user, req.body.user, mergeStrategy);
    req.session.log = _.mergeWith(req.session.log, req.body.log, mergeStrategy);
    if (req.user) {
      req.user.darkTheme = req.session.user?.darkTheme ?? req.user.darkTheme;
      await users.persistAndFlush(req.user);
    }
    // TODO: set log verbosity
    res.sendStatus(200);
  });

  crud(app, users, '/users', 'username', { noRetrieve: true });
  crud(app, orm.em.getRepository(Team), '/teams', 'id');
  crud(app, orm.em.getRepository(Alliance), '/alliances', 'id', {
    mapUpdate: (alliance) => _.omit(alliance, ['teams']),
  });
  crud(app, orm.em.getRepository(Match), '/matches', 'id', {
    mapUpdate: (match) => ({ ...match, events: Match.mapEvents(match.events) }),
    async update(match, data) {
      const events: MatchEvent[] = data.events ?? [];
      for (const event of events) {
        if (event.id) {
          const [entity] = await match.events.matching({ where: { id: event.id } });
          if (entity) {
            match.events.add(entity.assign(event));
          }
        }
      }
      return match;
    },
  });

  function loadFixtures(fixtureMap: Map<Fixture['id'], Fixture>, fixture: Fixture) {
    const data = fixture.toJSON();
    if (data.blue !== null) {
      const blue = fixtureMap.get(data.blue);
      data.blue = blue ? loadFixtures(fixtureMap, blue) : null;
    }
    if (data.gold !== null) {
      const gold = fixtureMap.get(data.gold);
      data.gold = gold ? loadFixtures(fixtureMap, gold) : null;
    }
    return data;
  }

  app.get('/bracket', async (req, res, done) => {
    try {
      const fixtureMap = new Map<Fixture['id'], Fixture>();
      const fixtures = await fixtureRepo.findAll();
      for (const fixture of fixtures) {
        fixtureMap.set(fixture.id, fixture);
      }
      const root = await fixtureRepo.findOne({ root: true });
      if (root) {
        res.json(loadFixtures(fixtureMap, root));
      } else {
        res.json(null);
      }
    } catch (err) {
      done(err);
    }
  });

  function lastBinaryPower(x: number) {
    return Math.pow(2, Math.floor(Math.log2(x)));
  }

  function *pairFixtures(fixtures: Fixture[]) {
    if (fixtures.length % 2 === 1) {
      throw new Error('provide an even number of fixtures');
    }
    const count = fixtures.length / 2;
    for (let i = 0; i < count; i++) {
      yield fixtureRepo.create({
        blue: fixtures[i],
        gold: fixtures[fixtures.length - 1 - i],
        root: false,
      });
    }
  }

  async function deleteBracket() {
    let fixtures = await fixtureRepo.findAll();
    await fixtureRepo.removeAndFlush(fixtures);
  }

  app.post('/bracket', ensureAuthenticated, async (req, res) => {
    await deleteBracket();
    let fixtures = await fixtureRepo.findAll();
    await fixtureRepo.removeAndFlush(fixtures);
    const alliances = _.isArray(req.body)
      ? req.body
      : (await allianceRepo.findAll()).map((alliance) => alliance.id);
    if (alliances.length === 0) {
      return res.sendStatus(400);
    }
    fixtures = alliances.map((alliance) => fixtureRepo.create({
      winner: alliance,
      root: false,
    }));
    while (fixtures.length > 1) {
      const byes = fixtures.length - lastBinaryPower(fixtures.length);
      if (byes > 0) {
        const worst = fixtures.splice(-2 * byes, 2 * byes);
        fixtures = fixtures.concat(Array.from(pairFixtures(worst)));
      } else {
        fixtures = Array.from(pairFixtures(fixtures));
      }
    }
    const [root] = fixtures;
    root.root = true;
    await fixtureRepo.persistAndFlush(root);
    res.sendStatus(200);
  });

  app.put('/bracket', ensureAuthenticated, async (req, res) => {
    const update = req.body as FixtureUpdate;
    const fixture = await fixtureRepo.findOneOrFail({ id: update.id });
    if (fixture.winner !== null) {
      const chain = [];
      let current: Fixture | null = fixture;
      while (current) {
        chain.push(current);
        current = await fixtureRepo.findOne({
          $or: [
            { blue: current.id },
            { gold: current.id },
          ],
          winner: current.winner,
        });
      }
      await fixtureRepo.persistAndFlush(chain.map((fixture) => fixture.assign({ winner: null })));
    }
    await fixtureRepo.persistAndFlush(fixture.assign({ winner: update.winner }));
    res.sendStatus(200);
  });

  app.delete('/bracket', ensureAuthenticated, async (req, res) => {
    await deleteBracket();
    res.sendStatus(200);
  });

  app.get('*', (req, res) => {
    res.sendFile(path.join(dirname, 'index.html'));
  });

  if (options.game) {
    const setupGame = games[options.game];
    if (setupGame) {
      setupGame(app, fc);
    }
  }

  wsServer.on('connection', async (ws) => {
    logger.info('WS connection established');

    // TODO: add authentication here
    ws.on('message', async (message) => {
      await fc.handle(JSON.parse(message.toString()));
      await fc.broadcast();
    });

    await fc.broadcast({ clients: [ws] });
  });

  const intervalId = setInterval(async () => {
    await fc.broadcast();
  }, 4000);

  server.listen({
    port: options.port,
    signal: controller?.signal,
  }, () => {
    // TODO: add hostname
    logger.info(`Serving on ${options.port}`);
  });

  controller?.signal.addEventListener('abort', () => {
    clearInterval(intervalId);
    orm.close();
  });

  return { app };
}
