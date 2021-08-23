import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import serve from './routes';

yargs(hideBin(process.argv))
  .env('SHEPHERD')
  .command(
    'serve',
    'Start the server.',
    {
      port: {
        alias: 'p',
        default: 4040,
        type: 'number',
      },
      'db-filename': {
        default: 'shepherd.sqlite',
        type: 'string',
      },
      'session-secret': {
        default: '',
        type: 'string',
      },
    },
    serve
  ).argv;
