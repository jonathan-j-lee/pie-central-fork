import * as crypto from 'crypto';
import {
  BaseEntity,
  Collection,
  Entity,
  EntityRepository,
  Enum,
  ManyToMany,
  ManyToOne,
  MikroORM,
  OneToMany,
  PrimaryKey,
  Property,
} from '@mikro-orm/core';
import { TsMorphMetadataProvider } from '@mikro-orm/reflection';
import winston from 'winston';
import { promisify } from 'util';

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
}

@Entity()
export class Match extends BaseEntity<Match, 'id'> {
  @PrimaryKey()
  id!: number;

  @Property()
  next?: Match;

  @OneToMany(() => MatchEvent, (event) => event.match)
  events = new Collection<MatchEvent>(this);

  // @Property({ persist: false })
  // get blueAlliance() {
  // }
}

enum MatchEventType {
  JOIN_BLUE = 'join-blue',
  JOIN_GOLD = 'join-gold',
  START_AUTO = 'start-auto',
  STOP_AUTO = 'stop-auto',
  START_TELEOP = 'start-teleop',
  STOP_TELEOP = 'stop-teleop',
  ADD = 'add',
  SUBTRACT = 'subtract',
  MULTIPLY = 'multiply',
  EXTEND = 'extend',
  OTHER = 'other',
}

@Entity()
export class MatchEvent extends BaseEntity<MatchEvent, 'id'> {
  @PrimaryKey()
  id!: number;

  @ManyToOne()
  match!: Match;

  // FIXME: @Enum()
  @Property()
  type!: MatchEventType;

  @Property()
  timestamp = new Date();

  @Property()
  team?: Team;

  @Property()
  value?: number;

  @Property()
  description?: string;
}

async function init(filename: string) {
  const orm = await MikroORM.init({
    entities: [User, Alliance, Team, Match, MatchEvent],
    type: 'sqlite',
    dbName: filename,
    discovery: { disableDynamicFileAccess: true },
    metadataProvider: TsMorphMetadataProvider,
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
