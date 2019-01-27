# lsp-editor-adapter (alpha)

A library that automatically presents IDE-like elements for code editors in the browser using the the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/).

Currently, you can connect a [CodeMirror](https://codemirror.net/) document to a language server over WebSockets.
Future work will support language servers running in-browser, such as via Service Worker, and also support the
Ace editor.

_This library is in development. Opening issues and pull requests is greatly appreciated!_

## Features

The following features are all automatically configured once connected to a language server:

* Intellisense autocomplete
* Signature completion
* Hover tooltips
* Highlighting matching symbols in document
* Linting or syntax errors
* Within the same file: Go to Definition, Type Definition, and Find References

All other features of the language server are not currently supported, but if you would like to add support,
please submit a pull request!

## Screenshots

These screenshots show the current state of the library:

Javascript/Typescript:

<img width="533" alt="screenshot 2019-01-21 01 03 47" src="https://user-images.githubusercontent.com/666475/51455610-6dcbbc80-1d18-11e9-8b8a-e7d757ca1440.png">

Swift:

<img width="459" alt="screenshot 2019-01-26 17 08 32" src="https://user-images.githubusercontent.com/666475/51793344-0d5fd380-218d-11e9-99bc-0e06e1f51c89.png">
<img width="580" alt="screenshot 2019-01-27 13 47 23" src="https://user-images.githubusercontent.com/666475/51805363-4c982e00-223a-11e9-97be-876fd1b49371.png">
<img width="581" alt="screenshot 2019-01-27 13 47 36" src="https://user-images.githubusercontent.com/666475/51805364-4c982e00-223a-11e9-9e4e-cd7f9ca05ff9.png">
<img width="601" alt="screenshot 2019-01-27 13 48 11" src="https://user-images.githubusercontent.com/666475/51805365-4c982e00-223a-11e9-9856-996ccfa4c8bc.png">


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

// Each adapter can have its own CSS
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

// You might need to provide your own hooks to handle navigating to another file, for example:
lspConnection.on('goTo', (locations) => {
  // Do something to handle the URI in this object
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

## Developing

To develop against this library, and see updates in the example, run both of these:

```
# From parent directory
npx webpack --watch
```

```
# From example directory
npm run dev
```

To run library tests, there are two options:

```
npm test
npm run test-dev
```

test-dev will watch the source code and rerun tests in the background
