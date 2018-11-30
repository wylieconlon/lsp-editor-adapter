const path = require('path');

module.exports = {
  mode: "production",
  entry: {
    index: './src/index.ts'
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }, {
        test: /\.css$/,
        use: [
          { loader: 'style-loader' },
          { loader: 'css-loader' }
        ]
      }
    ]
  },
  resolve: {
    extensions: [ '.tsx', '.ts', '.js' ]
  },
  target: 'web',
  node: {
    net: 'mock',
  },
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'lib'),
    library: 'lsp-editor-adapter',
    libraryTarget: 'umd'
  },
  externals: {
    codemirror: {
      commonjs: 'codemirror',
      commonjs2: 'codemirror',
      amd: 'codemirror',
      root: 'CodeMirror'
    }
  }
};
