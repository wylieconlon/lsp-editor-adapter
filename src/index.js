"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * An adapter is responsible for connecting a particular text editor with a LSP connection
 * and will send messages over the connection and display responses in the editor
 */
class IEditorAdapter {
    constructor(connection, options, editor) { }
}
exports.IEditorAdapter = IEditorAdapter;
function getFilledDefaults(options) {
    return Object.assign({}, {
        suggestOnTriggerCharacters: true,
        acceptSuggestionOnEnter: true,
        acceptSuggestionOnTab: true,
        acceptSuggestionOnCommitCharacter: true,
        selectionHighlight: true,
        occurrencesHighlight: true,
        codeLens: true,
        folding: true,
        foldingStrategy: 'auto',
        showFoldingControls: 'mouseover',
        suggest: true,
        debounceSuggestionsWhileTyping: 200,
        quickSuggestions: true,
        quickSuggestionsDelay: 200,
        enableParameterHints: true,
        iconsInSuggestions: true,
        formatOnType: false,
        formatOnPaste: false,
    }, options);
}
exports.getFilledDefaults = getFilledDefaults;
;
