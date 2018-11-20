import * as lsProtocol from 'vscode-languageserver-protocol';
import * as rpc from '@sourcegraph/vscode-ws-jsonrpc';
import { ServerCapabilities } from 'vscode-languageserver-protocol';
import { IPosition, LSPOptions, LSPConnection, TokenInfo } from '.';
import { EventEmitter } from 'events';
import { ConsoleLogger } from '@sourcegraph/vscode-ws-jsonrpc';

interface _FilesServerClientCapabilities {
  /* ... all fields from the base ClientCapabilities ... */

  /**
   * The client provides support for workspace/xfiles.
   */
  xfilesProvider?: boolean;
  /**
   * The client provides support for textDocument/xcontent.
   */
  xcontentProvider?: boolean;
}
type ExtendedClientCapabilities = lsProtocol.ClientCapabilities & _FilesServerClientCapabilities;

class LspWsConnection extends EventEmitter implements LSPConnection {
  private socket: WebSocket;
  private documentInfo : LSPOptions;
  private serverCapabilities: lsProtocol.ServerCapabilities;
  private documentVersion = 0;
  private connection : rpc.MessageConnection;

  public showingTooltip = false;

  constructor(options: LSPOptions) {
    super();
    this.documentInfo = options;
  }

  /**
   * Initialize a connection over a web socket that speaks the LSP protocol
   */
  connect(socket: WebSocket) : this {
    this.socket = socket;

    rpc.listen({
      webSocket: this.socket,
      logger: new ConsoleLogger(),
      onConnection: (connection: rpc.MessageConnection) => {
        connection.listen();

        this.connection = connection;
        this.sendInitialize();

        this.connection.onNotification('textDocument/publishDiagnostics', (params : lsProtocol.PublishDiagnosticsParams) => {
          this.emit('diagnostic', params);
        });
  
        this.connection.onNotification('window/showMessage', (params : lsProtocol.ShowMessageParams) => {
          this.emit('logging', params);
        });

        this.connection.onRequest('window/showMessageRequest', (params : lsProtocol.ShowMessageRequestParams) => {
          this.emit('logging', params);
        });

        connection.onError((e) => {
          this.emit('error', e);
        });
      }
    });

    return this;
  }

  sendInitialize() {
    let message : lsProtocol.InitializeParams = {
      capabilities: <lsProtocol.ClientCapabilities> {
        textDocument: <ExtendedClientCapabilities> {
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
        workspace: <lsProtocol.WorkspaceClientCapabilities> {
          didChangeConfiguration: {
            dynamicRegistration: true,
          }
        },
        // xfilesProvider: true,
        // xcontentProvider: true,
      },
      initializationOptions: null,
      processId: null,
      rootUri: this.documentInfo.rootUri,
      workspaceFolders: null,
    }

    this.connection.sendRequest('initialize', message).then((params : lsProtocol.InitializeResult) => {
      this.serverCapabilities = <ServerCapabilities> params.capabilities;
      let textDocumentMessage : lsProtocol.DidOpenTextDocumentParams = {
        textDocument: <lsProtocol.TextDocumentItem> {
          uri: this.documentInfo.documentUri,
          languageId: 'javascript',
          text: this.documentInfo.documentText(),
          version: this.documentVersion,
        }
      }
      this.connection.sendNotification('initialized');
      this.connection.sendNotification('workspace/didChangeConfiguration', {
        settings: {},
      });
      this.connection.sendNotification('textDocument/didOpen', textDocumentMessage);
      this.sendChange();
    }, (e) => {
      console.error(e);
    });
  }

  sendChange() {
    let textDocumentChange : lsProtocol.DidChangeTextDocumentParams = {
      textDocument: <lsProtocol.VersionedTextDocumentIdentifier> {
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

  getHoverTooltip(location: IPosition) {
    this.connection.sendRequest('textDocument/hover', <lsProtocol.TextDocumentPositionParams> {
      textDocument: {
        uri: this.documentInfo.documentUri,
      },
      position: {
        line: location.line,
        character: location.ch,
      },
    }).then((params : lsProtocol.Hover) => {
      if (params) {
        this.emit('hover', params);
      }
    });
  }

  getCompletion(location: IPosition, token: TokenInfo, triggerCharacter?: string, triggerKind?: lsProtocol.CompletionTriggerKind) {
    if (!(this.serverCapabilities && this.serverCapabilities.completionProvider)) {
      return;
    }

    this.connection.sendRequest('textDocument/completion', <lsProtocol.CompletionParams> {
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
    }).then((params : lsProtocol.CompletionList) => {
      if (!(params && params.items.length)) {
        return;
      }

      this.emit('completion', params.items);
    });
  }

  getDetailedCompletion(completionItem: lsProtocol.CompletionItem) {
    this.connection.sendRequest('completionItem/resolve', completionItem)
      .then((result: lsProtocol.CompletionItem) => {
        this.emit('completionResolved', result);
      });
  }

  getSignatureHelp(location: IPosition) {
    if (!(this.serverCapabilities && this.serverCapabilities.signatureHelpProvider)) {
      return;
    }

    let code = this.documentInfo.documentText();
    let lines = code.split('\n');
    let typedCharacter = lines[location.line][location.ch];

    if (
      this.serverCapabilities.signatureHelpProvider &&
      !this.serverCapabilities.signatureHelpProvider.triggerCharacters.indexOf(typedCharacter)
    ) {
      // Not a signature character
      return;
    }

    this.connection.sendRequest('textDocument/signatureHelp', <lsProtocol.TextDocumentPositionParams> {
      textDocument: {
        uri: this.documentInfo.documentUri,
      },
      position: {
        line: location.line,
        character: location.ch,
      },
    }).then((params : lsProtocol.SignatureHelp) => {
      if (params) {
        this.emit('signature', params);
      }
    });
  }

  /**
   * Request the locations of all matching document symbols
   */
  getDocumentHighlights(location: IPosition) {
    if (!(this.serverCapabilities && this.serverCapabilities.documentHighlightProvider)) {
      return;
    }
    
    this.connection.sendRequest('textDocument/documentHighlight', <lsProtocol.TextDocumentPositionParams> {
      textDocument: {
        uri: this.documentInfo.documentUri,
      },
      position: {
        line: location.line,
        character: location.ch,
      },
    }).then((params: lsProtocol.DocumentHighlight[]) => {
      if (params) {
        this.emit('highlight', params);
      }
    });
  }

  /**
   * The characters that trigger completion automatically.
   */
  getLanguageCompletionCharacters() : string[] {
    if (!(this.serverCapabilities && this.serverCapabilities.completionProvider)) {
      return [];
    }
    return this.serverCapabilities.completionProvider.triggerCharacters;
  }

  /**
   * The characters that trigger signature help automatically.
   */
  getLanguageSignatureCharacters() : string[] {
    if (!(this.serverCapabilities && this.serverCapabilities.signatureHelpProvider)) {
      return [];
    }
    return this.serverCapabilities.signatureHelpProvider.triggerCharacters;
  }
}

export default LspWsConnection;
