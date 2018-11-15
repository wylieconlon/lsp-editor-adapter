# lsp-editor-adapter

A set of libraries for connecting browser-based text editors (like [CodeMirror](https://codemirror.net/)) with the [Language Server Protocol](https://microsoft.github.io/language-server-protocol/)

This library currently connects a single CodeMirror editor over a web socket connection to a language server, but the library-oriented nature allows this to be extended to support the Ace editor and other kinds of connections (such as a service worker).

## Running the example

There is an example server which runs three local language servers and allows editing all three files:

To run the example:

```
cd example
npm install
npm run start
```

then visit localhost:4000
