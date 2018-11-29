import sinon from 'sinon';
import * as lsProtocol from 'vscode-languageserver-protocol';
import { LSPConnection } from '../src'

interface Listeners {
  [key: string]: ((arg: any) => void)[]
}

// There is a library that can be used to mock WebSockets, but the API surface tested here is small
// enough that it is not necessary to use the library. This mock is a simple EventEmitter
export class MockConnection implements LSPConnection {
  listeners : Listeners = {}

  constructor() {}

  on(type: string, listener: (arg: any) => void) {
    let listeners = this.listeners[type];
    if (!listeners) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  /**
   * Sends a synthetic event to the client code, for example to imitate a server response
   */
  dispatchEvent = ((event: MessageEvent) => {
    let listeners = this.listeners[event.type];
    if (!listeners) {
      return false;
    }
    listeners.forEach((listener) => listener.call(null, event.data));
  })

  sendInitialize = sinon.stub()
  sendChange = sinon.stub()
  getHoverTooltip = sinon.stub()
  getCompletion = sinon.stub()
  getDetailedCompletion = sinon.stub()
  getSignatureHelp = sinon.stub()
  getDocumentHighlights = sinon.stub()

  getLanguageCompletionCharacters() {
    return ['.', ','];
  }
  getLanguageSignatureCharacters() {
    return ['('];
  }
}

