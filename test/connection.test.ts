import * as expect from 'expect';
import * as sinon from 'sinon';
import * as lsProtocol from 'vscode-languageserver-protocol';
import { LspWsConnection } from '../src/';

const serverUri = 'ws://localhost:8080';

type Listener = (args: any) => void;

interface IListeners {
  [type: string]: Listener[];
}

// There is a library that can be used to mock WebSockets, but the API surface tested here is small
// enough that it is not necessary to use the library. This mock is a simple EventEmitter
class MockSocket implements EventTarget {
  set onclose(handler: ((ev: CloseEvent) => any)) {
    if (handler) {
      this.listeners.close = [handler];
    }
  }
  set onerror(handler: ((ev: Event) => any)) {
    if (handler) {
      this.listeners.error = [handler];
    }
  }
  set onmessage(handler: ((ev: MessageEvent) => any)) {
    if (handler) {
      this.listeners.message = [handler];
    }
  }
  set onopen(handler: ((ev: Event) => any)) {
    if (handler) {
      this.listeners.open = [handler];
    }
  }
  public readonly CLOSED: number;
  public readonly CLOSING: number;
  public readonly CONNECTING: number;
  public readonly OPEN: number;
  public binaryType: BinaryType;
  public readonly bufferedAmount: number;
  public readonly extensions: string;
  public readonly protocol: string;
  public readonly readyState: number;
  public readonly url: string;

  public listeners: IListeners = {};

  /**
   * Mocks sending data to the server. The fake implementation needs to respond with some data
   */
  public send = sinon.stub();
  public addEventListener = sinon.mock().callsFake((type: keyof WebSocketEventMap, listener: Listener) => {
    const listeners: Listener[] = this.listeners[type];
    if (!listeners) { this.listeners[type] = []; }
    listeners.push(listener);
  });
  public removeEventListener = sinon.mock().callsFake((type: keyof WebSocketEventMap, listener: Listener) => {
    const index = this.listeners[type].indexOf((l) => l === listener);
    if (index > -1) {
      this.listeners[type].splice(index, 1);
    }
  });
  public close = sinon.stub();

  /**
   * Sends a synthetic event to the client code, for example to imitate a server response
   */
  public dispatchEvent = ((event: Event) => {
    const listeners: Listener[] = this.listeners[event.type];
    if (!listeners) {
      return false;
    }
    listeners.forEach((listener) => listener.call(null, event));
  });

  constructor(url: string, protocols?: string[]) {}
}

describe('LspWsConnection', () => {
  let connection: LspWsConnection;
  let mockSocket: MockSocket;

  beforeEach(() => {
    connection = new LspWsConnection({
      languageId: 'plaintext',
      rootUri: 'file://' + __dirname,
      documentUri: 'file://' + __dirname,
      serverUri,
      documentText: () => '',
    });
    mockSocket = new MockSocket('ws://localhost:8080');
  });

  afterEach(() => {
    sinon.restore();
  });

  it('initializes the connection in the right order', (done) => {
    // 1. It sends initialize and expects a response with capabilities
    mockSocket.send.onFirstCall().callsFake((str) => {
      const message = JSON.parse(str);
      expect(message.method).toEqual('initialize');

      // This is an actual response from the html language server
      const data = JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          capabilities: {
            textDocumentSync: 1,
            hoverProvider: true,
            documentHighlightProvider: true,
            documentRangeFormattingProvider: false,
            documentLinkProvider: {
              resolveProvider: false,
            },
            documentSymbolProvider: true,
            definitionProvider: true,
            signatureHelpProvider: {
              triggerCharacters: ['('],
            },
            typeDefinitionProvider: true,
            referencesProvider: true,
            colorProvider: {},
            foldingRangeProvider: true,
            workspaceSymbolProvider: true,
            completionProvider: {
              resolveProvider: true,
              triggerCharacters: ['.'],
            },
            codeActionProvider: true,
            renameProvider: true,
            executeCommandProvider: {
              commands: [],
            },
          },
        } as lsProtocol.InitializeResult,
      });

      mockSocket.dispatchEvent(new MessageEvent('message', { data }));
    });

    // 2. After receiving capabilities from the server, it sends more configuration options
    mockSocket.send.onSecondCall().callsFake((str) => {
      const message = JSON.parse(str);
      expect(message.method).toEqual('initialized');

      setTimeout(() => {
        const mock = mockSocket.send;
        expect(mock.callCount).toEqual(5);

        // 3, 4, 5 are sent after initialization
        expect(JSON.parse(mock.getCall(2).args[0]).method).toEqual('workspace/didChangeConfiguration');
        expect(JSON.parse(mock.getCall(3).args[0]).method).toEqual('textDocument/didOpen');
        expect(JSON.parse(mock.getCall(4).args[0]).method).toEqual('textDocument/didChange');

        done();
      }, 0);
    });

    connection.connect(mockSocket);
    mockSocket.dispatchEvent(new Event('open'));

    // Send the messages
    expect(mockSocket.send.callCount).toEqual(1);
    expect(JSON.parse(mockSocket.send.firstCall.args[0]).method).toEqual('initialize');
  });

  describe('hover', () => {
    let hoverResponse: lsProtocol.Hover;

    beforeEach(() => {
      // Fake response just includes the hover provider
      mockSocket.send.onFirstCall().callsFake((str) => {
        const data = JSON.stringify({
          jsonrpc: '2.0',
          id: 0,
          result: {
            capabilities: {
              hoverProvider: true,
            },
          } as lsProtocol.InitializeResult,
        });

        mockSocket.dispatchEvent(new MessageEvent('message', { data }));
      });

      // 2. After receiving capabilities from the server, we will send a hover
      mockSocket.send.onSecondCall().callsFake((str) => {
        connection.getHoverTooltip({
          line: 1,
          ch: 0,
        });
      });

    });

    it('emits a null hover event', (done) => {
      // 3. Fake a server response for the hover
      mockSocket.send.onThirdCall().callsFake((str) => {
        const message = JSON.parse(str);

        const data = JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: null,
        });

        mockSocket.dispatchEvent(new MessageEvent('message', { data }));
      });

      connection.connect(mockSocket);
      mockSocket.dispatchEvent(new Event('open'));

      connection.on('hover', (response) => {
        expect(response).toBeNull();
        done();
      });
    });

    it('emits a complete hover event', (done) => {
      hoverResponse = {
        contents: 'Details of hover',
        range: {
          start: {
                line: 1,
            character: 0,
          },
          end: {
            line: 2,
            character: 0,
          },
        },
      } as lsProtocol.Hover;

      // 3. Fake a server response for the hover
      mockSocket.send.onThirdCall().callsFake((str) => {
        const message = JSON.parse(str);

        const data = JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: hoverResponse,
        });

        mockSocket.dispatchEvent(new MessageEvent('message', { data }));
      });

      connection.connect(mockSocket);
      mockSocket.dispatchEvent(new Event('open'));

      connection.on('hover', (response) => {
        expect(response).toEqual(hoverResponse);
        done();
      });
    });
  });

  describe('completion', () => {
    let completionResponse: lsProtocol.CompletionList;

    beforeEach(() => {
      // Fake response just includes the hover provider
      mockSocket.send.onFirstCall().callsFake((str) => {
        const data = JSON.stringify({
          jsonrpc: '2.0',
          id: 0,
          result: {
            capabilities: {
              completionProvider: {
                triggerCharacters: ['.'],
                resolveProvider: false,
              },
            },
          } as lsProtocol.InitializeResult,
        });

        mockSocket.dispatchEvent(new MessageEvent('message', { data }));
      });

      // 2. After receiving capabilities from the server, we will send a completion
      mockSocket.send.onSecondCall().callsFake((str) => {
        connection.getCompletion({
          line: 1,
          ch: 8,
        }, {
          start: {
            line: 1,
            ch: 8,
          },
          end: {
            line: 1,
            ch: 9,
          },
          text: '.',
        });
      });

    });

    it('emits a null completion event', (done) => {
      // 3. Fake a server response for the hover
      mockSocket.send.onThirdCall().callsFake((str) => {
        const message = JSON.parse(str);

        const data = JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: null,
        });

        mockSocket.dispatchEvent(new MessageEvent('message', { data }));
      });

      connection.connect(mockSocket);
      mockSocket.dispatchEvent(new Event('open'));

      connection.on('completion', (response) => {
        expect(response).toBeNull();
        done();
      });
    });

    it('emits a completion event', (done) => {
      completionResponse = {
        isIncomplete: false,
        items: [{
          label: 'log',
        }, {
          label: 'info',
        }],
       } as lsProtocol.CompletionList;

      // 3. Fake a server response for the hover
      mockSocket.send.onThirdCall().callsFake((str) => {
        const message = JSON.parse(str);

        const data = JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: completionResponse,
        });

        mockSocket.dispatchEvent(new MessageEvent('message', { data }));
      });

      connection.connect(mockSocket);
      mockSocket.dispatchEvent(new Event('open'));

      connection.on('completion', (response) => {
        expect(response).toEqual(completionResponse.items);
        done();
      });
    });
  });

  it('closes the socket connection and stops sending messages', () => {
    connection.connect(mockSocket);
    connection.close();

    connection.sendChange();
    expect(mockSocket.send.callCount).toEqual(0);
  });
});
