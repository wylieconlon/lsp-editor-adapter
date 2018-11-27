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
    document.body.removeChild(editorEl);
    editorEl.remove();
  });

  it('sends a textDocument/didChange event for every character', (done) => {
    let connection = new MockConnection();
    let adapter = new CodeMirrorAdapter(connection, {
      debounceSuggestionsWhileTyping: 10
    }, editor);
    
    editor.setValue('a');

    // TODO: Use sinon fake timer
    setTimeout(() => {
      expect(connection.sendChange.callCount).toEqual(1);

      done();
    }, 50);
  });

  describe('autocompletion', () => {
    let connection : MockConnection;

    beforeEach(() => {
      connection = new MockConnection();

      new CodeMirrorAdapter(connection, {
        quickSuggestionsDelay: 10
      }, editor);
    });

    it('requests autocompletion suggestions', (done) => {
      editor.getDoc().replaceSelection('a');

      // TODO: Use sinon fake timer
      setTimeout(() => {
        expect(connection.getCompletion.callCount).toEqual(1);
        done();
      }, 50);
    });
  });
});
