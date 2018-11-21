#!/usr/bin/env node

"use strict";

let fs = require('fs');
let path = require('path');
let express = require('express');

let app = express();

app.listen(4000, () => {
  console.log('Listening on port 4000');
});

app.use('/dist', express.static('dist', {
  extensions: 'js'
}));

// This serves the current file paths to the app so it can edit the right files
app.engine('html', (filePath, options, callback) => {
  fs.readFile(filePath, (err, content) => {
    if (err) return callback(err);
    let rendered = content.toString()
      .replace('#rootPath#', 'file://' + __dirname + '/example-project/')
      .replace('#htmlPath#', 'file://' + __dirname + '/example-project/project.html')
      .replace('#cssPath#', 'file://' + __dirname + '/example-project/style.css')
      .replace('#jsPath#', 'file://' + __dirname + '/example-project/source.js');
    return callback(null, rendered)
  });
});
app.set('views', '');
app.set('view engine', 'html');

app.get('/', (req, res) => {
  res.render('index.html');
});
