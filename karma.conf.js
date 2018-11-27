process.env.CHROME_BIN = require('puppeteer').executablePath()

module.exports = function(config) {
  config.set({
    basePath: '',

    files: [
      'src/**/*.ts',
      'test/**/*.ts'
    ],

    browsers: ['ChromeHeadless'],
    mime: {
      'text/x-typescript': ['ts','tsx']
    },

    singleRun: true,
    autoWatch: false,

    frameworks: [
      'mocha',
      'karma-typescript'
    ],

    module: 'commonjs',

    reporters: [
      'mocha',
      'karma-typescript'
    ],

    preprocessors: {
      '**/*!(.d).ts': 'karma-typescript'
    },

    plugins: [
      'karma-mocha',
      'karma-chrome-launcher',
      'karma-typescript',
      'karma-mocha-reporter'
    ],

    karmaTypescriptConfig: {
      tsconfig: "./tsconfig-test.json",
      bundlerOptions: {
        entrypoints: /\.test\.ts$/,
        transforms: [
          require("karma-typescript-es6-transform")()
        ]
      }
    },
  });
};
