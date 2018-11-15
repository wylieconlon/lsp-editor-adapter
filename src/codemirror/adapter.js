"use strict";
/// <reference types="@types/codemirror/codemirror-showhint" />
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const lodash_es_1 = require("lodash-es");
const lsProtocol = __importStar(require("vscode-languageserver-protocol"));
const CodeMirror = __importStar(require("codemirror"));
require("codemirror/addon/hint/show-hint.css");
require("codemirror/addon/hint/show-hint");
const __1 = require("..");
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const __2 = require("..");
class CodeMirrorAdapter extends __1.IEditorAdapter {
    constructor(connection, options, editor) {
        super(connection, options, editor);
        this.markedDiagnostics = [];
        this.highlightMarkers = [];
        this.connection = connection;
        this.options = __2.getFilledDefaults(options);
        this.editor = editor;
        this.editor.on('change', lodash_es_1.debounce(this.handleChange.bind(this), options.debounceSuggestionsWhileTyping));
        this.connection.on('hover', this.handleHover.bind(this));
        this.connection.on('highlight', this.handleHighlight.bind(this));
        this.connection.on('completion', this.handleCompletion.bind(this));
        this.connection.on('signature', this.handleSignature.bind(this));
        this.connection.on('diagnostic', this.handleDiagnostic.bind(this));
        this._debouncedGetHover = lodash_es_1.debounce((position) => {
            this.connection.getHoverTooltip(position);
        }, this.options.quickSuggestionsDelay);
        this.handleMouseOver();
        this.editor.on('cursorActivity', lodash_es_1.debounce(() => {
            this.connection.getDocumentHighlights(this.editor.getDoc().getCursor('start'));
        }, this.options.quickSuggestionsDelay));
    }
    _resetState() {
        if (this.signatureWidget) {
            this.signatureWidget.clear();
        }
    }
    handleMouseOver() {
        CodeMirror.on(this.editor.getWrapperElement(), 'mouseover', (ev) => {
            let docPosition = this.editor.coordsChar({
                left: ev.pageX,
                top: ev.pageY,
            });
            if (!this.hoverCharacter ||
                (docPosition.line !== this.hoverCharacter.line && docPosition.ch !== this.hoverCharacter.ch)) {
                this.hoverCharacter = docPosition;
                this._debouncedGetHover(docPosition);
            }
        });
    }
    handleChange() {
        let location = this.editor.getDoc().getCursor('end');
        this.connection.sendChange();
        let completionCharacters = this.connection.getLanguageCompletionCharacters();
        let signatureCharacters = this.connection.getLanguageSignatureCharacters();
        let code = this.editor.getDoc().getValue();
        let lines = code.split('\n');
        let line = lines[location.line];
        let typedCharacter = line[location.ch - 1];
        if (typeof typedCharacter === 'undefined') {
            // Line was cleared
            this._resetState();
        }
        else if (completionCharacters.indexOf(typedCharacter) > -1) {
            this.token = this._getTokenEndingAtPosition(code, location, completionCharacters);
            this.connection.getCompletion(location, this.token, completionCharacters.find((c) => c === typedCharacter), lsProtocol.CompletionTriggerKind.TriggerCharacter);
        }
        else if (signatureCharacters.indexOf(typedCharacter) > -1) {
            this.token = this._getTokenEndingAtPosition(code, location, signatureCharacters);
            this.connection.getSignatureHelp(location);
        }
        else if (!/\W/.test(typedCharacter)) {
            this.connection.getCompletion(location, this.token, '', lsProtocol.CompletionTriggerKind.Invoked);
            this.token = this._getTokenEndingAtPosition(code, location, completionCharacters.concat(signatureCharacters));
        }
        else {
            this._resetState();
        }
        console.log('typed', typedCharacter, this.token);
    }
    handleHover(response) {
        if (!response.contents || (Array.isArray(response.contents) && response.contents.length === 0)) {
            return;
        }
        if (this.hoverMarker) {
            this.hoverMarker.clear();
            this.hoverMarker = null;
        }
        const start = {
            line: response.range.start.line,
            ch: response.range.start.character
        };
        const end = {
            line: response.range.end.line,
            ch: response.range.end.character
        };
        let tooltipText;
        if (vscode_languageserver_protocol_1.MarkupContent.is(response.contents)) {
            tooltipText = response.contents.value;
        }
        else if (Array.isArray(response.contents)) {
            let firstItem = response.contents[0];
            if (vscode_languageserver_protocol_1.MarkupContent.is(firstItem)) {
                tooltipText = firstItem.value;
            }
            else if (typeof firstItem === 'object') {
                tooltipText = firstItem.value;
            }
            else {
                tooltipText = firstItem;
            }
        }
        else if (typeof response.contents === 'string') {
            tooltipText = response.contents;
        }
        this.hoverMarker = this.editor.getDoc().markText(start, end, {
            title: tooltipText,
            // css: 'background-color: #ccf',
            css: 'text-decoration: underline',
        });
    }
    handleHighlight(items) {
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
                ch: highlight.range.start.character
            };
            const end = {
                line: highlight.range.end.line,
                ch: highlight.range.end.character
            };
            this.highlightMarkers.push(this.editor.getDoc().markText(start, end, {
                css: 'background-color: #dde',
            }));
        });
    }
    handleCompletion(completions) {
        if (!this.token) {
            return;
        }
        let bestCompletions = this._getFilteredCompletions(this.token.text, completions);
        this.editor.showHint({
            completeSingle: false,
            hint: () => {
                return {
                    from: this.token.start,
                    to: this.token.end,
                    list: bestCompletions.map((completion) => completion.label),
                };
            },
        });
    }
    handleDiagnostic(response) {
        // TODO: Mark this in the gutter
        let el = document.querySelector('.diagnostics');
        el.innerHTML = '';
        this.markedDiagnostics.forEach((marker) => {
            marker.clear();
        });
        this.markedDiagnostics = [];
        response.diagnostics.forEach((diagnostic) => {
            const start = {
                line: diagnostic.range.start.line,
                ch: diagnostic.range.start.character
            };
            const end = {
                line: diagnostic.range.end.line,
                ch: diagnostic.range.end.character
            };
            this.markedDiagnostics.push(this.editor.getDoc().markText(start, end, {
                title: diagnostic.message,
                className: 'cm-error',
            }));
            let childEl = document.createElement('p');
            childEl.innerText = `Line ${start.line}: ${diagnostic.message}`;
            el.appendChild(childEl);
        });
    }
    handleSignature(result) {
        if (this.signatureWidget && (!this.token || !result.signatures.length)) {
            this.signatureWidget.clear();
            this.signatureWidget = null;
        }
        if (!result.signatures.length || !this.token) {
            return;
        }
        let htmlElement = document.createElement('div');
        htmlElement.setAttribute('style', 'font-size: 12px; border: 1px solid black;');
        result.signatures.forEach((item) => {
            let el = document.createElement('div');
            el.innerText = item.label;
            htmlElement.appendChild(el);
        });
        this.signatureWidget = this.editor.addLineWidget(this.token.start.line, htmlElement, {
            above: true
        });
    }
    _getTokenEndingAtPosition(code, location, splitCharacters) {
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
        };
    }
    _getFilteredCompletions(triggerWord, items) {
        if (!triggerWord) {
            return items;
        }
        let word = triggerWord.toLowerCase();
        return items.filter((item) => {
            if (item.filterText && item.filterText.toLowerCase().indexOf(word) === 0) {
                return true;
            }
            else {
                return item.label.toLowerCase().indexOf(word) === 0;
            }
        }).sort((a, b) => {
            let inA = (a.label.indexOf(triggerWord) === 0) ? -1 : 1;
            let inB = b.label.indexOf(triggerWord) === 0 ? 1 : -1;
            return inA + inB;
        });
    }
}
exports.default = CodeMirrorAdapter;
