import * as CodeMirror from 'codemirror';
// import 'codemirror/addon/hint/show-hint';
import 'codemirror/mode/javascript/javascript';
import 'codemirror/mode/htmlmixed/htmlmixed';
import 'codemirror/mode/css/css';
import 'codemirror/lib/codemirror.css';
import 'codemirror/theme/idea.css';

import * as lsProtocol from 'vscode-languageserver-protocol';
import CodeMirrorAdapter from '../src/codemirror/adapter';
import LSPConnection from '../src/ws-connection';

// import { IPosition, TokenInfo} from '../src/index';
// import registerCodeMirror from '../src/index';
// import createConnection from '../src/index';
// import * as index from '../src/index';

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

let htmlConnection = new LSPConnection(html);
let htmlAdapter = new CodeMirrorAdapter(htmlConnection, {}, htmlEditor);
let cssConnection = new LSPConnection(css);
let cssAdapter = new CodeMirrorAdapter(cssConnection, {}, cssEditor);
let jsConnection = new LSPConnection(js);
let jsAdapter = new CodeMirrorAdapter(jsConnection, {}, jsEditor);
