# lsp-editor-adapter

A library that automatically presents IDE-like elements for code editors in the browser using the the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/).

Currently, you can connect a [CodeMirror](https://codemirror.net/) document to a language server over WebSockets.
Future work will support language servers running in-browser, such as via Service Worker, and also support the
Ace editor.

## Features

The following features are all automatically configured once connected to a language server:

* Intellisense autocomplete
* Signature completion
* Hover tooltips
* Highlighting matching symbols in document
* Linting or syntax errors

All other features of the language server are not currently supported, but if you would like to add support,
please submit a pull request!

## Installation

Current requirements:

* Language server running on a web socket connection, such as [jsonrpc-ws-proxy](https://github.com/wylieconlon/jsonrpc-ws-proxy) 
* CodeMirror editor with the `show-hint` addon included
* Ability to import an ES6 module, which the library is packaged as

Example installation and connection:

``` javascript
import * as CodeMirror from 'codemirror';
// You are required to install the show-hint addon
import 'codemirror/addon/hint/show-hint.css';
import 'codemirror/addon/hint/show-hint';

import 'lsp-editor-adapter/lib/codemirror-lsp.css';
import { LspWsConnection, CodeMirrorAdapter } from 'lsp-editor-adapter';

let editor = CodeMirror(document.querySelector('.editor'), {
  value: 'hello world',

  // Optional: You can add a gutter for syntax error markers
  gutters: ['CodeMirror-lsp']
});

// Take a look at how the example is configured for ideas
let connectionOptions = {
  // Required: Web socket server for the given language server
  serverUri: 'ws://localhost:8080/html',
  // The following options are how the language server is configured, and are required
  rootUri: 'file:///path/to/a/directory',
  documentUri: 'file:///path/to/a/directory/file.html',
  documentText: () => editor.getValue(),
  languageId: 'html',
};

// The WebSocket is passed in to allow testability
let lspConnection = new LspWsConnection(editor)
  .connect(new WebSocket('ws://localhost:8080'));

// The adapter is what allows the editor to provide UI elements
let adapter = new CodeMirrorAdapter(lspConnection, {
  // UI-related options go here, allowing you to control the automatic features of the LSP, i.e.
  suggestOnTriggerCharacters: false
}, editor);

// You can also provide your own hooks:
lspConnection.on('error', (e) => {
  console.error(e)
});

// To clean up the adapter and connection:
adapter.remove();
lspConnection.close();
```

## Running the example

A fully-functional example project which runs three language servers and allows editing all three files
is available at /example

To run the example:

```
cd example
npm install
npm run start
```

then visit localhost:4000
