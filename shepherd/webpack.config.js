const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const optionalModules = new Set([
  ...Object.keys(require('knex/package.json').browser),
  ...Object.keys(require('@mikro-orm/core/package.json').peerDependencies),
  ...Object.keys(require('@mikro-orm/core/package.json').devDependencies || {}),
]);

module.exports = [
  {
    mode: 'development',
    entry: './app/server/index.ts',
    target: 'node',
    module: {
      rules: [
        {
          test: /\.ts$/i,
          exclude: /\.test\.tsx?$/i,
          include: /app/,
          use: 'ts-loader',
        },
      ],
    },
    resolve: {
      extensions: ['.ts', '.js'],
    },
    output: {
      path: path.join(__dirname, 'build'),
      filename: 'server.js',
    },
    node: {
      __dirname: true,
    },
    plugins: [
      new webpack.IgnorePlugin({
        checkResource(resource) {
          const baseResource = resource
            .split('/', resource[0] === '@' ? 2 : 1)
            .join('/');
          if (optionalModules.has(baseResource)) {
            try {
              require.resolve(resource);
              return false;
            } catch {
              return true;
            }
          }
          return false;
        },
      }),
    ],
    externals: {
      sqlite3: 'commonjs sqlite3',
    },
  },
  {
    mode: 'development',
    entry: './app/client/main.tsx',
    devtool: 'cheap-module-source-map',
    module: {
      rules: [
        {
          test: /\.tsx?$/i,
          exclude: /\.test\.tsx?$/i,
          include: /app/,
          use: 'ts-loader',
        },
        {
          test: /\.(sa|sc|c)ss$/i,
          use: [
            // Creates `style` nodes from JS strings
            'style-loader',
            // Translates CSS into CommonJS
            'css-loader',
            // Compiles Sass to CSS
            'sass-loader',
          ],
        },
      ],
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.js', '.sass', '.scss'],
    },
    output: {
      path: path.join(__dirname, 'build'),
      filename: 'static/bundle.js',
    },
    plugins: [
      new HtmlWebpackPlugin({ template: './app/client/index.html' }),
      /* BlueprintJS bug workaround: https://github.com/palantir/blueprint/issues/3739 */
      new webpack.DefinePlugin({
        'process.env': '{}',
      }),
    ],
  },
];
