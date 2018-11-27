import expect  from 'expect';
import * as CodeMirror from 'codemirror';
import CodeMirrorAdapter from '../src/codemirror/adapter'
import { MockConnection } from './mock-connection';

describe('CodeMirror adapter', () => {
  let editorEl : HTMLDivElement;
  let editor : CodeMirror.Editor;

  beforeEach(() => {
    editorEl = document.createElement('div');
    document.body.appendChild(editorEl);
    editor = CodeMirror(editorEl);
  });
  afterEach(() => {
    editorEl.remove();
  });

  it('sends a textDocument/didChange event for every character', () => {
    let connection = new MockConnection();
    let adapter = new CodeMirrorAdapter(connection, {}, editor);
    
    editor.setValue('a');
    expect(connection.sendChange.callCount).toEqual(1);

    editor.setValue('ab');
    expect(connection.sendChange.callCount).toEqual(2);
  });

  describe('autocompletion', () => {
    let connection : MockConnection;

    // Waits to run each test until the autocompletion capability is returned 
    beforeEach((done) => {
      connection = new MockConnection();
      connection.sendInitialize.onFirstCall().callsFake(() => {
        return new Promise((resolve) => {
          done();
          resolve(JSON.stringify({
            capabilities: {
              completionProvider: {
                resolveProvider: false,
                triggerCharacters: ['.']
              }
            }
          }));
        });
      });

      new CodeMirrorAdapter(connection, {}, editor);
    });

    it('requests autocompletion suggestions', () => {
      editor.setValue('a');
      expect(connection.getCompletion.callCount).toEqual(1);
    });
  });
});
