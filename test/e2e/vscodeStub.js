// A vscode API surface just large enough to run Deckard's panels, sidebar,
// and editor features for real.
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

class Range {
  constructor(startLine, startCharacter, endLine, endCharacter) {
    this.start = { line: startLine, character: startCharacter };
    this.end = { line: endLine, character: endCharacter };
  }
}

class DocumentLink {
  constructor(range, target) {
    this.range = range;
    this.target = target;
  }
}

class MarkdownString {
  constructor(value = '') {
    this.value = value;
  }
}

class ThemeColor {
  constructor(id) {
    this.id = id;
  }
}

// Editor events a test can fire through _test.emitters.
const selectionEmitter = new EventEmitter();
const activeEditorEmitter = new EventEmitter();
const visibleEditorsEmitter = new EventEmitter();
const textDocumentEmitter = new EventEmitter();

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
    // Hides or shows the panel, as switching editor tabs does.
    _setVisible: (visible) => {
      panel.visible = visible;
      panel.active = visible;
      viewStateEmitter.fire({ webviewPanel: panel });
    },
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
      panel.visible = true;
      viewStateEmitter.fire({ webviewPanel: panel });
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
    // Hides or shows the view, as collapsing its side bar does.
    _setVisible: (visible) => {
      view.visible = visible;
      visibilityEmitter.fire();
    },
  };
  return view;
}

const shown = { info: [], warning: [] };
let inputBoxResponse;

module.exports = {
  EventEmitter,
  Range,
  DocumentLink,
  MarkdownString,
  ThemeColor,
  Uri: {
    joinPath: (...parts) => ({ fsPath: parts.join('/') }),
    parse: (value) => ({ fsPath: value, path: value, toString: () => value }),
    file: (value) => ({ fsPath: value, path: value, toString: () => `file://${value}` }),
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
    onDidChangeWindowState: new EventEmitter().event,
    onDidChangeActiveTextEditor: activeEditorEmitter.event,
    onDidChangeTextEditorSelection: selectionEmitter.event,
    onDidChangeVisibleTextEditors: visibleEditorsEmitter.event,
    activeTextEditor: undefined,
    registerWebviewViewProvider: () => ({ dispose: () => undefined }),
    createOutputChannel: () => ({
      appendLine: () => undefined,
      dispose: () => undefined,
    }),
    createTextEditorDecorationType: () => ({ dispose: () => undefined }),
    visibleTextEditors: [],
  },
  languages: {
    registerDocumentLinkProvider: () => ({ dispose: () => undefined }),
  },
  workspace: {
    getConfiguration: () => ({ get: (_key, fallback) => fallback }),
    onDidChangeConfiguration: new EventEmitter().event,
    onDidChangeTextDocument: textDocumentEmitter.event,
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
    emitters: {
      selection: selectionEmitter,
      activeEditor: activeEditorEmitter,
      visibleEditors: visibleEditorsEmitter,
      textDocument: textDocumentEmitter,
    },
    setInputBoxResponse: (value) => {
      inputBoxResponse = value;
    },
  },
};
