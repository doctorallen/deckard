// A vscode API surface just large enough to run the overview panel for real.
class EventEmitter {
  constructor() {
    this.handlers = [];
    this.event = (handler) => {
      this.handlers.push(handler);
      return { dispose: () => {
        this.handlers = this.handlers.filter((h) => h !== handler);
      } };
    };
  }
  fire(value) {
    [...this.handlers].forEach((handler) => handler(value));
  }
  dispose() {
    this.handlers = [];
  }
}

const createdPanels = [];

function createWebviewPanel(viewType, title, column, options) {
  const messageEmitter = new EventEmitter();
  const disposeEmitter = new EventEmitter();
  const viewStateEmitter = new EventEmitter();
  const panel = {
    viewType,
    title,
    active: true,
    visible: true,
    iconPath: undefined,
    options,
    // Messages the host sends to the webview.
    _toWebview: [],
    // Set by the harness so the script can post back.
    _onWebviewMessage: (message) => messageEmitter.fire(message),
    webview: {
      cspSource: 'vscode-webview://deckard',
      options: {},
      _html: '',
      get html() {
        return this._html;
      },
      set html(value) {
        this._html = value;
        if (panel._onHtml) {
          panel._onHtml(value);
        }
      },
      postMessage: (message) => {
        panel._toWebview.push(message);
        if (panel._deliver) {
          panel._deliver(message);
        }
        return Promise.resolve(true);
      },
      onDidReceiveMessage: messageEmitter.event,
      asWebviewUri: (uri) => uri,
    },
    reveal: () => {
      panel.active = true;
      viewStateEmitter.fire({});
    },
    dispose: () => {
      panel.disposed = true;
      disposeEmitter.fire();
    },
    onDidDispose: disposeEmitter.event,
    onDidChangeViewState: viewStateEmitter.event,
  };
  createdPanels.push(panel);
  return panel;
}

/** A webview view, as the Related Notes sidebar is given one. */
function createWebviewView() {
  const disposeEmitter = new EventEmitter();
  const visibilityEmitter = new EventEmitter();
  const messageEmitter = new EventEmitter();
  const view = {
    visible: true,
    title: undefined,
    description: undefined,
    // Everything the host has pushed to this view.
    posted: [],
    webview: {
      cspSource: 'vscode-webview://deckard',
      options: {},
      html: '',
      postMessage: (message) => {
        view.posted.push(message);
        if (view._deliver) {
          view._deliver(message);
        }
        return Promise.resolve(true);
      },
      onDidReceiveMessage: messageEmitter.event,
      asWebviewUri: (uri) => uri,
    },
    show: () => undefined,
    onDidDispose: disposeEmitter.event,
    onDidChangeVisibility: visibilityEmitter.event,
    _fromWebview: (message) => messageEmitter.fire(message),
  };
  return view;
}

const shown = { info: [], warning: [] };
let inputBoxResponse;

module.exports = {
  EventEmitter,
  Uri: {
    joinPath: (...parts) => ({ fsPath: parts.join('/') }),
    parse: (value) => ({ fsPath: value, toString: () => value }),
    file: (value) => ({ fsPath: value }),
  },
  ViewColumn: { Active: -1, One: 1 },
  window: {
    createWebviewPanel,
    showInformationMessage: (message) => {
      shown.info.push(message);
      return Promise.resolve(undefined);
    },
    showWarningMessage: (message) => {
      shown.warning.push(message);
      return Promise.resolve(undefined);
    },
    showInputBox: () => Promise.resolve(inputBoxResponse),
    showQuickPick: () => Promise.resolve(undefined),
    onDidChangeActiveTextEditor: new EventEmitter().event,
    onDidChangeTextEditorSelection: new EventEmitter().event,
    onDidChangeVisibleTextEditors: new EventEmitter().event,
    activeTextEditor: undefined,
    registerWebviewViewProvider: () => ({ dispose: () => undefined }),
    createOutputChannel: () => ({
      appendLine: () => undefined,
      dispose: () => undefined,
    }),
    visibleTextEditors: [],
  },
  workspace: {
    getConfiguration: () => ({ get: (_key, fallback) => fallback }),
    onDidChangeConfiguration: new EventEmitter().event,
    onDidChangeTextDocument: new EventEmitter().event,
    onDidSaveTextDocument: new EventEmitter().event,
    onDidOpenTextDocument: new EventEmitter().event,
    onDidCloseTextDocument: new EventEmitter().event,
    workspaceFolders: [],
    textDocuments: [],
    asRelativePath: (value) => String(value),
  },
  commands: { registerCommand: () => ({ dispose: () => undefined }) },
  _test: {
    createdPanels,
    createWebviewView,
    shown,
    setInputBoxResponse: (value) => {
      inputBoxResponse = value;
    },
  },
};
