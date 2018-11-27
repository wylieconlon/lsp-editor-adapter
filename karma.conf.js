process.env.CHROME_BIN = require('puppeteer').executablePath()

module.exports = function(config) {
  config.set({
    basePath: '',

    files: [
      'src/**/*.ts',
      'test/**/*.ts'
    ],

    browsers: ['Chrome'],
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
      bundlerOptions: {
        entrypoints: /\.test\.ts$/,
        transforms: [
          require("karma-typescript-es6-transform")()
        ]
      },
      compilerOptions: {
        // Prevent tests from running if there are compile error
        noEmitOnError: true,
        module: "commonjs",
        moduleResolution: "node",
        sourceMap: true,
        allowSyntheticDefaultImports: true,
        lib: ["ES6", "DOM", "ScriptHost"],
        target: "ES5"
      },
      exclude: ["node_modules/!(lodash-es)"],
      include: [
        "test",
        "src"
      ]
    },
  });
};
