const fs = require('fs');
const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const { name, version, description, author, license } = JSON.parse(
  fs.readFileSync('package.json')
);

module.exports = [
  {
    mode: 'development',
    entry: {
      main: './app/main.ts',
      preload: './app/preload.ts',
    },
    target: 'electron-main',
    module: {
      rules: [
        {
          test: /\.ts$/i,
          exclude: /\.test\.tsx?$/,
          include: /app/,
          use: 'ts-loader',
        },
        {
          test: /\.node$/i,
          loader: 'node-loader',
        },
      ],
    },
    output: {
      path: path.join(__dirname, 'build'),
    },
    externals: {
      zeromq: 'commonjs zeromq',
    },
  },
  {
    mode: 'development',
    entry: './app/renderer.tsx',
    target: 'electron-renderer',
    devtool: 'source-map',
    module: {
      rules: [
        {
          test: /\.tsx?$/i,
          exclude: /\.test\.tsx?$/,
          include: /app/,
          use: 'ts-loader',
        },
        {
          test: /\.(sa|sc|c)ss$/i,
          use: ['style-loader', 'css-loader', 'sass-loader'],
        },
      ],
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.js', '.sass', '.scss'],
    },
    output: {
      path: path.join(__dirname, 'build'),
      filename: 'bundle.js',
    },
    node: { global: true },
    plugins: [
      new HtmlWebpackPlugin({ template: './app/index.html' }),
      /* BlueprintJS bug workaround: https://github.com/palantir/blueprint/issues/3739 */
      new webpack.DefinePlugin({
        'process.env': '{}',
        DAWN_PKG_INFO: JSON.stringify({
          name,
          version,
          description,
          author,
          license,
          buildTimestamp: new Date().getTime(),
        }),
      }),
    ],
  },
];
