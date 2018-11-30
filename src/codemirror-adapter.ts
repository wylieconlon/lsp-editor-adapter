/// <reference types="@types/codemirror" />
/// <reference types="@types/codemirror/codemirror-showhint" />

import debounce from 'lodash-es/debounce';
import * as lsProtocol from 'vscode-languageserver-protocol';
import { MarkupContent } from 'vscode-languageserver-protocol';
import { getFilledDefaults, IEditorAdapter, ILspConnection, IPosition, ITextEditorOptions, ITokenInfo } from './types';

class CodeMirrorAdapter extends IEditorAdapter<CodeMirror.Editor> {
  public options: ITextEditorOptions;
  public editor: CodeMirror.Editor;
  public connection: ILspConnection;

  private hoverMarker: CodeMirror.TextMarker;
  private signatureWidget: CodeMirror.LineWidget;
  private token: ITokenInfo;
  private markedDiagnostics: CodeMirror.TextMarker[] = [];
  private highlightMarkers: CodeMirror.TextMarker[] = [];
  private hoverCharacter: IPosition;
  private debouncedGetHover: (position: IPosition) => void;

  constructor(connection: ILspConnection, options: ITextEditorOptions, editor: CodeMirror.Editor) {
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

    this.debouncedGetHover = debounce((position: IPosition) => {
      this.connection.getHoverTooltip(position);
    }, this.options.quickSuggestionsDelay);

    this.handleMouseOver();

    this.editor.on('cursorActivity', debounce(() => {
      this.connection.getDocumentHighlights(this.editor.getDoc().getCursor('start'));
    }, this.options.quickSuggestionsDelay));
  }

  public handleMouseOver() {
    this.editor.getWrapperElement().addEventListener('mouseover', (ev: MouseEvent) => {
      const docPosition: IPosition = this.editor.coordsChar({
        left: ev.screenX,
        top: ev.screenY,
      }, 'window');

      if (
        !this.hoverCharacter ||
        (docPosition.line !== this.hoverCharacter.line && docPosition.ch !== this.hoverCharacter.ch)
      ) {
        this.hoverCharacter = docPosition;
        this.debouncedGetHover(docPosition);
      }
    });
  }

  public handleChange(cm: CodeMirror.Editor, change: CodeMirror.EditorChange) {
    const location = this.editor.getDoc().getCursor('end');
    this.connection.sendChange();

    const completionCharacters = this.connection.getLanguageCompletionCharacters();
    const signatureCharacters = this.connection.getLanguageSignatureCharacters();

    const code = this.editor.getDoc().getValue();
    const lines = code.split('\n');
    const line = lines[location.line];
    const typedCharacter = line[location.ch - 1];

    if (typeof typedCharacter === 'undefined') {
      // Line was cleared
      this._removeSignatureWidget();
    } else if (completionCharacters.indexOf(typedCharacter) > -1) {
      this.token = this._getTokenEndingAtPosition(code, location, completionCharacters);
      this.connection.getCompletion(
        location,
        this.token,
        completionCharacters.find((c) => c === typedCharacter),
        lsProtocol.CompletionTriggerKind.TriggerCharacter,
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

  public handleHover(response: lsProtocol.Hover) {
    if (!response.contents || (Array.isArray(response.contents) && response.contents.length === 0)) {
      return;
    }

    if (this.hoverMarker) {
      this.hoverMarker.clear();
      this.hoverMarker = null;
    }
    const start = {
      line: response.range.start.line,
      ch: response.range.start.character,
    } as CodeMirror.Position;
    const end = {
      line: response.range.end.line,
      ch: response.range.end.character,
    } as CodeMirror.Position;

    let tooltipText;
    if (MarkupContent.is(response.contents)) {
      tooltipText = response.contents.value;
    } else if (Array.isArray(response.contents)) {
      const firstItem = response.contents[0];
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

  public handleHighlight(items: lsProtocol.DocumentHighlight[]) {
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
      const start = {
        line: highlight.range.start.line,
        ch: highlight.range.start.character,
      } as CodeMirror.Position;
      const end = {
        line: highlight.range.end.line,
        ch: highlight.range.end.character,
      } as CodeMirror.Position;

      this.highlightMarkers.push(this.editor.getDoc().markText(start, end, {
        css: 'background-color: #dde',
      }));
    });
  }

  public handleCompletion(completions: lsProtocol.CompletionItem[]): void {
    if (!this.token) {
      return;
    }

    const bestCompletions = this._getFilteredCompletions(this.token.text, completions);

    let start = this.token.start;
    if (/^\W$/.test(this.token.text)) {
      // Special case for completion on the completion trigger itself, the completion goes after
      start = this.token.end;
    }

    this.editor.showHint({
      completeSingle: false,
      hint: () => {
        return {
          from: start,
          to: this.token.end,
          list: bestCompletions.map((completion) => completion.label),
        };
      },
    } as CodeMirror.ShowHintOptions);
  }

  public handleDiagnostic(response: lsProtocol.PublishDiagnosticsParams) {
    this.editor.clearGutter('CodeMirror-lsp');
    this.markedDiagnostics.forEach((marker) => {
      marker.clear();
    });
    this.markedDiagnostics = [];
    response.diagnostics.forEach((diagnostic: lsProtocol.Diagnostic) => {
      const start = {
        line: diagnostic.range.start.line,
        ch: diagnostic.range.start.character,
      } as CodeMirror.Position;
      const end = {
        line: diagnostic.range.end.line,
        ch: diagnostic.range.end.character,
      } as CodeMirror.Position;

      this.markedDiagnostics.push(this.editor.getDoc().markText(start, end, {
        title: diagnostic.message,
        className: 'cm-error',
      }));

      const childEl = document.createElement('div');
      childEl.classList.add('CodeMirror-lsp-guttermarker');
      childEl.title = diagnostic.message;
      this.editor.setGutterMarker(start.line, 'CodeMirror-lsp', childEl);
    });
  }

  public handleSignature(result: lsProtocol.SignatureHelp) {
    this._removeSignatureWidget();
    if (!result.signatures.length || !this.token) {
      return;
    }

    const htmlElement = document.createElement('div');
    htmlElement.classList.add('CodeMirror-lsp-signature');
    result.signatures.forEach((item: lsProtocol.SignatureInformation) => {
      const el = document.createElement('div');
      el.innerText = item.label;
      htmlElement.appendChild(el);
    });
    this.signatureWidget = this.editor.addLineWidget(this.token.start.line, htmlElement, {
      above: true,
    });
  }

  public _getTokenEndingAtPosition(code: string, location: IPosition, splitCharacters: string[]): ITokenInfo {
    const lines = code.split('\n');
    const line = lines[location.line];
    const typedCharacter = line[location.ch - 1];

    if (splitCharacters.indexOf(typedCharacter) > -1) {
      return {
        text: typedCharacter,
        start: {
          line: location.line,
          ch: location.ch - 1,
        },
        end: location,
      };
    }

    let wordStartChar = 0;
    for (let i = location.ch - 1; i >= 0; i--) {
      const char = line[i];
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
      end: location,
    };
  }

  private _getFilteredCompletions(
    triggerWord: string,
    items: lsProtocol.CompletionItem[],
  ): lsProtocol.CompletionItem[] {
    if (/\W+/.test(triggerWord)) {
      return items;
    }
    const word = triggerWord.toLowerCase();
    return items.filter((item: lsProtocol.CompletionItem) => {
      if (item.filterText && item.filterText.toLowerCase().indexOf(word) === 0) {
        return true;
      } else {
        return item.label.toLowerCase().indexOf(word) === 0;
      }
    }).sort((a: lsProtocol.CompletionItem, b: lsProtocol.CompletionItem) => {
      const inA = (a.label.indexOf(triggerWord) === 0) ? -1 : 1;
      const inB = b.label.indexOf(triggerWord) === 0 ? 1 : -1;
      return inA + inB;
    });
  }

  private _removeSignatureWidget() {
    if (this.signatureWidget) {
      this.signatureWidget.clear();
      this.signatureWidget = null;
    }
  }

}

export default CodeMirrorAdapter;
