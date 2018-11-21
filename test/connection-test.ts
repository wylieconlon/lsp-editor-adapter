import * as lsProtocol from 'vscode-languageserver-protocol';
import { LspWsConnection } from '../src/';

// The vscode-jsonrpc library has a timer-based loop that processes messages as soon as the timer
// is able to run. The timers aren't part of the API of the library, so to keep the focus on testing
// the connection logic, real timers are used for this test
jest.useRealTimers();

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
  send = jest.fn()
  addEventListener = jest.fn().mockImplementation((type: keyof WebSocketEventMap, listener) => {
    let listeners = this.listeners[type];
    if (!listeners) this.listeners[type] = [];
    listeners.push(listener);
  })
  removeEventListener = jest.fn().mockImplementation((type, listener) => {
    let index = this.listeners[type].indexOf((l) => l === listener);
    if (index > -1) {
      this.listeners[type].splice(index, 1);
    }
  })
  close = jest.fn()

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
    jest.clearAllMocks();
  });

  it('initializes the connection in the right order', (done) => {
    // 1. It sends initialize and expects a response with capabilities
    mockSocket.send.mockImplementationOnce((str) => {
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
    mockSocket.send.mockImplementationOnce((str) => {
      let message = JSON.parse(str);
      expect(message.method).toEqual('initialized');

      setImmediate(() => {
        let calls = mockSocket.send.mock.calls;
        expect(calls.length).toEqual(5);

        // 3, 4, 5 are sent after initialization
        expect(JSON.parse(calls[2][0]).method).toEqual('workspace/didChangeConfiguration');
        expect(JSON.parse(calls[3][0]).method).toEqual('textDocument/didOpen');
        expect(JSON.parse(calls[4][0]).method).toEqual('textDocument/didChange');

        done();
      });
    });

    connection.connect(mockSocket);
    mockSocket.dispatchEvent(new Event('open'));

    // Send the messages
    expect(mockSocket.send.mock.calls.length).toEqual(1);;
    expect(JSON.parse(mockSocket.send.mock.calls[0][0]).method).toEqual('initialize');
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
      .mockImplementationOnce((str) => {
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
      .mockImplementationOnce((str) => {
        connection.getHoverTooltip({
          line: 1,
          ch: 0
        });
      })
      // 3. Fake a server response for the hover
      .mockImplementationOnce((str) => {
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
