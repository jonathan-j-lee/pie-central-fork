import {
  AllianceColor,
  GameState,
  MatchEvent as MatchEventData,
  MatchEventType,
} from '../types';
import {
  BaseEntity,
  Collection,
  Entity,
  EntityRepository,
  Enum,
  ManyToOne,
  MikroORM,
  OneToMany,
  OneToOne,
  PrimaryKey,
  Property,
} from '@mikro-orm/core';
import * as crypto from 'crypto';
import * as _ from 'lodash';
import { promisify } from 'util';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'debug',
  transports: [new winston.transports.Console()],
});

const pbkdf2 = promisify(crypto.pbkdf2);

@Entity()
export class User extends BaseEntity<User, 'username'> {
  @PrimaryKey()
  username!: string;

  @Property({ length: 32 })
  salt!: string;

  @Property({ length: 128 })
  hash!: string;

  @Property({ default: false })
  darkTheme!: boolean;

  static async hashPassword(password: string, salt?: string) {
    let saltBuf;
    if (salt) {
      saltBuf = Buffer.from(salt, 'hex');
    } else {
      saltBuf = crypto.randomBytes(16);
      salt = saltBuf.toString('hex');
    }
    const hash = await pbkdf2(password, saltBuf, 10000, 64, 'sha512');
    return { salt, hash: hash.toString('hex') };
  }

  static async authenticate(
    users: EntityRepository<User>,
    username: string,
    password: string
  ): Promise<User> {
    const user = await users.findOneOrFail({ username });
    const { hash } = await User.hashPassword(password, user.salt);
    if (hash !== user.hash) {
      throw new Error(`invalid password (username: ${username})`);
    }
    return user;
  }
}

// TODO: more stringent database constraints
@Entity()
export class Alliance extends BaseEntity<Alliance, 'id'> {
  @PrimaryKey()
  id!: number;

  @Property()
  name!: string;

  @OneToMany(() => Team, (team) => team.alliance)
  teams = new Collection<Team>(this);
}

@Entity()
export class Team extends BaseEntity<Team, 'id'> {
  @PrimaryKey()
  id!: number;

  @Property()
  number!: number;

  @Property()
  name!: string;

  @ManyToOne({ nullable: true })
  alliance?: Alliance;

  @Property()
  hostname!: string;

  @Property({ default: 6000 })
  callPort!: number;

  @Property({ default: 6001 })
  logPort!: number;

  @Property({ default: 6003 })
  updatePort!: number;

  @Property({ default: '224.1.1.1' })
  multicastGroup!: string;
}

@Entity()
export class Fixture extends BaseEntity<Fixture, 'id'> {
  @PrimaryKey()
  id!: number;

  @Property({ default: false })
  root!: boolean;

  @ManyToOne({ nullable: true })
  winner?: Alliance;

  @OneToOne({ nullable: true })
  blue?: Fixture;

  @OneToOne({ nullable: true })
  gold?: Fixture;

  @OneToMany(() => Match, (match) => match.fixture)
  matches = new Collection<Match>(this);
}

@Entity()
export class Match extends BaseEntity<Match, 'id'> {
  @PrimaryKey()
  id!: number;

  @ManyToOne({ nullable: true })
  fixture?: Fixture;

  @OneToMany({
    eager: true,
    orphanRemoval: true,
    entity: () => MatchEvent,
    mappedBy: (event) => event.match,
  })
  events = new Collection<MatchEvent>(this);

  static mapEvents(
    events: Partial<MatchEventData>[],
    game?: GameState
  ): Partial<MatchEventData>[] {
    const processed: Partial<MatchEventData>[] = [];
    const gameState = game ?? GameState.fromEvents([]);
    for (const event of events) {
      if (event.type === MatchEventType.JOIN) {
        event.timestamp = 0;
        if (!event.team) {
          continue;
        }
        const index = _.findIndex(
          processed,
          (maybeJoin) =>
            maybeJoin.type === MatchEventType.JOIN && maybeJoin.team === event.team
        );
        if (index >= 0) {
          processed[index] = { ...processed[index], ...event };
          gameState.apply(event);
          continue;
        }
      }
      if (event.team && !event.alliance) {
        event.alliance = gameState.getAlliance(event.team);
      }
      processed.push(event);
      gameState.apply(event);
    }
    return processed;
  }
}

@Entity()
export class MatchEvent extends BaseEntity<MatchEvent, 'id'> {
  @PrimaryKey()
  id!: number;

  @ManyToOne()
  match!: Match;

  @Enum(() => MatchEventType)
  type = MatchEventType.OTHER;

  @Property({ columnType: 'integer' })
  timestamp = Date.now(); // TODO: keep sorted by timestamp

  @Enum(() => AllianceColor)
  alliance = AllianceColor.NONE;

  @ManyToOne({ nullable: true })
  team?: Team;

  @Property({ columnType: 'real', nullable: true })
  value?: number;

  @Property({ nullable: true })
  description?: string;
}

async function init(filename: string) {
  const orm = await MikroORM.init({
    entities: [User, Alliance, Fixture, Team, Match, MatchEvent],
    type: 'sqlite',
    dbName: filename,
    discovery: { disableDynamicFileAccess: true },
  });
  const generator = orm.getSchemaGenerator();
  await generator.updateSchema();
  logger.debug('Successfully created database');
  try {
    const users = orm.em.getRepository(User);
    const user = users.create({
      username: 'admin',
      ...(await User.hashPassword('test')),
    });
    await users.persistAndFlush([user]);
    logger.debug('Created admin user');
  } catch {
    logger.warn('Admin user already exists');
  }
  return orm;
}

export default { init };
