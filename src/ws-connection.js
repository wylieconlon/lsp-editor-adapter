"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const lsProtocol = __importStar(require("vscode-languageserver-protocol"));
const rpc = __importStar(require("vscode-ws-jsonrpc"));
const events_1 = require("events");
class LspWsConnection extends events_1.EventEmitter {
    constructor(options) {
        super();
        this.documentVersion = 0;
        this.showingTooltip = false;
        this.documentInfo = options;
        this.connect(options.serverUri);
    }
    connect(uri) {
        this.socket = new WebSocket(uri);
        rpc.listen({
            webSocket: this.socket,
            onConnection: (connection) => {
                connection.listen();
                this.connection = connection;
                this.sendInitialize();
                this.connection.onNotification('textDocument/publishDiagnostics', (params) => {
                    this.emit('diagnostic', params);
                });
                this.connection.onNotification('window/showMessage', (params) => {
                    this.emit('logging', params);
                });
                this.connection.onRequest('window/showMessageRequest', (params) => {
                    this.emit('logging', params);
                });
                connection.onError((e) => {
                    this.emit('error', e);
                });
            }
        });
    }
    sendInitialize() {
        let message = {
            capabilities: {
                textDocument: {
                    hover: {
                        dynamicRegistration: true,
                        contentFormat: ['plaintext', 'markdown'],
                    },
                    synchronization: {
                        dynamicRegistration: true,
                        willSave: false,
                        didSave: false,
                        willSaveWaitUntil: false,
                    },
                    completion: {
                        dynamicRegistration: true,
                        completionItem: {
                            snippetSupport: false,
                            commitCharactersSupport: true,
                            documentationFormat: ['plaintext', 'markdown'],
                            deprecatedSupport: false,
                            preselectSupport: false,
                        },
                        contextSupport: false,
                    },
                    signatureHelp: {
                        dynamicRegistration: true,
                        signatureInformation: {
                            documentationFormat: ['plaintext', 'markdown'],
                        }
                    }
                },
                workspace: {
                    didChangeConfiguration: {
                        dynamicRegistration: true,
                    }
                },
            },
            initializationOptions: null,
            processId: null,
            rootUri: this.documentInfo.rootUri,
            workspaceFolders: null,
        };
        this.connection.sendRequest('initialize', message).then((params) => {
            this.serverCapabilities = params.capabilities;
            let textDocumentMessage = {
                textDocument: {
                    uri: this.documentInfo.documentUri,
                    languageId: 'javascript',
                    text: this.documentInfo.documentText(),
                    version: this.documentVersion,
                }
            };
            this.connection.sendNotification('initialized');
            this.connection.sendNotification('workspace/didChangeConfiguration', {
                settings: {},
            });
            this.connection.sendNotification('textDocument/didOpen', textDocumentMessage);
            this.sendChange();
        });
    }
    sendChange() {
        let textDocumentChange = {
            textDocument: {
                uri: this.documentInfo.documentUri,
                version: this.documentVersion,
            },
            contentChanges: [{
                    text: this.documentInfo.documentText(),
                }],
        };
        this.connection.sendNotification('textDocument/didChange', textDocumentChange);
        this.documentVersion++;
    }
    getHoverTooltip(location) {
        this.connection.sendRequest('textDocument/hover', {
            textDocument: {
                uri: this.documentInfo.documentUri,
            },
            position: {
                line: location.line,
                character: location.ch,
            },
        }).then((params) => {
            if (params) {
                this.emit('hover', params);
            }
        });
    }
    getCompletion(location, token, triggerCharacter, triggerKind) {
        if (!(this.serverCapabilities && this.serverCapabilities.completionProvider)) {
            return;
        }
        this.connection.sendRequest('textDocument/completion', {
            textDocument: {
                uri: this.documentInfo.documentUri,
            },
            position: {
                line: location.line,
                character: location.ch,
            },
            context: {
                triggerKind: triggerKind || lsProtocol.CompletionTriggerKind.Invoked,
                triggerCharacter,
            },
        }).then((params) => {
            if (!(params && params.items.length)) {
                return;
            }
            this.emit('completion', params.items);
        });
    }
    getDetailedCompletion(completionItem) {
        this.connection.sendRequest('completionItem/resolve', completionItem)
            .then((result) => {
            this.emit('completionResolved', result);
        });
    }
    getSignatureHelp(location) {
        if (!(this.serverCapabilities && this.serverCapabilities.signatureHelpProvider)) {
            return;
        }
        let code = this.documentInfo.documentText();
        let lines = code.split('\n');
        let typedCharacter = lines[location.line][location.ch];
        if (this.serverCapabilities.signatureHelpProvider &&
            !this.serverCapabilities.signatureHelpProvider.triggerCharacters.indexOf(typedCharacter)) {
            // Not a signature character
            return;
        }
        this.connection.sendRequest('textDocument/signatureHelp', {
            textDocument: {
                uri: this.documentInfo.documentUri,
            },
            position: {
                line: location.line,
                character: location.ch,
            },
        }).then((params) => {
            if (params) {
                this.emit('signature', params);
            }
        });
    }
    /**
     * Request the locations of all matching document symbols
     */
    getDocumentHighlights(location) {
        if (!(this.serverCapabilities && this.serverCapabilities.documentHighlightProvider)) {
            return;
        }
        this.connection.sendRequest('textDocument/documentHighlight', {
            textDocument: {
                uri: this.documentInfo.documentUri,
            },
            position: {
                line: location.line,
                character: location.ch,
            },
        }).then((params) => {
            if (params) {
                this.emit('highlight', params);
            }
        });
    }
    /**
     * The characters that trigger completion automatically.
     */
    getLanguageCompletionCharacters() {
        if (!(this.serverCapabilities && this.serverCapabilities.completionProvider)) {
            return [];
        }
        return this.serverCapabilities.completionProvider.triggerCharacters;
    }
    /**
     * The characters that trigger signature help automatically.
     */
    getLanguageSignatureCharacters() {
        if (!(this.serverCapabilities && this.serverCapabilities.signatureHelpProvider)) {
            return [];
        }
        return this.serverCapabilities.signatureHelpProvider.triggerCharacters;
    }
}
exports.default = LspWsConnection;
