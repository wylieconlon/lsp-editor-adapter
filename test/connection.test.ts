import expect from 'expect';
import * as sinon from 'sinon';
import * as lsProtocol from 'vscode-languageserver-protocol';
import { LspWsConnection } from '../src/';

let serverUri = 'ws://localhost:8080';

type Listener = (args: any) => void;

interface Listeners {
  [type: string]: Listener[]
}

// There is a library that can be used to mock WebSockets, but the API surface tested here is small
// enough that it is not necessary to use the library. This mock is a simple EventEmitter
class MockSocket implements EventTarget {
  readonly CLOSED: number;
  readonly CLOSING: number;
  readonly CONNECTING: number;
  readonly OPEN: number;
  binaryType: BinaryType;
  readonly bufferedAmount: number;
  readonly extensions: string;
  readonly protocol: string;
  readonly readyState: number;
  readonly url: string;

  listeners : Listeners = {}
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

  constructor(url: string, protocols?: string[]) {}

  /**
   * Mocks sending data to the server. The fake implementation needs to respond with some data
   */
  send = sinon.stub()
  addEventListener = sinon.mock().callsFake((type: keyof WebSocketEventMap, listener: Listener) => {
    let listeners : Listener[] = this.listeners[type];
    if (!listeners) this.listeners[type] = [];
    listeners.push(listener);
  })
  removeEventListener = sinon.mock().callsFake((type: keyof WebSocketEventMap, listener: Listener) => {
    let index = this.listeners[type].indexOf((l) => l === listener);
    if (index > -1) {
      this.listeners[type].splice(index, 1);
    }
  })
  close = sinon.stub()

  /**
   * Sends a synthetic event to the client code, for example to imitate a server response
   */
  dispatchEvent = ((event: Event) => {
    let listeners : Listener[] = this.listeners[event.type];
    if (!listeners) {
      return false;
    }
    listeners.forEach((listener) => listener.call(null, event));
  })
}

describe('LspWsConnection', function() {
  let connection: LspWsConnection;
  let mockSocket : MockSocket;

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
      console.log('socket is initializing');
      let message = JSON.parse(str);
      expect(message.method).toEqual('initialize');

      // This is an actual response from the html language server
      let data = JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: <lsProtocol.InitializeResult> {
          capabilities: {
            textDocumentSync: 1,
            hoverProvider: true,
            documentHighlightProvider: true,
            documentRangeFormattingProvider: false,
            documentLinkProvider: {
              resolveProvider: false
            },
            documentSymbolProvider: true,
            definitionProvider: true,
            signatureHelpProvider: {
              triggerCharacters: ["("]
            },
            typeDefinitionProvider: true,
            referencesProvider: true,
            colorProvider: {},
            foldingRangeProvider: true,
            workspaceSymbolProvider: true,
            completionProvider: {
              resolveProvider: true,
              triggerCharacters: ['.']
            },
            codeActionProvider: true,
            renameProvider: true,
            executeCommandProvider: {
              commands: []
            }
          }
        }
      });

      mockSocket.dispatchEvent(new MessageEvent('message', { data }));
    });

    // 2. After receiving capabilities from the server, it sends more configuration options
    mockSocket.send.onSecondCall().callsFake((str) => {
      console.log('socket has been initialized');
      let message = JSON.parse(str);
      expect(message.method).toEqual('initialized');

      setTimeout(() => {
        let mock = mockSocket.send;
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
    expect(mockSocket.send.callCount).toEqual(1);;
    expect(JSON.parse(mockSocket.send.firstCall.args[0]).method).toEqual('initialize');
  });

  it('handles hover events', (done) => {
    let hoverResponse = <lsProtocol.Hover> {
      contents: 'Details of hover',
      range: {
        start: {
          line: 1,
          character: 0
        },
        end: {
          line: 2,
          character: 0
        }
      }
    };

    // Fake response just includes the hover provider
    mockSocket.send.onFirstCall().callsFake((str) => {
      let data = JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        result: <lsProtocol.InitializeResult> {
          capabilities: {
            hoverProvider: true,
          }
        }
      });

      mockSocket.dispatchEvent(new MessageEvent('message', { data }));
    });
    
    // 2. After receiving capabilities from the server, we will send a hover
    mockSocket.send.onSecondCall().callsFake((str) => {
      connection.getHoverTooltip({
        line: 1,
        ch: 0
      });
    });

    // 3. Fake a server response for the hover
    mockSocket.send.onThirdCall().callsFake((str) => {
      let message= JSON.parse(str);

      let data = JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: hoverResponse
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