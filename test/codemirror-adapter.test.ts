import * as CodeMirror from 'codemirror';
import 'codemirror/addon/hint/show-hint';
import 'codemirror/lib/codemirror.css';
import * as expect from 'expect';
import * as sinon from 'sinon';
import CodeMirrorAdapter from '../src/codemirror-adapter';
import { getFilledDefaults } from '../src/types';
import { MockConnection } from './mock-connection';

const defaults = getFilledDefaults({});

describe('CodeMirror adapter', () => {
  let editorEl: HTMLDivElement;
  let editor: CodeMirror.Editor;
  let clock: sinon.SinonFakeTimers;
  let adapter: CodeMirrorAdapter;

  beforeEach(() => {
    clock = sinon.useFakeTimers();

    editorEl = document.createElement('div');
    document.body.appendChild(editorEl);
    editor = CodeMirror(editorEl);
  });

  afterEach(() => {
    adapter.remove();
    document.body.removeChild(editorEl);
    editorEl.remove();
    clock.restore();
  });

  it('sends a textDocument/didChange event for every character', () => {
    const connection = new MockConnection();
    adapter = new CodeMirrorAdapter(connection, {
      debounceSuggestionsWhileTyping: 10,
    }, editor);

    editor.setValue('a');

    clock.tick(defaults.debounceSuggestionsWhileTyping);

    expect(connection.sendChange.callCount).toEqual(1);
  });

  describe('hover requests', () => {
    let connection: MockConnection;

    beforeEach(() => {
      connection = new MockConnection();

      // tslint:disable no-unused-expression
      adapter = new CodeMirrorAdapter(connection, {
        quickSuggestionsDelay: 10,
      }, editor);

      editor.getDoc().replaceSelection('hello world');
    });

    it('should request hover info when the mouse moves', () => {
      const pos = {
        line: 0,
        ch: 3,
      };
      const screenPos = editor.charCoords(pos, 'window');

      editor.getWrapperElement().dispatchEvent(new MouseEvent('mouseover', {
        clientX: screenPos.left,
        clientY: screenPos.top,
      }));

      clock.tick(10);

      expect(connection.getHoverTooltip.callCount).toEqual(1);
      expect(connection.getHoverTooltip.firstCall.calledWithMatch({
        line: 0,
        ch: 3,
      })).toEqual(true);
    });

    it('should display a marker on hover response', () => {
      connection.dispatchEvent(new MessageEvent('hover', {
        data: {
          contents: ['hello'],
          range: {
            start: {
              line: 0,
              character: 0,
            },
            end: {
              line: 0,
              character: 5,
            },
          },
        },
      }));

      expect(editor.getDoc().getAllMarks().length).toEqual(1);

      expect(document.querySelectorAll('.CodeMirror-lsp-tooltip').length).toEqual(1);
    });

    it('should clear the hover if the server returns no results', () => {
      connection.dispatchEvent(new MessageEvent('hover', {
        data: {
          contents: ['hello'],
          range: {
            start: {
              line: 0,
              character: 0,
            },
            end: {
              line: 0,
              character: 5,
            },
          },
        },
      }));

      expect(editor.getDoc().getAllMarks().length).toEqual(1);
      expect(document.querySelectorAll('.CodeMirror-lsp-tooltip').length).toEqual(1);

      connection.dispatchEvent(new MessageEvent('hover', {
        data: {
          contents: [],
          range: {},
        },
      }));

      expect(editor.getDoc().getAllMarks().length).toEqual(0);
      expect(document.querySelectorAll('.CodeMirror-lsp-tooltip').length).toEqual(0);
    });
  });

  describe('autocompletion', () => {
    let connection: MockConnection;

    beforeEach(() => {
      connection = new MockConnection();

      adapter = new CodeMirrorAdapter(connection, {
        quickSuggestionsDelay: 10,
      }, editor);
    });

    it('requests autocompletion suggestions for single characters', () => {
      editor.getDoc().replaceSelection('a');

      clock.tick(defaults.debounceSuggestionsWhileTyping);

      expect(connection.getCompletion.callCount).toEqual(1);
    });

    it('requests autocompletion suggestions when ending on the character', () => {
      editor.getDoc().replaceSelection('a.');

      clock.tick(defaults.debounceSuggestionsWhileTyping);

      expect(connection.getCompletion.callCount).toEqual(1);
    });

    it('displays completion results', () => {
      editor.getDoc().replaceSelection('a.');
      clock.tick(defaults.debounceSuggestionsWhileTyping);

      connection.dispatchEvent(new MessageEvent('completion', {
        data: [{
          label: 'length',
        }, {
          label: 'map',
        }],
      }));

      expect(document.querySelectorAll('.CodeMirror-hint').length).toEqual(2);
      expect(document.querySelectorAll('.CodeMirror-hint')[0].textContent).toEqual('length');
    });

    it('filters completion results after new typing', () => {
      editor.getDoc().replaceSelection('a.');
      clock.tick(defaults.debounceSuggestionsWhileTyping);

      connection.dispatchEvent(new MessageEvent('completion', {
        data: [{
          label: 'bobulate',
        }, {
          label: 'map',
        }],
      }));

      editor.getDoc().replaceSelection('a.bob');
      clock.tick(defaults.debounceSuggestionsWhileTyping);

      connection.dispatchEvent(new MessageEvent('completion', {
        data: [{
          label: 'bobulate',
        }, {
          label: 'map',
        }],
      }));
      expect(document.querySelectorAll('.CodeMirror-hint').length).toEqual(1);
      expect(document.querySelector('.CodeMirror-hint').textContent).toEqual('bobulate');
    });

    it('accepts completions on enter', () => {
      editor.getDoc().replaceSelection('a.');
      clock.tick(defaults.debounceSuggestionsWhileTyping);

      connection.dispatchEvent(new MessageEvent('completion', {
        data: [{
          label: 'length',
        }, {
          label: 'map',
        }],
      }));

      expect(document.querySelectorAll('.CodeMirror-hint').length).toEqual(2);
      expect(document.querySelectorAll('.CodeMirror-hint')[0].textContent).toEqual('length');

      const el = editorEl.querySelector('textarea');
      el.focus();
      el.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        // @ts-ignore: Deprecated property used by CodeMirror
        keyCode: 13,
      }));

      expect(document.querySelectorAll('.CodeMirror-hint').length).toEqual(0);
      expect(editor.getValue()).toEqual('a.length');
    });

  });

  describe('signature help', () => {
    let connection: MockConnection;

    beforeEach(() => {
      connection = new MockConnection();

      adapter = new CodeMirrorAdapter(connection, {
        quickSuggestionsDelay: 10,
      }, editor);

      editor.getDoc().replaceSelection('console.log(');
    });

    afterEach(() => {
      sinon.restore();
   });

    it('requests signature suggestions', () => {
      clock.tick(defaults.debounceSuggestionsWhileTyping);
      expect(connection.getSignatureHelp.callCount).toEqual(1);
    });

    it('displays signature suggestions', () => {
      clock.tick(defaults.debounceSuggestionsWhileTyping);
      connection.dispatchEvent(new MessageEvent('signature', {
        data: {
          signatures: [{
            label: 'log(message: any)',
            parameters: [{
              label: 'message: any',
            }],
          }],
        },
      }));

      clock.tick(defaults.debounceSuggestionsWhileTyping);
      expect(document.querySelectorAll('.CodeMirror-lsp-tooltip').length).toEqual(1);
    });

    it('clears signature suggestions after typing more', () => {
      clock.tick(defaults.debounceSuggestionsWhileTyping);
      connection.dispatchEvent(new MessageEvent('signature', {
        data: {
          signatures: [{
            label: 'log(message: any)',
            parameters: [{
              label: 'message: any',
            }],
          }],
        },
      }));

      editor.getDoc().setValue('console.log("hello");');
      clock.tick(defaults.debounceSuggestionsWhileTyping);
      expect(document.querySelectorAll('.CodeMirror-lsp-tooltip').length).toEqual(0);
    });
  });

  describe('syntax errors', () => {
    let connection: MockConnection;

    beforeEach(() => {
      connection = new MockConnection();

      adapter = new CodeMirrorAdapter(connection, {}, editor);

      editor.getDoc().replaceSelection('.myClass {}');
    });

    afterEach(() => {
      sinon.restore();
   });

    it('displays diagnostics', () => {
      connection.dispatchEvent(new MessageEvent('diagnostic', {
        data: {
          uri: 'file:///path/to/file.css',
          diagnostics: [{
            code: 'emptyRules',
            source: 'css.lint.emptyRules',
            message: 'Do not use empty rulesets',
            severity: 2,
            range: {
              start: {
                line: 0,
                character: 0,
              },
              end: {
                line: 0,
                character: 7,
              },
            },
          }],
        },
      }));

      expect(editor.getDoc().getAllMarks().length).toEqual(1);
    });
  });
});
