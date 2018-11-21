import * as CodeMirror from 'codemirror';
import 'codemirror/mode/javascript/javascript';
import 'codemirror/mode/htmlmixed/htmlmixed';
import 'codemirror/mode/css/css';
import 'codemirror/lib/codemirror.css';
import 'codemirror/theme/idea.css';
// The plugin currently requires the show-hint extension from CodeMirror, which must be
// installed by the app that uses the LSP connection
import 'codemirror/addon/hint/show-hint.css';
import 'codemirror/addon/hint/show-hint';

import CodeMirrorAdapter from '../src/codemirror/adapter';
import LSPConnection from '../src/ws-connection';

let sampleJs = `
let values = [15, 2, 7, 9, 17, 99, 50, 3];
let total = 0;

for (let i; i < values.length; i++) {
  total += values[i];
}
`;

let sampleHtml = `
<html>
  <head>
    <title>Page Title</title>
  </head>
  <body>
    <h1>Basic HTML</h1>
  </body>
</html>
`;

let sampleCss = `
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
}

.header {
  color: blue;
}
`;

let htmlEditor = CodeMirror(document.querySelector('.html'), {
  theme: 'idea',
  lineNumbers: true,
  mode: 'htmlmixed',
  value: sampleHtml,
});

let cssEditor = CodeMirror(document.querySelector('.css'), {
  theme: 'idea',
  lineNumbers: true,
  mode: 'css',
  value: sampleCss,
});

let jsEditor = CodeMirror(document.querySelector('.js'), {
  theme: 'idea',
  lineNumbers: true,
  mode: 'javascript',
  value: sampleJs,
});

interface lspServerOptions {
  rootPath: string;
  htmlPath: string;
  cssPath: string;
  jsPath: string;
}

let html = {
  serverUri: 'ws://localhost:3000/html',
  languageId: 'html',
  rootUri: (window as any).lspOptions.rootPath,
  documentUri: (window as any).lspOptions.htmlPath,
  documentText: () => htmlEditor.getValue(),
};

let js = {
  serverUri: 'ws://localhost:3000/javascript',
  languageId: 'javascript',
  rootUri: (window as any).lspOptions.rootPath,
  documentUri: (window as any).lspOptions.jsPath,
  documentText: () => jsEditor.getValue(),
};

let css = {
  serverUri: 'ws://localhost:3000/css',
  languageId: 'css',
  rootUri: (window as any).lspOptions.rootPath,
  documentUri: (window as any).lspOptions.cssPath,
  documentText: () => cssEditor.getValue(),
};

let htmlConnection = new LSPConnection(html).connect(new WebSocket(html.serverUri));
let htmlAdapter = new CodeMirrorAdapter(htmlConnection, {}, htmlEditor);
let cssConnection = new LSPConnection(css).connect(new WebSocket(css.serverUri));
let cssAdapter = new CodeMirrorAdapter(cssConnection, {}, cssEditor);
let jsConnection = new LSPConnection(js).connect(new WebSocket(js.serverUri));
let jsAdapter = new CodeMirrorAdapter(jsConnection, {}, jsEditor);
