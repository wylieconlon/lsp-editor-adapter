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

      const target = editor.getWrapperElement().querySelector('.CodeMirror-line');
      target.dispatchEvent(new MouseEvent('mousemove', {
        clientX: screenPos.left,
        clientY: screenPos.top,
        bubbles: true,
      }));

      clock.tick(10);

      expect(connection.getHoverTooltip.callCount).toEqual(1);
      expect(connection.getHoverTooltip.firstCall.calledWithMatch({
        line: 0,
        ch: 3,
      })).toEqual(true);
    });

    it('should request another hover within the same line', () => {
      const pos = {
        line: 0,
        ch: 3,
      };
      const screenPos = editor.charCoords(pos, 'window');

      const target = editor.getWrapperElement().querySelector('.CodeMirror-line');
      target.dispatchEvent(new MouseEvent('mousemove', {
        clientX: screenPos.left,
        clientY: screenPos.top,
        bubbles: true,
      }));

      clock.tick(10);

      target.dispatchEvent(new MouseEvent('mousemove', {
        clientX: screenPos.left + 20,
        clientY: screenPos.top,
        bubbles: true,
      }));

      clock.tick(10);

      expect(connection.getHoverTooltip.callCount).toEqual(2);
      expect(connection.getHoverTooltip.secondCall.calledWithMatch({
        line: 0,
        ch: 6,
      })).toEqual(true);
    });

    it('should not request hover when hover is outside visible code area', () => {
      // This should be way outside the valid area
      editor.getWrapperElement().dispatchEvent(new MouseEvent('mousemove', {
        clientX: 500,
        clientY: 500,
        bubbles: true,
      }));

      clock.tick(10);

      expect(connection.getHoverTooltip.callCount).toEqual(0);
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

    it('should handle hover responses without ranges', () => {
      const pos = {
        line: 0,
        ch: 3,
      };
      const screenPos = editor.charCoords(pos, 'window');

      const target = editor.getWrapperElement().querySelector('.CodeMirror-line');
      target.dispatchEvent(new MouseEvent('mousemove', {
        clientX: screenPos.left,
        clientY: screenPos.top,
        bubbles: true,
      }));

      clock.tick(10);

      connection.dispatchEvent(new MessageEvent('hover', {
        data: {
          contents: ['hello'],
        },
      }));

      expect(editor.getDoc().getAllMarks().length).toEqual(0);

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

    it('should highlight but not show a tooltip for null array contents', () => {
      const pos = { line: 0, ch: 3 };
      const screenPos = editor.charCoords(pos, 'window');

      const target = editor.getWrapperElement().querySelector('.CodeMirror-line');
      target.dispatchEvent(new MouseEvent('mousemove', {
        clientX: screenPos.left,
        clientY: screenPos.top,
        bubbles: true,
      }));

      clock.tick(10);

      connection.dispatchEvent(new MessageEvent('hover', {
        data: {
          contents: [null],
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

      expect(document.querySelectorAll('.CodeMirror-lsp-tooltip').length).toEqual(0);
    });
  });

  describe('token highlights', () => {
    const highlightMessageData = {
      data: [
        {
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
        {
          range: {
            start: {
              line: 0,
              character: 12,
            },
            end: {
              line: 0,
              character: 17,
            },
          },
        },
      ],
    };

    let connection: MockConnection;

    beforeEach(() => {
      connection = new MockConnection();

      adapter = new CodeMirrorAdapter(connection, {}, editor);

      editor.getDoc().replaceSelection('hello world hello there');
    });

    it('should highlight matching tokens', () => {
      connection.dispatchEvent(new MessageEvent('highlight', highlightMessageData));

      expect(editor.getDoc().getAllMarks().length).toEqual(2);
    });

    it('should accept null highlight and remove highlights', () => {
      connection.dispatchEvent(new MessageEvent('highlight', highlightMessageData));
      expect(editor.getDoc().getAllMarks().length).toEqual(2);

      connection.dispatchEvent(new MessageEvent('highlight', {data: null}));
      expect(editor.getDoc().getAllMarks().length).toEqual(0);
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

    it('does not request autocompletion if there are no triggers', () => {
      connection.completionCharacters = [];
      clock.tick(defaults.debounceSuggestionsWhileTyping);
      expect(connection.getCompletion.callCount).toEqual(0);
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

    it('does not request signature suggestions if there are no characters', () => {
      connection.signatureCharacters = [];
      clock.tick(defaults.debounceSuggestionsWhileTyping);
      expect(connection.getSignatureHelp.callCount).toEqual(0);
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

  describe('right click menu', () => {
    let connection: MockConnection;

    beforeEach(() => {
      connection = new MockConnection();

      connection.isDefinitionSupported.returns(true);
      connection.isTypeDefinitionSupported.returns(false);
      connection.isReferencesSupported.returns(true);

      // tslint:disable no-unused-expression
      adapter = new CodeMirrorAdapter(connection, {
        quickSuggestionsDelay: 10,
      }, editor);

      editor.getDoc().replaceSelection('hello world');

      // Open the menu for each of these tests
      const pos = {
        line: 0,
        ch: 3,
      };
      const screenPos = editor.charCoords(pos, 'window');

      const target = editor.getWrapperElement().querySelector('.CodeMirror-line');
      target.dispatchEvent(new MouseEvent('contextmenu', {
        clientX: screenPos.left,
        clientY: screenPos.top,
        bubbles: true,
      }));

      clock.tick(defaults.debounceSuggestionsWhileTyping);
    });

    it('should display a context menu on right click', () => {
      expect(document.querySelectorAll('.CodeMirror-lsp-tooltip').length).toEqual(1);
    });

    it('should close the context menu on click outside', () => {
      editor.getWrapperElement().dispatchEvent(new MouseEvent('click', {
        bubbles: true,
      }));

      expect(document.querySelectorAll('.CodeMirror-lsp-tooltip').length).toEqual(0);
    });

    it('should send a request to get definitions for the current line', () => {
      const goToDefinition = document.querySelector('.CodeMirror-lsp-context > div');

      goToDefinition.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
      }));

      expect(goToDefinition.textContent).toEqual('Go to Definition');
      expect(connection.getDefinition.callCount).toEqual(1);
      expect(connection.getDefinition.firstCall.calledWithMatch({
        line: 0,
        ch: 3,
      })).toEqual(true);
    });

    it('should only display context menu items that the server supports', () => {
      const options = document.querySelectorAll('.CodeMirror-lsp-context > div');

      expect(options.length).toEqual(2);
    });

    it('should close the context menu and display highlights on a go to X response', () => {
      const uri = 'file:///path/to/file.css';

      connection.getDocumentUri.returns(uri);

      connection.dispatchEvent(new MessageEvent('goTo', {
        data: [{
          uri,
          range: {
            start: {
              line: 0,
              character: 0,
            },
            end: {
              line: 0,
              character: 2,
            },
          },
        }, {
          uri: 'different file',
          range: {
            start: {
              line: 5,
              character: 0,
            },
            end: {
              line: 6,
              character: 5,
            },
          },
        }],
      }));

      expect(editor.getDoc().getAllMarks().length).toEqual(1);

      expect(document.querySelectorAll('.CodeMirror-lsp-tooltip').length).toEqual(0);
    });
  });
});
