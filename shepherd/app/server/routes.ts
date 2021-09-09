import * as http from 'http'; // TODO: support HTTPS
import * as path from 'path';
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

import db, { User as UserModel, Alliance, Team, Match, MatchEvent } from './db';
import FieldControl from './control';
import games from './games';

declare global {
  namespace Express {
    interface User extends UserModel {}
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

export default async function (options) {
  const app = express();
  const orm = await db.init(options.dbFilename);
  const users = orm.em.getRepository(UserModel);
  const server = http.createServer(app);
  const wsServer = new WebSocketServer({ server });
  const fc = new FieldControl(orm);
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
      done(null, await users.findOneOrFail({ username }));
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

  app.get('/user', (req, res) => {
    res.json({
      username: req.user?.username ?? null,
      game: options.game ?? null,
    });
  });

  crud(app, orm.em.getRepository(UserModel), '/users', 'username', {
    noRetrieve: true,
  });
  crud(app, orm.em.getRepository(Team), '/teams', 'id');
  crud(app, orm.em.getRepository(Alliance), '/alliances', 'id');
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
      await fc.broadcast(wsServer.clients);
    });

    await fc.broadcast([ws]);
  });

  setInterval(async () => {
    await fc.broadcast(wsServer.clients);
  }, 4000);

  server.listen(options.port, () => {
    // TODO: add hostname
    logger.info(`Serving on ${options.port}`);
  });
}
