/// <reference types="@types/codemirror" />
/// <reference types="@types/codemirror/codemirror-showhint" />

import debounce from 'lodash-es/debounce';
import * as lsProtocol from 'vscode-languageserver-protocol';
import { MarkupContent } from 'vscode-languageserver-protocol';
import { TokenInfo, ITextEditorOptions, IPosition, LSPConnection, IEditorAdapter, getFilledDefaults } from './types';

class CodeMirrorAdapter extends IEditorAdapter<CodeMirror.Editor> {
  options: ITextEditorOptions;
  editor: CodeMirror.Editor;
  connection: LSPConnection;

  private hoverMarker: CodeMirror.TextMarker;
  private signatureWidget: CodeMirror.LineWidget;
  private token: TokenInfo;
  private markedDiagnostics : CodeMirror.TextMarker[] = [];
  private highlightMarkers: CodeMirror.TextMarker[] = [];
  private hoverCharacter : IPosition;
  private _debouncedGetHover: (position: IPosition) => void;

  constructor(connection: LSPConnection, options: ITextEditorOptions, editor: CodeMirror.Editor) {
    super(connection, options, editor);
    this.connection = connection;
    this.options = getFilledDefaults(options);
    this.editor = editor;

    this.editor.on('change', debounce(this.handleChange.bind(this), options.debounceSuggestionsWhileTyping));
    this.connection.on('hover', this.handleHover.bind(this));
    this.connection.on('highlight', this.handleHighlight.bind(this));
    this.connection.on('completion', this.handleCompletion.bind(this));
    this.connection.on('signature', this.handleSignature.bind(this));
    this.connection.on('diagnostic', this.handleDiagnostic.bind(this));

    this._debouncedGetHover = debounce((position: IPosition) => {
      this.connection.getHoverTooltip(position);
    }, this.options.quickSuggestionsDelay);

    this.handleMouseOver();

    this.editor.on('cursorActivity', debounce(() => {
      this.connection.getDocumentHighlights(this.editor.getDoc().getCursor('start'));
    }, this.options.quickSuggestionsDelay));
  }

  _removeSignatureWidget() {
    if (this.signatureWidget) {
      this.signatureWidget.clear();
      this.signatureWidget = null;
    }
  }

  handleMouseOver() {
    this.editor.getWrapperElement().addEventListener('mouseover', (ev : MouseEvent) => {
      let docPosition : IPosition = this.editor.coordsChar({
        left: ev.screenX,
        top: ev.screenY,
      }, 'window');

      if (
        !this.hoverCharacter ||
        (docPosition.line !== this.hoverCharacter.line && docPosition.ch !== this.hoverCharacter.ch)
      ) {
        this.hoverCharacter = docPosition;
        this._debouncedGetHover(docPosition);
      }
    });
  }
  
  handleChange(cm: CodeMirror.Editor, change: CodeMirror.EditorChange) {
    let location = this.editor.getDoc().getCursor('end')
    this.connection.sendChange();

    let completionCharacters = this.connection.getLanguageCompletionCharacters();
    let signatureCharacters = this.connection.getLanguageSignatureCharacters();

    let code = this.editor.getDoc().getValue();
    let lines = code.split('\n');
    let line = lines[location.line];
    let typedCharacter = line[location.ch - 1];

    if (typeof typedCharacter === 'undefined') {
      // Line was cleared
      this._removeSignatureWidget();
    } else if (completionCharacters.indexOf(typedCharacter) > -1) {
      this.token = this._getTokenEndingAtPosition(code, location, completionCharacters);
      this.connection.getCompletion(
        location,
        this.token,
        completionCharacters.find((c) => c === typedCharacter),
        lsProtocol.CompletionTriggerKind.TriggerCharacter
      );
    } else if (signatureCharacters.indexOf(typedCharacter) > -1) {
      this.token = this._getTokenEndingAtPosition(code, location, signatureCharacters);
      this.connection.getSignatureHelp(location);
    } else if (!/\W/.test(typedCharacter)) {
      this.connection.getCompletion(
        location,
        this.token,
        '',
        lsProtocol.CompletionTriggerKind.Invoked,
      );
      this.token = this._getTokenEndingAtPosition(code, location, completionCharacters.concat(signatureCharacters));
    } else {
      this._removeSignatureWidget();
    }
  }

  handleHover(response: lsProtocol.Hover) {
    if (!response.contents || (Array.isArray(response.contents) && response.contents.length === 0)) {
      return;
    } 

    if (this.hoverMarker) {
      this.hoverMarker.clear();
      this.hoverMarker = null;
    }
    const start = <CodeMirror.Position> {
      line: response.range.start.line,
      ch: response.range.start.character
    };
    const end = <CodeMirror.Position> {
      line: response.range.end.line,
      ch: response.range.end.character
    };

    let tooltipText;
    if (MarkupContent.is(response.contents)) {
      tooltipText = response.contents.value;
    } else if (Array.isArray(response.contents)) {
      let firstItem = response.contents[0];
      if (MarkupContent.is(firstItem)) {
        tooltipText = firstItem.value;
      } else if (typeof firstItem === 'object') {
        tooltipText = firstItem.value;
      } else {
        tooltipText = firstItem;
      }
    } else if (typeof response.contents === 'string') {
      tooltipText = response.contents;
    }

    this.hoverMarker = this.editor.getDoc().markText(start, end, {
      title: tooltipText,
      css: 'text-decoration: underline',
    });
  }

  handleHighlight(items: lsProtocol.DocumentHighlight[]) {
    if (this.highlightMarkers) {
      this.highlightMarkers.forEach((marker) => {
        marker.clear();
      });
    }
    this.highlightMarkers = [];
    if (!items.length) {
      return;
    }

    items.forEach((highlight) => {
      const start = <CodeMirror.Position> {
        line: highlight.range.start.line,
        ch: highlight.range.start.character
      };
      const end = <CodeMirror.Position> {
        line: highlight.range.end.line,
        ch: highlight.range.end.character
      };

      this.highlightMarkers.push(this.editor.getDoc().markText(start, end, {
        css: 'background-color: #dde',
      }));
    });
  }

  handleCompletion(completions: lsProtocol.CompletionItem[]) : void {
    if (!this.token) {
      return;
    }

    let bestCompletions = this._getFilteredCompletions(this.token.text, completions);

    let start = this.token.start;
    if (/^\W$/.test(this.token.text)) {
      // Special case for completion on the completion trigger itself, the completion goes after
      start = this.token.end;
    }

    this.editor.showHint(<CodeMirror.ShowHintOptions> {
      completeSingle: false,
      hint: () => {
        return {
          from: start,
          to: this.token.end,
          list: bestCompletions.map((completion) => completion.label),
        };
      },
    });
  }

  handleDiagnostic(response: lsProtocol.PublishDiagnosticsParams) {
    this.editor.clearGutter('CodeMirror-lsp');
    this.markedDiagnostics.forEach((marker) => {
      marker.clear();
    });
    this.markedDiagnostics = [];
    response.diagnostics.forEach((diagnostic : lsProtocol.Diagnostic) => {
      const start = <CodeMirror.Position> {
        line: diagnostic.range.start.line,
        ch: diagnostic.range.start.character
      };
      const end = <CodeMirror.Position> {
        line: diagnostic.range.end.line,
        ch: diagnostic.range.end.character
      };
      
      this.markedDiagnostics.push(this.editor.getDoc().markText(start, end, {
        title: diagnostic.message,
        className: 'cm-error',
      }));

      let childEl = document.createElement('div');
      childEl.classList.add('CodeMirror-lsp-guttermarker');
      childEl.title = diagnostic.message;
      this.editor.setGutterMarker(start.line, 'CodeMirror-lsp', childEl);
    });
  }

  handleSignature(result: lsProtocol.SignatureHelp) {
    this._removeSignatureWidget();
    if (!result.signatures.length || !this.token) {
      return;
    }

    let htmlElement = document.createElement('div');
    htmlElement.classList.add('CodeMirror-lsp-signature');
    result.signatures.forEach((item : lsProtocol.SignatureInformation) => {
      let el = document.createElement('div');
      el.innerText = item.label;
      htmlElement.appendChild(el);
    });
    this.signatureWidget = this.editor.addLineWidget(this.token.start.line, htmlElement, {
      above: true
    });
  }

  _getTokenEndingAtPosition(code: string, location: IPosition, splitCharacters: string[]) : TokenInfo {
    let lines = code.split('\n');
    let line = lines[location.line];
    let typedCharacter = line[location.ch - 1];

    if (splitCharacters.indexOf(typedCharacter) > -1) {
      return {
        text: typedCharacter,
        start: {
          line: location.line,
          ch: location.ch - 1
        },
        end: location
      };
    }

    let wordStartChar = 0;
    for (let i = location.ch - 1; i >= 0; i--) {
      let char = line[i];
      if (/\W/u.test(char)) {
        break;
      }
      wordStartChar = i;
    }
    return {
      text: line.substr(wordStartChar, location.ch),
      start: {
        line: location.line,
        ch: wordStartChar,
      },
      end: location
    }
  }

  private _getFilteredCompletions(triggerWord : string, items: lsProtocol.CompletionItem[]) : lsProtocol.CompletionItem[] {
    if (/\W+/.test(triggerWord)) {
      return items;
    }
    let word = triggerWord.toLowerCase();
    return items.filter((item : lsProtocol.CompletionItem) => {
      if (item.filterText && item.filterText.toLowerCase().indexOf(word) === 0) {
        return true;
      } else {
        return item.label.toLowerCase().indexOf(word) === 0;
      }
    }).sort((a: lsProtocol.CompletionItem, b: lsProtocol.CompletionItem) => {
      let inA = (a.label.indexOf(triggerWord) === 0) ? -1 : 1;
      let inB = b.label.indexOf(triggerWord) === 0 ? 1 : -1;
      return inA + inB;
    });
  }
}

export default CodeMirrorAdapter;
