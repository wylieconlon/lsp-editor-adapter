import * as rpc from '@sourcegraph/vscode-ws-jsonrpc';
import { ConsoleLogger } from '@sourcegraph/vscode-ws-jsonrpc';
import * as events from 'events';
import * as lsProtocol from 'vscode-languageserver-protocol';
import { ServerCapabilities } from 'vscode-languageserver-protocol';
import { ILspConnection, ILspOptions, IPosition, ITokenInfo } from './types';

interface IFilesServerClientCapabilities {
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
type ExtendedClientCapabilities = lsProtocol.ClientCapabilities & IFilesServerClientCapabilities;

class LspWsConnection extends events.EventEmitter implements ILspConnection {

  public showingTooltip = false;
  private socket: WebSocket;
  private documentInfo: ILspOptions;
  private serverCapabilities: lsProtocol.ServerCapabilities;
  private documentVersion = 0;
  private connection: rpc.MessageConnection;

  constructor(options: ILspOptions) {
    super();
    this.documentInfo = options;
  }

  /**
   * Initialize a connection over a web socket that speaks the LSP protocol
   */
  public connect(socket: WebSocket): this {
    this.socket = socket;

    rpc.listen({
      webSocket: this.socket,
      logger: new ConsoleLogger(),
      onConnection: (connection: rpc.MessageConnection) => {
        connection.listen();

        this.connection = connection;
        this.sendInitialize();

        this.connection.onNotification('textDocument/publishDiagnostics', (
          params: lsProtocol.PublishDiagnosticsParams,
        ) => {
          this.emit('diagnostic', params);
        });

        this.connection.onNotification('window/showMessage', (params: lsProtocol.ShowMessageParams) => {
          this.emit('logging', params);
        });

        this.connection.onRequest('window/showMessageRequest', (params: lsProtocol.ShowMessageRequestParams) => {
          this.emit('logging', params);
        });

        connection.onError((e) => {
          this.emit('error', e);
        });
      },
    });

    return this;
  }

  public sendInitialize() {
    const message: lsProtocol.InitializeParams = {
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
            },
          },
        } as ExtendedClientCapabilities,
        workspace: {
          didChangeConfiguration: {
            dynamicRegistration: true,
          },
        } as lsProtocol.WorkspaceClientCapabilities,
        // xfilesProvider: true,
        // xcontentProvider: true,
      } as lsProtocol.ClientCapabilities,
      initializationOptions: null,
      processId: null,
      rootUri: this.documentInfo.rootUri,
      workspaceFolders: null,
    };

    this.connection.sendRequest('initialize', message).then((params: lsProtocol.InitializeResult) => {
      this.serverCapabilities = params.capabilities as ServerCapabilities;
      const textDocumentMessage: lsProtocol.DidOpenTextDocumentParams = {
        textDocument: {
          uri: this.documentInfo.documentUri,
          languageId: this.documentInfo.languageId,
          text: this.documentInfo.documentText(),
          version: this.documentVersion,
        } as lsProtocol.TextDocumentItem,
      };
      this.connection.sendNotification('initialized');
      this.connection.sendNotification('workspace/didChangeConfiguration', {
        settings: {},
      });
      this.connection.sendNotification('textDocument/didOpen', textDocumentMessage);
      this.sendChange();
    }, (e) => {
    });
  }

  public sendChange() {
    const textDocumentChange: lsProtocol.DidChangeTextDocumentParams = {
      textDocument: {
        uri: this.documentInfo.documentUri,
        version: this.documentVersion,
      } as lsProtocol.VersionedTextDocumentIdentifier,
      contentChanges: [{
        text: this.documentInfo.documentText(),
      }],
    };
    this.connection.sendNotification('textDocument/didChange', textDocumentChange);
    this.documentVersion++;
  }

  public getHoverTooltip(location: IPosition) {
    this.connection.sendRequest('textDocument/hover', {
      textDocument: {
        uri: this.documentInfo.documentUri,
      },
      position: {
        line: location.line,
        character: location.ch,
      },
    } as lsProtocol.TextDocumentPositionParams).then((params: lsProtocol.Hover) => {
      if (params) {
        this.emit('hover', params);
      }
    });
  }

  public getCompletion(
    location: IPosition,
    token: ITokenInfo,
    triggerCharacter?: string,
    triggerKind?: lsProtocol.CompletionTriggerKind,
  ) {
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
    } as lsProtocol.CompletionParams).then((params: lsProtocol.CompletionList) => {
      if (!(params && params.items.length)) {
        return;
      }

      this.emit('completion', params.items);
    });
  }

  public getDetailedCompletion(completionItem: lsProtocol.CompletionItem) {
    this.connection.sendRequest('completionItem/resolve', completionItem)
      .then((result: lsProtocol.CompletionItem) => {
        this.emit('completionResolved', result);
      });
  }

  public getSignatureHelp(location: IPosition) {
    if (!(this.serverCapabilities && this.serverCapabilities.signatureHelpProvider)) {
      return;
    }

    const code = this.documentInfo.documentText();
    const lines = code.split('\n');
    const typedCharacter = lines[location.line][location.ch];

    if (
      this.serverCapabilities.signatureHelpProvider &&
      !this.serverCapabilities.signatureHelpProvider.triggerCharacters.indexOf(typedCharacter)
    ) {
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
    } as lsProtocol.TextDocumentPositionParams).then((params: lsProtocol.SignatureHelp) => {
      if (params) {
        this.emit('signature', params);
      }
    });
  }

  /**
   * Request the locations of all matching document symbols
   */
  public getDocumentHighlights(location: IPosition) {
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
    } as lsProtocol.TextDocumentPositionParams).then((params: lsProtocol.DocumentHighlight[]) => {
      if (params) {
        this.emit('highlight', params);
      }
    });
  }

  /**
   * The characters that trigger completion automatically.
   */
  public getLanguageCompletionCharacters(): string[] {
    if (!(this.serverCapabilities && this.serverCapabilities.completionProvider)) {
      return [];
    }
    return this.serverCapabilities.completionProvider.triggerCharacters;
  }

  /**
   * The characters that trigger signature help automatically.
   */
  public getLanguageSignatureCharacters(): string[] {
    if (!(this.serverCapabilities && this.serverCapabilities.signatureHelpProvider)) {
      return [];
    }
    return this.serverCapabilities.signatureHelpProvider.triggerCharacters;
  }
}

export default LspWsConnection;
