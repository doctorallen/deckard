// A vscode API surface just large enough to run Deckard's panels, sidebar,
// and editor features for real.
const Module = require('node:module');

/** VS Code's event emitter: `event` subscribes a handler, `fire` calls each one. */
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

/**
 * A range from two positions or four numbers, as VS Code's is made, with
 * its start before its end; nothing else of its API.
 */
class Range {
  constructor(startOrLine, endOrCharacter, endLine, endCharacter) {
    const numbers = typeof startOrLine === 'number';
    const first = numbers ? new Position(startOrLine, endOrCharacter) : startOrLine;
    const second = numbers ? new Position(endLine, endCharacter) : endOrCharacter;
    const reversed =
      second.line < first.line || (second.line === first.line && second.character < first.character);
    this.start = reversed ? second : first;
    this.end = reversed ? first : second;
  }
}

/**
 * An edit across notes, as VS Code's is made: replacements kept per note,
 * and `entries` to read them back; `replaces` (also `replacements`) holds
 * each one in order.
 * Nothing applies it here.
 */
class WorkspaceEdit {
  constructor() {
    this.edits = new Map();
    this.replaces = [];
    this.replacements = this.replaces;
  }

  replace(uri, range, newText) {
    const key = uri.toString();
    const entry = this.edits.get(key) ?? [uri, []];
    entry[1].push({ range, newText });
    this.edits.set(key, entry);
    this.replaces.push({ uri, range, newText });
  }

  entries() {
    return [...this.edits.values()];
  }
}

/** A line and a character, as VS Code's position holds them. */
class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

/**
 * A selection, made from an anchor and an active position, or from their
 * four numbers, as VS Code's is.
 */
class Selection {
  constructor(anchorOrLine, activeOrCharacter, activeLine, activeCharacter) {
    const numbers = typeof anchorOrLine === 'number';
    this.anchor = numbers ? new Position(anchorOrLine, activeOrCharacter) : anchorOrLine;
    this.active = numbers ? new Position(activeLine, activeCharacter) : activeOrCharacter;
    const reversed =
      this.active.line < this.anchor.line ||
      (this.active.line === this.anchor.line && this.active.character < this.anchor.character);
    this.start = reversed ? this.active : this.anchor;
    this.end = reversed ? this.anchor : this.active;
  }
}

/** A link a document link provider returns: a range and where it goes. */
class DocumentLink {
  constructor(range, target) {
    this.range = range;
    this.target = target;
  }
}

/** Markdown text, held as its value. */
class MarkdownString {
  constructor(value = '') {
    this.value = value;
  }
}

/** A theme color, held as its id. */
class ThemeColor {
  constructor(id) {
    this.id = id;
  }
}

/**
 * A page's bundle and style sheets under dist/webview get the URI the page
 * loader reads back from the build (test/harness/loadPage.js), as the mocha
 * suites' stand-in webview gives them (src/test/pageWebview.ts). Anything
 * else keeps the URI it was given, which loads nothing here.
 */
function asWebviewUri(uri) {
  const bundle = /(?:^|\/)(dist\/webview\/.+)$/.exec(String(uri.fsPath ?? uri.path ?? ''));
  if (!bundle) {
    return uri;
  }
  const address = `vscode-webview://deckard/${bundle[1]}`;
  return { scheme: 'vscode-webview', fsPath: address, path: address, toString: () => address };
}

// Editor events a test can fire through _test.emitters.
const selectionEmitter = new EventEmitter();
const activeEditorEmitter = new EventEmitter();
const visibleEditorsEmitter = new EventEmitter();
const textDocumentEmitter = new EventEmitter();

/** Every panel the host has created, oldest first, for a test to find its page. */
const createdPanels = [];

/**
 * A webview panel, as the host creates one. A harness mounts the host's page
 * against it (test/e2e/support.js) through a handshake of three fields:
 *
 * - `_toWebview` holds every message the host posted, whether or not a page
 *   was mounted to receive it.
 * - `_deliver`, which the harness sets when it mounts the page, is called
 *   with each message the host posts from then on and dispatches it to the
 *   page's window.
 * - `_onWebviewMessage` is what the page's `postMessage` calls; it fires the
 *   panel's `onDidReceiveMessage`, so the host's handler runs.
 *
 * `_onHtml`, when a test sets it, is called with each page the host writes,
 * and `_setVisible` hides or shows the panel as switching editor tabs does.
 */
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
      asWebviewUri,
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
      asWebviewUri,
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

const shown = { info: [], warning: [], error: [] };
let informationResponse;
let inputBoxResponse;

/**
 * Settings a test sets or the extension writes, by their full name, such as
 * `deckard.theme`: the user's in `settings`, and the workspace's and the
 * folder's in `workspaceSettings` and `workspaceFolderSettings`, each a map
 * by full name. There is one set for the whole process, so a setting a
 * suite writes holds for every later test in its process, and
 * test/e2e/run.js runs each suite in a process of its own.
 */
const settings = new Map();
const workspaceSettings = new Map();
const workspaceFolderSettings = new Map();
/** Every setting the extension wrote, with its name, value, and target, in order. */
const configurationUpdates = [];
/** Every command the extension ran, with its arguments, in order. */
const executedCommands = [];
const configurationEmitter = new EventEmitter();

/**
 * The level an update writes to, as VS Code reads its target: `true` or
 * Global is the user's, Workspace, `false`, or none is the workspace's, and
 * WorkspaceFolder is the folder's.
 */
function levelOf(target) {
  if (target === true || target === 1) {
    return settings;
  }
  return target === 3 ? workspaceFolderSettings : workspaceSettings;
}

/**
 * The settings under a section, read from and written to the process-wide
 * levels. A read takes the folder's value, else the workspace's, else the
 * user's, and a setting no level holds reads as the fallback the caller
 * gives, never as the manifest's default. `inspect` reports each level's
 * value apart, so a test can set a workspace's and see where Deckard
 * writes. An update writes its target's level, or takes the setting out of
 * it when the value is undefined, is recorded in
 * `_test.configurationUpdates`, and fires `onDidChangeConfiguration` for
 * that name and every section above it.
 */
function getConfiguration(section) {
  const fullName = (key) => (section ? `${section}.${key}` : key);
  const levels = [workspaceFolderSettings, workspaceSettings, settings];
  return {
    get: (key, fallback) => {
      const level = levels.find((each) => each.has(fullName(key)));
      return level ? level.get(fullName(key)) : fallback;
    },
    inspect: (key) => ({
      key: fullName(key),
      globalValue: settings.get(fullName(key)),
      workspaceValue: workspaceSettings.get(fullName(key)),
      workspaceFolderValue: workspaceFolderSettings.get(fullName(key)),
    }),
    update: (key, value, target) => {
      const name = fullName(key);
      if (value === undefined) {
        levelOf(target).delete(name);
      } else {
        levelOf(target).set(name, value);
      }
      configurationUpdates.push({ name, value, target });
      configurationEmitter.fire({
        affectsConfiguration: (changed) => name === changed || name.startsWith(`${changed}.`),
      });
      return Promise.resolve();
    },
  };
}

/** The path of this stub, which `require('vscode')` loads once it is installed. */
const STUB = __filename;
/**
 * A file URI for a path: its path and file are the value as given, and
 * `with` gives the file URI at another path, as VS Code's does.
 */
function fileUri(value) {
  return {
    scheme: 'file',
    fsPath: value,
    path: value,
    toString: () => `file://${value}`,
    with: (change) => fileUri(change.path ?? value),
  };
}

/** Whether install() has already put the hook in place. */
let installed = false;

/**
 * Makes `require('vscode')` load this stub from then on, for a harness that
 * runs the compiled sources outside VS Code, where the real module does not
 * exist. Installing it again changes nothing.
 */
function install() {
  if (installed) {
    return;
  }
  installed = true;
  const resolveFilename = Module._resolveFilename;
  Module._resolveFilename = function patched(request, ...rest) {
    if (request === 'vscode') {
      return STUB;
    }
    return resolveFilename.call(this, request, ...rest);
  };
}

module.exports = {
  install,
  EventEmitter,
  Range,
  Position,
  Selection,
  WorkspaceEdit,
  DocumentLink,
  MarkdownString,
  ThemeColor,
  Uri: {
    /**
     * A path joined to a base. The path is joined to the base's path, as VS
     * Code's is; the fsPath is joined as it always was here.
     */
    joinPath: (base, ...parts) => ({
      fsPath: [base, ...parts].join('/'),
      path: [base && typeof base === 'object' ? base.path ?? base.fsPath : base, ...parts].join('/'),
    }),
    /** A URI whose path and text are the value as given, with no scheme. */
    parse: (value) => ({ fsPath: value, path: value, toString: () => value }),
    /** A file URI for a path, which a page builder joins onto with `with`. */
    file: fileUri,
  },
  ViewColumn: { Active: -1, Beside: -2, One: 1 },
  EndOfLine: { LF: 1, CRLF: 2 },
  QuickPickItemKind: { Separator: -1, Default: 0 },
  TextEditorRevealType: { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 },
  window: {
    createWebviewPanel,
    /**
     * Records the message in `_test.shown.info` and answers with the button a
     * test picked through `_test.setInformationResponse`, once.
     */
    showInformationMessage: (message) => {
      shown.info.push(message);
      const response = informationResponse;
      informationResponse = undefined;
      return Promise.resolve(response);
    },
    /** Records the message in `_test.shown.warning`; the reader picks nothing. */
    showWarningMessage: (message) => {
      shown.warning.push(message);
      return Promise.resolve(undefined);
    },
    /**
     * Records the message in `_test.shown.error`; the reader picks nothing.
     * Failures go through reportFailure, which says them as errors.
     */
    showErrorMessage: (message) => {
      shown.error.push(message);
      return Promise.resolve(undefined);
    },
    /** Answers with what a test set through `_test.setInputBoxResponse`, every time. */
    showInputBox: () => Promise.resolve(inputBoxResponse),
    /** The reader dismisses every quick pick. */
    showQuickPick: () => Promise.resolve(undefined),
    onDidChangeWindowState: new EventEmitter().event,
    onDidChangeActiveTextEditor: activeEditorEmitter.event,
    onDidChangeTextEditorSelection: selectionEmitter.event,
    onDidChangeVisibleTextEditors: visibleEditorsEmitter.event,
    activeTextEditor: undefined,
    /** Registers nothing; a test makes the view with `_test.createWebviewView`. */
    registerWebviewViewProvider: () => ({ dispose: () => undefined }),
    /** A channel whose lines go nowhere. */
    createOutputChannel: () => ({
      appendLine: () => undefined,
      dispose: () => undefined,
    }),
    /** A decoration type that draws nothing. */
    createTextEditorDecorationType: () => ({ dispose: () => undefined }),
    visibleTextEditors: [],
  },
  languages: {
    /** Registers nothing; no e2e suite follows a document link. */
    registerDocumentLinkProvider: () => ({ dispose: () => undefined }),
  },
  workspace: {
    getConfiguration,
    onDidChangeConfiguration: configurationEmitter.event,
    onDidChangeTextDocument: textDocumentEmitter.event,
    onDidSaveTextDocument: new EventEmitter().event,
    onDidOpenTextDocument: new EventEmitter().event,
    onDidCloseTextDocument: new EventEmitter().event,
    workspaceFolders: [],
    textDocuments: [],
    /** The value as text, since there is no workspace folder to be relative to. */
    asRelativePath: (value) => String(value),
  },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  env: { language: 'en' },
  InputBoxValidationSeverity: { Info: 1, Warning: 2, Error: 3 },
  commands: {
    /** Registers nothing; no e2e suite runs a command by its id. */
    registerCommand: () => ({ dispose: () => undefined }),
    /**
     * Records the command and its arguments in `_test.executedCommands` and
     * runs nothing. Host code sets context keys through this, and a test
     * reads what it set.
     */
    executeCommand: (command, ...args) => {
      executedCommands.push({ command, args });
      return Promise.resolve(undefined);
    },
  },
  _test: {
    createdPanels,
    settings,
    workspaceSettings,
    workspaceFolderSettings,
    configurationUpdates,
    executedCommands,
    createWebviewView,
    shown,
    emitters: {
      selection: selectionEmitter,
      activeEditor: activeEditorEmitter,
      visibleEditors: visibleEditorsEmitter,
      textDocument: textDocumentEmitter,
    },
    /** Sets what every input box answers from now on. */
    setInputBoxResponse: (value) => {
      inputBoxResponse = value;
    },
    /** Sets the button the next information message is answered with. */
    setInformationResponse: (value) => {
      informationResponse = value;
    },
  },
};
