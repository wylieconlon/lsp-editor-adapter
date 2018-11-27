import { LSPConnection } from '../src'
import sinon from 'sinon';

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
  dispatchEvent = ((event: Event) => {
    let listeners = this.listeners[event.type];
    if (!listeners) {
      return false;
    }
    listeners.forEach((listener) => listener.call(null, event));
  })

  sendInitialize = sinon.mock()
  sendChange = sinon.mock()
  getHoverTooltip = sinon.mock()
  getCompletion = sinon.mock()
  getDetailedCompletion = sinon.mock()
  getSignatureHelp = sinon.mock()
  getDocumentHighlights = sinon.mock()

  getLanguageCompletionCharacters() {
    return ['.', ','];
  }
  getLanguageSignatureCharacters() {
    return ['('];
  }
}

