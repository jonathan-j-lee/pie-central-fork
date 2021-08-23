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
import { BaseEntity, EntityRepository, MikroORM, RequestContext } from '@mikro-orm/core';
import db, { User as UserModel, Alliance, Team } from './db';

declare global {
  namespace Express {
    interface User extends UserModel {
    }
  }
}

const logger = winston.createLogger({
  level: 'debug',
  transports: [new winston.transports.Console()],
});

function ensureAuthenticated(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) {
    next();
  } else {
    res.sendStatus(401);
  }
}

function api<T extends BaseEntity<T, any>>(
  app: Express,
  repository: EntityRepository<T>,
  baseRoute: string,
  parseId: (id: string) => any = (id) => id,
) {
  app.get(baseRoute, async (req, res) => {
    const entities: Array<T> = await repository.findAll();
    res.json(entities.map((entity) => entity.toJSON()));
  });

  app.post(baseRoute, async (req, res) => {
    try {
      const entity = repository.create(req.body);
      await repository.persistAndFlush(entity);
      res.json(entity.toJSON());
    } catch (err) {
      return res.status(400).send({ err: err.message });
    }
  });

  app.put(path.join(baseRoute, ':id'), async (req, res) => {
    try {
      const prevEntity = await repository.findOneOrFail(parseId(req.params.id));
      const entity = prevEntity.assign(req.body);
      await repository.persistAndFlush(entity);
      res.json(entity.toJSON());
    } catch (err) {
      return res.status(400).send({ err: err.message });
    }
  });

  app.delete(path.join(baseRoute, ':id'), async (req, res) => {
    try {
      const entity = await repository.findOneOrFail(parseId(req.params.id));
      await repository.removeAndFlush(entity);
      res.json(entity.toJSON());
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
  app.use('/static', express.static(path.join(__dirname, 'static')));
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
    res.json({
      username,
    });
  });

  app.post('/logout', (req, res) => {
    const username = req.user?.username;
    req.logout();
    logger.info('Logged out', { username });
    res.json({});
  });

  app.get('/user', (req, res) => {
    res.json({
      username: req.user?.username,
    });
  });

  // api(app, orm.em.getRepository(UserModel), '/user');
  api(app, orm.em.getRepository(Alliance), '/alliance', (id) => Number(id));
  api(app, orm.em.getRepository(Team), '/team', (id) => Number(id));

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
  });

  wsServer.on('connection', (ws) => {
    logger.info('WS connection');
  });

  server.listen(options.port, () => {  // TODO: add hostname
    logger.info(`Serving on ${options.port}`);
  });
}
