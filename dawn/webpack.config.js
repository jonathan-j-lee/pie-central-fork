const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = [
  {
    mode: 'development',
    entry: './app/main.ts',
    target: 'electron-main',
    module: {
      rules: [{
        test: /\.ts$/i,
        include: /app/,
        use: 'ts-loader',
      }],
    },
    output: {
      path: path.join(__dirname, 'build'),
      filename: 'main.js',
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
          include: /app/,
          use: 'ts-loader'
        },
        {
          test: /\.s[ac]ss$/i,
          use: [
            // Creates `style` nodes from JS strings
            "style-loader",
            // Translates CSS into CommonJS
            "css-loader",
            // Compiles Sass to CSS
            "sass-loader",
          ],
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
    plugins: [
      new HtmlWebpackPlugin({template: './assets/index.html'}),
      /* BlueprintJS bug workaround: https://github.com/palantir/blueprint/issues/3739 */
      new webpack.DefinePlugin({
        "process.env": "{}",
      }),
    ],
  },
];
