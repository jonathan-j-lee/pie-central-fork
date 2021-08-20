const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = [
  {
    mode: 'development',
    entry: './app/server/main.ts',
    target: 'node',
    module: {
      rules: [
        {
          test: /\.ts$/i,
          exclude: /\.test\.tsx?$/i,
          include: /app\/server/,
          use: 'ts-loader',
        },
      ],
    },
    output: {
      path: path.join(__dirname, 'build'),
      filename: 'server.js',
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
          include: /app\/client/,
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
