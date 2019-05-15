/// <reference types="@types/codemirror" />
/// <reference types="@types/codemirror/codemirror-showhint" />

import debounce from 'lodash-es/debounce';
import * as lsProtocol from 'vscode-languageserver-protocol';
import { Location, LocationLink, MarkupContent } from 'vscode-languageserver-protocol';
import { getFilledDefaults, IEditorAdapter, ILspConnection, IPosition, ITextEditorOptions, ITokenInfo } from './types';

interface IScreenCoord {
  x: number;
  y: number;
}

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
  private connectionListeners: { [key: string]: () => void } = {};
  private editorListeners: { [key: string]: () => void } = {};
  private documentListeners: { [key: string]: () => void } = {};
  private tooltip: HTMLElement;
  private isShowingContextMenu: boolean = false;

  constructor(connection: ILspConnection, options: ITextEditorOptions, editor: CodeMirror.Editor) {
    super(connection, options, editor);
    this.connection = connection;
    this.options = getFilledDefaults(options);
    this.editor = editor;

    this.debouncedGetHover = debounce((position: IPosition) => {
      this.connection.getHoverTooltip(position);
    }, this.options.quickSuggestionsDelay);

    this._addListeners();
  }

  public handleMouseOver(ev: MouseEvent) {
    if (this.isShowingContextMenu || !this._isEventInsideVisible(ev) || !this._isEventOnCharacter(ev)) {
      return;
    }

    const docPosition: IPosition = this.editor.coordsChar({
      left: ev.clientX,
      top: ev.clientY,
    }, 'window');

    if (
      !(this.hoverCharacter &&
      docPosition.line === this.hoverCharacter.line && docPosition.ch === this.hoverCharacter.ch)
    ) {
      // Avoid sending duplicate requests in a row
      this.hoverCharacter = docPosition;
      this.debouncedGetHover(docPosition);
    }
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
    this._removeHover();
    this._removeTooltip();

    if (!response || !response.contents || (Array.isArray(response.contents) && response.contents.length === 0)) {
      return;
    }

    let start = this.hoverCharacter;
    let end = this.hoverCharacter;
    if (response.range) {
      start = {
        line: response.range.start.line,
        ch: response.range.start.character,
      } as CodeMirror.Position;
      end = {
        line: response.range.end.line,
        ch: response.range.end.character,
      } as CodeMirror.Position;

      this.hoverMarker = this.editor.getDoc().markText(start, end, {
        css: 'text-decoration: underline',
      });
    }

    let tooltipText;
    if (MarkupContent.is(response.contents)) {
      tooltipText = response.contents.value;
    } else if (Array.isArray(response.contents)) {
      const firstItem = response.contents[0];
      if (MarkupContent.is(firstItem)) {
        tooltipText = firstItem.value;
      } else if (firstItem === null) {
        return;
      } else if (typeof firstItem === 'object') {
        tooltipText = firstItem.value;
      } else {
        tooltipText = firstItem;
      }
    } else if (typeof response.contents === 'string') {
      tooltipText = response.contents;
    }

    const htmlElement = document.createElement('div');
    htmlElement.innerText = tooltipText;
    const coords = this.editor.charCoords(start, 'page');
    this._showTooltip(htmlElement, {
      x: coords.left,
      y: coords.top,
    });
  }

  public handleHighlight(items: lsProtocol.DocumentHighlight[]) {
    this._highlightRanges((items || []).map((i) => i.range));
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
    this._removeTooltip();
    if (!result || !result.signatures.length || !this.token) {
      return;
    }

    const htmlElement = document.createElement('div');
    result.signatures.forEach((item: lsProtocol.SignatureInformation) => {
      const el = document.createElement('div');
      el.innerText = item.label;
      htmlElement.appendChild(el);
    });
    const coords = this.editor.charCoords(this.token.start, 'page');
    this._showTooltip(htmlElement, {
      x: coords.left,
      y: coords.top,
    });
  }

  public handleGoTo(location: Location | Location[] | LocationLink[] | null) {
    this._removeTooltip();

    if (!location) {
      return;
    }

    const documentUri = this.connection.getDocumentUri();
    let scrollTo: IPosition;

    if (lsProtocol.Location.is(location)) {
      if (location.uri !== documentUri) {
        return;
      }
      this._highlightRanges([location.range]);
      scrollTo = {
        line: location.range.start.line,
        ch: location.range.start.character,
      };
    } else if ((location as any[]).every((l) => lsProtocol.Location.is(l))) {
      const locations = (location as Location[]).filter((l) => l.uri === documentUri);

      this._highlightRanges(locations.map((l) => l.range));
      scrollTo = {
        line: locations[0].range.start.line,
        ch: locations[0].range.start.character,
      };
    } else if ((location as any[]).every((l) => lsProtocol.LocationLink.is(l))) {
      const locations = (location as LocationLink[]).filter((l) => l.targetUri === documentUri);
      this._highlightRanges(locations.map((l) => l.targetRange));
      scrollTo = {
        line: locations[0].targetRange.start.line,
        ch: locations[0].targetRange.start.character,
      };
    }
    this.editor.scrollIntoView(scrollTo);
  }

  public remove() {
    this._removeSignatureWidget();
    this._removeHover();
    this._removeTooltip();
    // Show-hint addon doesn't remove itself. This could remove other uses in the project
    document.querySelectorAll('.CodeMirror-hints').forEach((e) => e.remove());
    this.editor.off('change', this.editorListeners.change);
    this.editor.off('cursorActivity', this.editorListeners.cursorActivity);
    this.editor.off('cursorActivity', this.editorListeners.cursorActivity);
    this.editor.getWrapperElement().removeEventListener('mousemove', this.editorListeners.mouseover);
    this.editor.getWrapperElement().removeEventListener('contextmenu', this.editorListeners.contextmenu);
    Object.keys(this.connectionListeners).forEach((key) => {
      this.connection.off(key as any, this.connectionListeners[key]);
    });
    Object.keys(this.documentListeners).forEach((key) => {
      document.removeEventListener(key as any, this.documentListeners[key]);
    });
  }

  private _addListeners() {
    const changeListener = debounce(this.handleChange.bind(this), this.options.debounceSuggestionsWhileTyping);
    this.editor.on('change', changeListener);
    this.editorListeners.change = changeListener;

    const self = this;
    this.connectionListeners = {
      hover: this.handleHover.bind(self),
      highlight: this.handleHighlight.bind(self),
      completion: this.handleCompletion.bind(self),
      signature: this.handleSignature.bind(self),
      diagnostic: this.handleDiagnostic.bind(self),
      goTo: this.handleGoTo.bind(self),
    };

    Object.keys(this.connectionListeners).forEach((key) => {
      this.connection.on(key as any, this.connectionListeners[key]);
    });

    const mouseOverListener = this.handleMouseOver.bind(this);
    this.editor.getWrapperElement().addEventListener('mousemove', mouseOverListener);
    this.editorListeners.mouseover = mouseOverListener;

    const debouncedCursor = debounce(() => {
      this.connection.getDocumentHighlights(this.editor.getDoc().getCursor('start'));
    }, this.options.quickSuggestionsDelay);

    const rightClickHandler = this._handleRightClick.bind(this);
    this.editor.getWrapperElement().addEventListener('contextmenu', rightClickHandler);
    this.editorListeners.contextmenu = rightClickHandler;

    this.editor.on('cursorActivity', debouncedCursor);
    this.editorListeners.cursorActivity = debouncedCursor;

    const clickOutsideListener = this._handleClickOutside.bind(this);
    document.addEventListener('click', clickOutsideListener);
    this.documentListeners.clickOutside = clickOutsideListener;
  }

  private _getTokenEndingAtPosition(code: string, location: IPosition, splitCharacters: string[]): ITokenInfo {
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

  private _isEventInsideVisible(ev: MouseEvent) {
    // Only handle mouseovers inside CodeMirror's bounding box
    let isInsideSizer = false;
    let target: HTMLElement = ev.target as HTMLElement;
    while (target !== document.body) {
      if (target.classList.contains('CodeMirror-sizer')) {
        isInsideSizer = true;
        break;
      }
      target = target.parentElement;
    }

    return isInsideSizer;
  }

  private _isEventOnCharacter(ev: MouseEvent) {
    const docPosition: IPosition = this.editor.coordsChar({
      left: ev.clientX,
      top: ev.clientY,
    }, 'window');

    const token = this.editor.getTokenAt(docPosition);
    const hasToken = !!token.string.length;

    return hasToken;
  }

  private _handleRightClick(ev: MouseEvent) {
    if (!this._isEventInsideVisible(ev) || !this._isEventOnCharacter(ev)) {
      return;
    }

    if (
      !this.connection.isDefinitionSupported() &&
      !this.connection.isTypeDefinitionSupported() &&
      !this.connection.isReferencesSupported() &&
      !this.connection.isImplementationSupported()
    ) {
      return;
    }

    ev.preventDefault();

    const docPosition: IPosition = this.editor.coordsChar({
      left: ev.clientX,
      top: ev.clientY,
    }, 'window');

    const htmlElement = document.createElement('div');
    htmlElement.classList.add('CodeMirror-lsp-context');

    if (this.connection.isDefinitionSupported()) {
      const goToDefinition = document.createElement('div');
      goToDefinition.innerText = 'Go to Definition';
      goToDefinition.addEventListener('click', () => {
        this.connection.getDefinition(docPosition);
      });
      htmlElement.appendChild(goToDefinition);
    }

    if (this.connection.isTypeDefinitionSupported()) {
      const goToTypeDefinition = document.createElement('div');
      goToTypeDefinition.innerText = 'Go to Type Definition';
      goToTypeDefinition.addEventListener('click', () => {
        this.connection.getTypeDefinition(docPosition);
      });
      htmlElement.appendChild(goToTypeDefinition);
    }

    if (this.connection.isReferencesSupported()) {
      const getReferences = document.createElement('div');
      getReferences.innerText = 'Find all References';
      getReferences.addEventListener('click', () => {
        this.connection.getReferences(docPosition);
      });
      htmlElement.appendChild(getReferences);
    }

    const coords = this.editor.charCoords(docPosition, 'page');
    this._showTooltip(htmlElement, {
      x: coords.left,
      y: coords.bottom + this.editor.defaultTextHeight(),
    });

    this.isShowingContextMenu = true;
  }

  private _handleClickOutside(ev: MouseEvent) {
    if (this.isShowingContextMenu) {
      let target: HTMLElement = ev.target as HTMLElement;
      let isInside = false;
      while (target !== document.body) {
        if (target.classList.contains('CodeMirror-lsp-tooltip')) {
          isInside = true;
          break;
        }
        target = target.parentElement;
      }

      if (isInside) {
        return;
      }

      // Only remove tooltip if clicked outside right click
      this._removeTooltip();
    }
  }

  private _showTooltip(el: HTMLElement, coords: IScreenCoord) {
    if (this.isShowingContextMenu) {
      return;
    }

    this._removeTooltip();

    let top = coords.y - this.editor.defaultTextHeight();

    this.tooltip = document.createElement('div');
    this.tooltip.classList.add('CodeMirror-lsp-tooltip');
    this.tooltip.style.left = `${coords.x}px`;
    this.tooltip.style.top = `${top}px`;
    this.tooltip.appendChild(el);
    document.body.appendChild(this.tooltip);

    // Measure and reposition after rendering first version
    requestAnimationFrame(() => {
      top += this.editor.defaultTextHeight();
      top -= this.tooltip.offsetHeight;

      this.tooltip.style.left = `${coords.x}px`;
      this.tooltip.style.top = `${top}px`;
    });
  }

  private _removeTooltip() {
    if (this.tooltip) {
      this.isShowingContextMenu = false;
      this.tooltip.remove();
    }
  }

  private _removeSignatureWidget() {
    if (this.signatureWidget) {
      this.signatureWidget.clear();
      this.signatureWidget = null;
    }
    if (this.tooltip) {
      this._removeTooltip();
    }
  }

  private _removeHover() {
    if (this.hoverMarker) {
      this.hoverMarker.clear();
      this.hoverMarker = null;
    }
  }

  private _highlightRanges(items: lsProtocol.Range[]) {
    if (this.highlightMarkers) {
      this.highlightMarkers.forEach((marker) => {
        marker.clear();
      });
    }
    this.highlightMarkers = [];
    if (!items.length) {
      return;
    }

    items.forEach((item) => {
      const start = {
        line: item.start.line,
        ch: item.start.character,
      } as CodeMirror.Position;
      const end = {
        line: item.end.line,
        ch: item.end.character,
      } as CodeMirror.Position;

      this.highlightMarkers.push(this.editor.getDoc().markText(start, end, {
        css: 'background-color: #dde',
      }));
    });
  }
}

export default CodeMirrorAdapter;
