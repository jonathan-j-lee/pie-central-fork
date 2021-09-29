import yargs from 'yargs';
import * as _ from 'lodash';
import { hideBin } from 'yargs/helpers';
import games from './games';
import serve from './routes';

yargs(hideBin(process.argv))
  .env('SHEPHERD')
  .command(
    'serve',
    'Start the server.',
    {
      // TODO: add debug flag
      port: {
        alias: 'p',
        default: 4040,
        type: 'number',
      },
      dbFilename: {
        alias: 'db-filename',
        default: 'shepherd.sqlite',
        type: 'string',
      },
      sessionSecret: {
        alias: 'session-secret',
        default: '',
        type: 'string',
      },
      broadcastInterval: {
        alias: 'b',
        default: 1000,
        type: 'number',
      },
      game: {
        choices: _.keys(games),
      },
    },
    serve,
  )
  .parse();
