import sinon from 'sinon';
import { ILspConnection } from '../src';

interface IListeners {
  [key: string]: Array<(arg: any) => void>;
}

// There is a library that can be used to mock WebSockets, but the API surface tested here is small
// enough that it is not necessary to use the library. This mock is a simple EventEmitter
export class MockConnection implements ILspConnection {
  public listeners: IListeners = {};

  /**
   * Sends a synthetic event to the client code, for example to imitate a server response
   */
  public dispatchEvent = ((event: MessageEvent) => {
    const listeners = this.listeners[event.type];
    if (!listeners) {
      return false;
    }
    listeners.forEach((listener) => listener.call(null, event.data));
  });

  public sendInitialize = sinon.stub();
  public sendChange = sinon.stub();
  public getHoverTooltip = sinon.stub();
  public getCompletion = sinon.stub();
  public getDetailedCompletion = sinon.stub();
  public getSignatureHelp = sinon.stub();
  public getDocumentHighlights = sinon.stub();

  constructor() {}

  public on(type: string, listener: (arg: any) => void) {
    const listeners = this.listeners[type];
    if (!listeners) { this.listeners[type] = []; }
    this.listeners[type].push(listener);
  }

  public getLanguageCompletionCharacters() {
    return ['.', ','];
  }
  public getLanguageSignatureCharacters() {
    return ['('];
  }
}
