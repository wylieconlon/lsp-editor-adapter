import expect from 'expect';
import * as sinon from 'sinon';
import * as lsProtocol from 'vscode-languageserver-protocol';
import { LspWsConnection } from '../src/';

let serverUri = 'ws://localhost:8080';

interface Listeners {
  [type: string]: ((args: any) => void)[]
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
  get onclose() {
    return this.listeners['close'][0];
  }
  set onclose(handler: ((ev: CloseEvent) => any)) {
    if (handler) {
      this.listeners['close'] = [handler];
    }
  }
  get onerror() {
    return this.listeners['error'][0];
  }
  set onerror(handler: ((ev: Event) => any)) {
    if (handler) {
      this.listeners['error'] = [handler];
    }
  }
  get onmessage() {
    return this.listeners['message'][0];
  }
  set onmessage(handler: ((ev: MessageEvent) => any)) {
    if (handler) {
      this.listeners['message'] = [handler];
    }
  }
  get onopen() {
    return this.listeners['open'][0];
  }
  set onopen(handler: ((ev: Event) => any)) {
    if (handler) {
      this.listeners['open'] = [handler];
    }
  }

  constructor(url: string, protocols?: string[]) {}

  /**
   * Mocks sending data to the server. The fake implementation needs to respond with some data
   */
  // send = jest.fn()
  send = sinon.stub()
  addEventListener = sinon.fake((type: keyof WebSocketEventMap, listener) => {
    let listeners = this.listeners[type];
    if (!listeners) this.listeners[type] = [];
    listeners.push(listener);
  })
  removeEventListener = sinon.fake((type, listener) => {
    let index = this.listeners[type].indexOf((l) => l === listener);
    if (index > -1) {
      this.listeners[type].splice(index, 1);
    }
  })
  close = sinon.fake()

  /**
   * Sends a synthetic event to the client code, for example to imitate a server response
   */
  dispatchEvent = ((event: Event) => {
    let listeners = this.listeners[event.type];
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
    console.log('connection');
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
    mockSocket.send.onCall(0).callsFake((str) => {
      let message = JSON.parse(str);
      expect(message.method).toEqual('initialize');

      // This is an actual response from the html language serer
      let data = JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
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
            referencesProvider: true,
            colorProvider: {},
            foldingRangeProvider: true
          }
        }
      });

      mockSocket.dispatchEvent(new MessageEvent('message', { data }));
    });

    // 2. After receiving capabilities from the server, it sends more configuration options
    mockSocket.send.onCall(1).callsFake((str) => {
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
    expect(JSON.parse(mockSocket.send.firstCall[0]).method).toEqual('initialize');
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
    mockSocket.send
      .onFirstCall().callsFake((str) => {
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
      })
      // 2. After receiving capabilities from the server, we will send a hover
      .onSecondCall().callsFake((str) => {
        connection.getHoverTooltip({
          line: 1,
          ch: 0
        });
      })
      // 3. Fake a server response for the hover
      .onThirdCall().callsFake((str) => {
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
