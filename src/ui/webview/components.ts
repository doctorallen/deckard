/**
 * Shared building blocks for every Deckard webview.
 *
 * Each page's script is still a template the host writes into its HTML, so
 * what the scripts have in common has to be shared as text rather than as
 * modules the browser can import. This file is that shared layer: one script
 * of the helpers the page scripts all need, and the pieces of HTML the host
 * builds. The style sheets are files under src/webview, which esbuild builds
 * into dist/webview and every page links (host/pageShell.ts).
 *
 * A page keeps only the styles and behavior that are genuinely its own.
 * Changing a component here changes it everywhere.
 */

import * as vscode from 'vscode';
import { helpIcon, ICON_PATHS, settingsIcon, strokeIcon } from './icons';
import {
  DeckardTheme,
  deckardThemeCss,
  deckardThemeNames,
  getDeckardTheme,
} from './themes';
import type { ThemePreview } from './themePreview';
import { ENABLED } from './selectors';
import { escapeHtml } from '../../shared/html';
export { ENABLED };

/**
 * What a page shows before its first state arrives: `#app`, busy, holding
 * one `.loading` line. `attributes` adds any the page's main carries.
 */
export function loadingHtml(label: string, attributes = ''): string {
  return `<main id="app"${attributes ? ` ${attributes}` : ''} aria-busy="true"><div class="loading" role="status"><span>${label}</span></div></main>`;
}

/**
 * An icon-only button for HTML the host builds, the twin of the page
 * script's renderIconButton: its label is its name and its tip, and it never
 * carries title, which no keyboard ever saw.
 */
export function iconButtonHtml(options: {
  id?: string;
  action?: string;
  label: string;
  icon: string;
  tip?: string;
  key?: string;
  className?: string;
}): string {
  return `<button type="button" class="icon-button${options.className ? ` ${options.className}` : ''}"`
    + (options.id ? ` id="${escapeHtml(options.id)}"` : '')
    + (options.action ? ` data-action="${escapeHtml(options.action)}"` : '')
    + ` aria-label="${escapeHtml(options.label)}" data-tip="${escapeHtml(options.tip ?? options.label)}"`
    + (options.key ? ` data-tip-key="${escapeHtml(options.key)}"` : '')
    + `>${options.icon}</button>`;
}

/** What a page lays over its own rules, and how its body is marked. */
export interface PageTail {
  /**
   * The sheets a page links after its own, under dist/webview, in cascade
   * order: its theme, then the tail (src/webview/shared/tail.css), which
   * holds control edges, provenance, high contrast, card tags, and zen.
   */
  readonly sheets: readonly string[];
  /** The marker the zen sheet hangs on, ` class="zen"`, or nothing. */
  readonly bodyAttribute: string;
}

/**
 * What every page puts after its own rules: the theme, then the tail, which
 * ends with zen. Kept in one place so "zen comes after the theme" is a fact
 * in the code rather than a convention ten pages have to remember. `theme`
 * is the one the page's host read, preview and all, and `zen` whether zen
 * mode is on; neither is read from the settings here.
 */
export function getPageTailCss(chrome: { theme: DeckardTheme; zen: boolean }): PageTail {
  return {
    sheets: [deckardThemeCss[chrome.theme], 'tail.css'],
    bodyAttribute: chrome.zen ? ' class="zen"' : '',
  };
}

/** Whether a settings change alters how a page is drawn rather than what it says. */
export function affectsPageChrome(event: vscode.ConfigurationChangeEvent): boolean {
  return (
    event.affectsConfiguration('deckard.theme') ||
    event.affectsConfiguration('deckard.zenMode')
  );
}

/**
 * Calls back when a page has to be drawn again in another look: the theme or
 * zen setting changed, or Choose Theme… is previewing a theme on
 * `themePreview`. A page that redraws on this needs no configuration
 * listener of its own for it.
 */
export function onDidChangePageChrome(
  listener: () => void,
  themePreview: Pick<ThemePreview, 'onDidChange'>,
): vscode.Disposable {
  const configuration = vscode.workspace.onDidChangeConfiguration((event) => {
    if (affectsPageChrome(event)) {
      listener();
    }
  });
  const preview = themePreview.onDidChange(listener);
  return { dispose: () => { configuration.dispose(); preview.dispose(); } };
}

/**
 * The shared tip, on its own so a page that does not take the whole
 * component script, the Notes Graph, can take this. Included by
 * getComponentScript().
 */
export function getTipScript(): string {
  return `
  /**
   * Tips: the longer explanation a control carries, shown on keyboard focus
   * as well as under the pointer. A native title never shows on focus, so a
   * keyboard reader never saw one; and it could not be dismissed or hovered.
   *
   *   data-tip           what the control does
   *   data-tip-key       the key that does the same, drawn as <kbd>
   *   data-tip-disabled  why it cannot act, used while aria-disabled="true"
   *   data-tip-overflow  the whole of a tag or chip, shown only when cut short
   *
   * A keyboard focus shows the tip at once; the pointer after 400 ms, or at
   * once within 300 ms of another tip closing, so a run along a toolbar does
   * not wait at every button. Touch never shows one. Escape hides it, and is
   * taken only while a tip shows, so it does not also close a menu behind it.
   */
  const TIP_SELECTOR = '[data-tip], [data-tip-overflow], [data-tip-disabled]';
  let tipElement;
  let tipTarget;
  let tipShowTimer;
  let tipHideTimer;
  let tipLastHidden = 0;
  let keyboardModality = false;

  /** Whether a tag's or a chip's text is cut short where it is drawn. */
  function isTruncated(element) {
    return Array.prototype.some.call(element.querySelectorAll('.tag-namespace-text, .tag-value, .query-chip-label'), function (part) {
      return part.scrollWidth > part.clientWidth;
    });
  }

  /** What a tip says for an element now, or nothing. */
  function tipTextFor(element) {
    if (!element || !element.getAttribute) return '';
    const disabled = element.getAttribute('aria-disabled') === 'true' ? element.getAttribute('data-tip-disabled') : null;
    if (disabled) return disabled;
    const tip = element.getAttribute('data-tip') || '';
    const overflow = element.getAttribute('data-tip-overflow');
    // A chip's own tip already names its whole term; a tag's tip is the tag.
    if (overflow && isTruncated(element)) return tip || overflow;
    return tip;
  }

  function accessibleNameOf(element) {
    return String(element.getAttribute('aria-label') || element.textContent || '').trim();
  }

  function hideTip() {
    clearTimeout(tipShowTimer);
    clearTimeout(tipHideTimer);
    tipShowTimer = undefined;
    tipHideTimer = undefined;
    if (!tipTarget) return;
    const described = String(tipTarget.getAttribute('aria-describedby') || '').split(/\\s+/).filter(function (id) { return id && id !== 'deckard-tip'; });
    if (described.length) tipTarget.setAttribute('aria-describedby', described.join(' '));
    else tipTarget.removeAttribute('aria-describedby');
    tipTarget = undefined;
    if (tipElement) tipElement.hidden = true;
    tipLastHidden = Date.now();
  }

  function showTip(element) {
    clearTimeout(tipShowTimer);
    clearTimeout(tipHideTimer);
    tipShowTimer = undefined;
    const text = tipTextFor(element);
    if (!text || !document.contains(element)) {
      if (tipTarget === element) hideTip();
      return;
    }
    if (tipTarget && tipTarget !== element) hideTip();
    if (!tipElement) {
      tipElement = document.createElement('div');
      tipElement.id = 'deckard-tip';
      tipElement.className = 'popover is-tip';
      tipElement.setAttribute('role', 'tooltip');
      tipElement.hidden = true;
      document.body.appendChild(tipElement);
    }
    const key = element.getAttribute('aria-disabled') === 'true' ? '' : element.getAttribute('data-tip-key');
    tipElement.textContent = text;
    if (key) {
      const kbd = document.createElement('kbd');
      kbd.textContent = key;
      tipElement.appendChild(document.createTextNode(' '));
      tipElement.appendChild(kbd);
    }
    tipElement.hidden = false;
    tipTarget = element;
    // The tip is the name already on an icon button; said twice, it is noise.
    if (text !== accessibleNameOf(element)) {
      const described = String(element.getAttribute('aria-describedby') || '').split(/\\s+/).filter(Boolean);
      if (described.indexOf('deckard-tip') < 0) described.push('deckard-tip');
      element.setAttribute('aria-describedby', described.join(' '));
    }
    const at = element.getBoundingClientRect();
    const size = tipElement.getBoundingClientRect();
    const width = window.innerWidth || document.documentElement.clientWidth || 0;
    const height = window.innerHeight || document.documentElement.clientHeight || 0;
    let top = at.bottom + 6;
    if (height && top + size.height > height - 8) top = at.top - 6 - size.height;
    const left = at.left + at.width / 2 - size.width / 2;
    tipElement.style.left = Math.max(8, width ? Math.min(left, width - size.width - 8) : left) + 'px';
    tipElement.style.top = Math.max(8, top) + 'px';
  }

  function tipOwner(target) {
    const element = target && target.closest ? target.closest(TIP_SELECTOR) : null;
    return element && tipTextFor(element) ? element : null;
  }

  document.addEventListener('keydown', function () { keyboardModality = true; }, true);
  document.addEventListener('pointerdown', function () {
    keyboardModality = false;
    hideTip();
  }, true);
  document.addEventListener('mousedown', function () { keyboardModality = false; }, true);
  // Escape puts the tip away first, and only the tip.
  window.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' || !tipTarget) return;
    event.preventDefault();
    event.stopPropagation();
    hideTip();
  }, true);
  document.addEventListener('focusin', function (event) {
    const target = event.target;
    if (!keyboardModality || !target || !target.matches || !target.matches(TIP_SELECTOR)) return;
    showTip(target);
  });
  document.addEventListener('focusout', function (event) {
    if (tipTarget && event.target === tipTarget) hideTip();
  });
  document.addEventListener('pointerover', function (event) {
    if (event.pointerType === 'touch') return;
    if (tipElement && tipElement.contains(event.target)) {
      clearTimeout(tipHideTimer);
      return;
    }
    const owner = tipOwner(event.target);
    if (!owner || owner === tipTarget) {
      if (owner) clearTimeout(tipHideTimer);
      return;
    }
    clearTimeout(tipShowTimer);
    const warm = Boolean(tipTarget) || Date.now() - tipLastHidden < 300;
    tipShowTimer = setTimeout(function () { showTip(owner); }, warm ? 0 : 400);
  });
  document.addEventListener('pointerout', function (event) {
    const next = event.relatedTarget;
    const fromTip = tipElement && tipElement.contains(event.target);
    const owner = fromTip ? tipTarget : tipOwner(event.target);
    if (!owner || (next && (owner.contains(next) || (tipElement && tipElement.contains(next))))) return;
    if (owner !== tipTarget) {
      clearTimeout(tipShowTimer);
      return;
    }
    clearTimeout(tipHideTimer);
    tipHideTimer = setTimeout(hideTip, 100);
  });
  window.addEventListener('scroll', function () { if (tipTarget) hideTip(); }, true);
  // A redraw that took the control away takes its tip with it.
  if (typeof MutationObserver === 'function') {
    new MutationObserver(function () {
      if (tipTarget && !document.contains(tipTarget)) hideTip();
    }).observe(document.body || document.documentElement, { childList: true, subtree: true });
  }
`;
}

/**
 * Undo, briefly: what a removal that can be put back offers instead of
 * asking first. On its own so the Notes Graph, which does not take the whole
 * component script, can take it too; getComponentScript() includes it.
 */
export function getUndoScript(): string {
  return `
  /**
   * "Removed Tasks view. Undo": a status line with its Undo button, which
   * posts nothing itself; its data-action is the page's to handle.
   */
  function renderUndoNotice(message, action, buttonClass) {
    const escape = function (value) {
      return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    };
    return '<span class="undo-notice" role="status">' + escape(message) + ' <button type="button"' + (buttonClass ? ' class="' + escape(buttonClass) + '"' : '') + ' data-action="' + escape(action) + '">Undo</button></span>';
  }

  /**
   * One offer of Undo at a time, withdrawn after 8 seconds or by the next
   * removal. show(message, action, payload) makes the offer; take() hands
   * back its payload and withdraws it. The offer is drawn in its own toast
   * outside #app, so a page's redraw does not take it away, and it is seen
   * wherever the removal was made. render redraws the page after a change.
   */
  function createUndoNotice(render) {
    let current;
    let timer;
    const draw = function () {
      let host = document.getElementById('undo-toast');
      if (!host) {
        host = document.createElement('div');
        host.id = 'undo-toast';
        host.className = 'undo-toast';
        document.body.appendChild(host);
      }
      host.innerHTML = current ? renderUndoNotice(current.message, current.action) : '';
    };
    return {
      show: function (message, action, payload) {
        clearTimeout(timer);
        current = { message: message, action: action, payload: payload };
        timer = setTimeout(function () {
          current = undefined;
          draw();
        }, 8000);
        render();
        draw();
        // Enter takes it back: focus moves to Undo.
        const button = document.querySelector('.undo-notice [data-action="' + action + '"]');
        if (button) button.focus();
      },
      take: function () {
        clearTimeout(timer);
        const payload = current ? current.payload : undefined;
        current = undefined;
        draw();
        return payload;
      },
      clear: function () {
        clearTimeout(timer);
        current = undefined;
        draw();
      },
    };
  }
`;
}

/**
 * Helpers every page script needs.
 *
 * This is inserted inside each page's own `<script>`, so the functions are
 * ordinary declarations in that scope rather than module exports.
 *
 * Note for editors: this string is interpolated into a template literal, so a
 * backslash meant for the output has to be written doubled here.
 *
 * `theme` is the one the gear names, as the page's host read it, preview and
 * all; without it, the configured theme.
 */
export function getComponentScript(theme: DeckardTheme = getDeckardTheme()): string {
  return `
  /**
   * Say one short thing to a screen reader.
   *
   * A page rebuilds itself wholesale on every snapshot, so the page body must
   * not be a live region: it would re-announce the whole page on each index
   * update and each keystroke. Pages announce what actually changed here
   * instead, into the small status node every page carries.
   */
  function announce(message) {
    const status = document.getElementById('live-status');
    if (!status) return;
    const text = String(message || '');
    // Repeating the same string is not announced again, so clear it first.
    if (status.textContent === text) status.textContent = '';
    status.textContent = text;
  }

  /**
   * Loading, drawn as the host's loadingHtml draws it. immediate shows it at
   * once, for a line that redraws on every tick, such as the sidebar's
   * indexing count, whose 400 ms wait would otherwise start over forever.
   */
  function renderLoading(label, immediate) {
    return '<div class="loading' + (immediate ? ' is-immediate' : '') + '" role="status"><span>' + escapeHtml(label) + '</span></div>';
  }

  /**
   * How far the first scan has got, in the words the sidebar and every
   * page use: "Indexing this workspace: 412 of 3,760 notes read…".
   */
  function describeIndexing(progress) {
    return progress && progress.total
      ? 'Indexing this workspace: ' + Number(progress.completed).toLocaleString('en-US') + ' of ' + Number(progress.total).toLocaleString('en-US') + ' notes read…'
      : 'Indexing this workspace…';
  }

  // A page waiting on the first scan says how far it has got, in its
  // loading line, as the host sends it; the page's first state replaces it.
  window.addEventListener('message', function (event) {
    if (!event.data || event.data.type !== 'indexing') return;
    const line = document.querySelector('#app .loading');
    if (!line) return;
    line.classList.add('is-immediate');
    const words = line.querySelector('span') || line;
    words.textContent = describeIndexing(event.data.progress);
  });

  /**
   * #app is busy exactly while it holds a .loading, or while a search it
   * ran is still out; pages do nothing about it. #live-status sits outside
   * #app, so what a page announces still goes through.
   */
  let searchInFlight = false;
  function syncBusy() {
    const app = document.getElementById('app');
    if (!app) return;
    if (searchInFlight || app.querySelector('.loading')) app.setAttribute('aria-busy', 'true');
    else app.removeAttribute('aria-busy');
  }
  if (typeof MutationObserver === 'function' && document.getElementById('app')) {
    new MutationObserver(syncBusy).observe(document.getElementById('app'), { childList: true, subtree: true });
  }

  /**
   * How many values a Refine facet shows before "+N more": the page's and
   * the sidebar's Refine both read it, so they cut at the same place.
   */
  const FACET_VISIBLE = 5;

  /**
   * The values of one facet a Refine shows, and the control that shows the
   * rest or fewer. expanded is the set of facet ids opened in this page.
   */
  function facetValuesShown(facet, expanded, className) {
    const all = facet.values || [];
    const open = expanded.has(facet.id);
    const values = open ? all : all.slice(0, FACET_VISIBLE);
    const hidden = all.length - FACET_VISIBLE;
    const more = hidden > 0
      ? '<button type="button" class="' + className + '" data-action="facet-more" data-facet-id="' + escapeHtml(facet.id) + '" aria-expanded="' + open + '" aria-label="' + escapeHtml(open ? 'Show fewer ' + facet.label + ' values' : 'Show ' + hidden + ' more ' + facet.label + ' values') + '">' + (open ? 'Show fewer' : '+' + hidden + ' more') + '</button>'
      : '';
    return { values: values, more: more };
  }

  /**
   * A control that holds its place with aria-disabled stays focusable, so
   * its click is stopped here, once, before any page listener hears it; no
   * page handler has to remember. Enter and Space on it raise the same click.
   */
  document.addEventListener('click', function (event) {
    const target = event.target && event.target.closest ? event.target.closest('[aria-disabled="true"]') : null;
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  /**
   * Redraw without losing the reader's place.
   *
   * Pages rebuild their HTML on every snapshot, which drops keyboard focus
   * to the page itself: tick a card's checkbox, or move it from its menu,
   * and the next Tab started again from the top. What had focus is found
   * again by what it is about (a task, a tag, a widget) and what it does;
   * failing that, the entry it was in; failing that, the entry that took
   * its place in the list, so completing a task leaves focus on the next.
   */
  const PLACE_KEYS = ['taskId', 'cardColumn', 'tagKey', 'widgetId', 'columnId', 'status', 'filePath', 'line', 'action', 'value', 'kind', 'section', 'date'];
  const PLACE_ITEMS = [['taskId', '[data-task-id]'], ['tagKey', '[data-tag-key]'], ['filePath', '[data-file-path]']];

  function placeSelector(element) {
    return PLACE_KEYS.filter(function (key) { return element.dataset[key] !== undefined; }).map(function (key) {
      return '[data-' + key.replace(/[A-Z]/g, function (letter) { return '-' + letter.toLowerCase(); }) + '="' + String(element.dataset[key]).replace(/["\\\\]/g, '\\\\$&') + '"]';
    }).join('');
  }

  function focusTarget(element) {
    if (!element) return null;
    if (element.matches('button, input, select, textarea, a[href], [tabindex]')) return element;
    return element.querySelector('[tabindex="0"], button, input, a[href]');
  }

  function readPlace() {
    const active = document.activeElement;
    if (!active || active === document.body || !active.matches || !active.dataset) return null;
    // A menu that is open keeps its own focus, and closes on a redraw.
    if (active.closest('[role="menu"]')) return null;
    const tag = active.tagName.toLowerCase();
    const selector = placeSelector(active);
    const place = { tag: tag, selector: selector, unique: Boolean(selector) && document.querySelectorAll(tag + selector).length === 1 };
    const itemKind = PLACE_ITEMS.find(function (kind) { return active.closest(kind[1]); });
    if (itemKind) {
      const item = active.closest(itemKind[1]);
      place.itemKind = itemKind[1];
      place.item = placeSelector(item);
      place.inItem = item !== active;
      place.index = Array.prototype.indexOf.call(document.querySelectorAll(itemKind[1]), item);
    }
    if (active.matches('input[type="text"], input[type="search"], textarea')) {
      place.selectionStart = active.selectionStart;
      place.selectionEnd = active.selectionEnd;
    }
    return place;
  }

  function isOnPage(element) {
    for (let node = element; node; node = node.parentElement) {
      if (node === document.body) return true;
      if (node.parentElement && Array.prototype.indexOf.call(node.parentElement.children, node) < 0) return false;
    }
    return false;
  }

  function restorePlace(place) {
    if (!place) return;
    const active = document.activeElement;
    // A redraw that already put focus somewhere, such as a field the page
    // restores itself, is left alone; focus on what the redraw removed is
    // focus lost.
    if (active && active !== document.body && isOnPage(active)) return;
    let target = null;
    const item = place.item ? document.querySelector(place.itemKind + place.item) : null;
    if (item && place.inItem && place.selector) target = item.querySelector(place.tag + place.selector);
    if (!target && item && !place.inItem) target = item;
    if (!target && place.unique) target = document.querySelector(place.tag + place.selector);
    if (!target && item) target = focusTarget(item);
    if (!target && place.itemKind && place.index >= 0) {
      const items = document.querySelectorAll(place.itemKind);
      if (items.length) target = focusTarget(items[Math.min(place.index, items.length - 1)]);
    }
    if (!target) return;
    target.focus({ preventScroll: true });
    if (place.selectionStart !== undefined && target.setSelectionRange && place.selectionStart !== null) {
      target.setSelectionRange(place.selectionStart, place.selectionEnd);
    }
  }

  function renderKeepingPlace(render) {
    const place = readPlace();
    render();
    restorePlace(place);
  }

  /**
   * The keys a page answers, on ?.
   *
   * A page's own keys, / to search, the arrows and single letters on the
   * board, the menu key, were written down nowhere a reader would look.
   * sections is a list of { title, keys: [[key, what it does]] }, or a
   * function that makes one; the keys every page shares are added last.
   */
  const SHARED_KEYS = { title: 'Everywhere', keys: [
    ['/', 'Go to the search box'],
    ['Shift+F10, or the menu key', 'Open the menu of what has focus'],
    ['Esc', 'Close a menu or this sheet'],
    ['?', 'Show these keys'],
  ] };
  let keySheet;
  let keySheetOpener;

  function closeKeySheet() {
    if (!keySheet) return;
    keySheet.remove();
    keySheet = undefined;
    if (keySheetOpener && keySheetOpener.focus) keySheetOpener.focus();
    keySheetOpener = undefined;
  }

  function openKeySheet(sections) {
    closeKeySheet();
    keySheetOpener = document.activeElement;
    keySheet = document.createElement('div');
    keySheet.setAttribute('class', 'key-sheet');
    keySheet.setAttribute('role', 'dialog');
    keySheet.setAttribute('aria-modal', 'true');
    keySheet.setAttribute('aria-labelledby', 'key-sheet-title');
    keySheet.innerHTML = '<div class="key-sheet-panel"><h2 id="key-sheet-title">Keys on this page</h2>'
      + sections.concat([SHARED_KEYS]).map(function (section) {
        return '<h3>' + escapeHtml(section.title) + '</h3><dl>' + section.keys.map(function (entry) {
          return '<div><dt><kbd>' + escapeHtml(entry[0]) + '</kbd></dt><dd>' + escapeHtml(entry[1]) + '</dd></div>';
        }).join('') + '</dl>';
      }).join('')
      + '<button type="button" data-action="close-key-sheet">Close</button></div>';
    document.body.appendChild(keySheet);
    keySheet.querySelector('[data-action="close-key-sheet"]').focus();
  }

  function installKeySheet(sections) {
    document.addEventListener('keydown', function (event) {
      if (keySheet && (event.key === 'Escape' || event.key === 'Tab')) {
        // The sheet holds one control, so Tab stays on it.
        event.preventDefault();
        if (event.key === 'Escape') closeKeySheet();
        return;
      }
      if (event.key !== '?' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      openKeySheet(typeof sections === 'function' ? sections() : sections);
    });
    document.addEventListener('click', function (event) {
      if (!keySheet) return;
      if (event.target.closest('[data-action="close-key-sheet"]') || !event.target.closest('.key-sheet-panel')) closeKeySheet();
    });
  }

  /**
   * How a click or key asks for a result: Cmd/Ctrl beside the page, a
   * double-click (the second click of it) keeping the tab.
   */
  function openingOf(event) {
    return {
      beside: Boolean(event && (event.metaKey || event.ctrlKey)),
      pin: Boolean(event && event.detail >= 2),
    };
  }

  /** An openSource message for an element's file and line, opened as asked. */
  function openSourceMessage(element, event) {
    const how = openingOf(event);
    return Object.assign({ type: 'openSource', filePath: element.dataset.filePath, line: Number(element.dataset.line) },
      how.beside ? { beside: true } : {}, how.pin ? { pin: true } : {});
  }

  /**
   * Marks the searched words where they appear in the results, so a reader
   * can tell at a glance why each one was found (Hearst, Search User
   * Interfaces, ch. 5). Only text is marked, never a tag or a control.
   * options.wordStart marks a word only where one starts, so "route" marks
   * "routes" but "art" does not mark "start".
   */
  function markWords(root, words, options) {
    const wanted = (words || []).map(function (word) { return String(word).toLowerCase(); }).filter(function (word) { return word.length >= 2; });
    if (!wanted.length || !root || !document.createTreeWalker) return;
    const wordStart = Boolean(options && options.wordStart);
    const pattern = new RegExp((wordStart ? '(?<![\\\\p{L}\\\\p{N}])' : '') + '(' + wanted.map(function (word) { return word.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&'); }).join('|') + ')', wordStart ? 'giu' : 'gi');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const found = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement && node.parentElement.closest('button, a, mark, [data-tag-key], .inline-tag, .tag-open, code')) continue;
      pattern.lastIndex = 0;
      if (pattern.test(node.nodeValue)) found.push(node);
    }
    found.forEach(function (node) {
      const span = document.createElement('span');
      span.innerHTML = escapeHtml(node.nodeValue).replace(pattern, '<mark>$1</mark>');
      node.replaceWith.apply(node, Array.prototype.slice.call(span.childNodes));
    });
  }

  // Escape puts away the file-and-line line an entry carries down under the
  // pointer, which could not be dismissed before (WCAG 1.4.13); it comes
  // back once the pointer or the focus moves on.
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && document.body) document.body.classList.add('provenance-dismissed');
  });
  ['pointermove', 'focusin'].forEach(function (type) {
    document.addEventListener(type, function () {
      if (document.body && document.body.classList.contains('provenance-dismissed')) document.body.classList.remove('provenance-dismissed');
    });
  });

  /**
   * Where the page was scrolled to, kept in the webview's own state and put
   * back when the page is drawn again, so coming back to a search, after
   * VS Code reopens it or the tab is shown again, lands where the reader
   * left it rather than at the top. Up to 40% of searches are re-finding
   * (Teevan et al., 2007), and position is how a list is re-found.
   */
  function rememberScroll(getSaved, setSaved) {
    let pending;
    window.addEventListener('scroll', function () {
      if (pending) return;
      pending = setTimeout(function () {
        pending = undefined;
        setSaved(Object.assign({}, getSaved() || {}, { scrollY: Math.round(window.scrollY) }));
      }, 200);
    }, { passive: true });
  }

  function restoreScroll(saved) {
    if (!saved || typeof saved.scrollY !== 'number' || !window.scrollTo) return;
    window.scrollTo(0, saved.scrollY);
  }

  /** A task's title as a sentence names it, from its row or card. */
  function taskTitleOf(element) {
    const row = element && element.closest ? element.closest('[data-task-id]') : null;
    const title = row ? row.querySelector('.task-title') : null;
    return title ? title.textContent.trim().replace(/\\s+/g, ' ') : 'the task';
  }

  /**
   * Where an entry is written, as its file's name and line: 2026-09-22 / line 7.
   * Every note in Deckard is Markdown, so the extension says nothing.
   */
  function formatSourceLocation(fileName, line) {
    return String(fileName).replace(/\\.md$/i, '') + ' / line ' + line;
  }

  /**
   * The headings above an entry, as the steps a reader would take to it:
   * "Harbor check-in > Actions". The first step goes when it says what the
   * file name says, since the line above names the file; the last goes when
   * it is the entry's own title, which the card shows already. A daily note
   * once read "2026-08-02 / line 14" and "2026-08-02 > … > Encrypt…" under
   * a card titled "Encrypt…".
   */
  function trimHeadingPath(path, fileName, ownTitle) {
    const plain = function (text) {
      return String(text || '').replace(/[#@][\\w/-]+/g, ' ').replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
    };
    const stem = plain(String(fileName || '').replace(/\\.md$/i, ''));
    const own = plain(ownTitle);
    let steps = (path || []).map(function (part) { return String(part).trim(); }).filter(Boolean);
    if (steps.length > 1 && plain(steps[0]) === stem) steps = steps.slice(1);
    if (steps.length && own && plain(steps[steps.length - 1]) === own) steps = steps.slice(0, -1);
    return steps;
  }

  /** The trimmed path as one line, each step escaped, joined by a chevron. */
  function renderHeadingPath(path, fileName, ownTitle) {
    return trimHeadingPath(path, fileName, ownTitle)
      .map(function (part) { return escapeHtml(part); })
      .join('<span class="heading-path-joiner"> &gt; </span>');
  }

  /** Escape snapshot data before it is inserted as HTML. */
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Render a tag so its namespace reads as a prefix of its value.
   *
   * Pass svg to emit tspans for a label inside an SVG node.
   */
  function renderTagLabel(label, svg) {
    const value = String(label);
    const match = value.match(/^([#@][^/]+\\/)(.*)$/);
    if (svg) {
      return match
        ? '<tspan class="tag-namespace">' + escapeHtml(match[1]) + '</tspan><tspan class="tag-value">' + escapeHtml(match[2]) + '</tspan>'
        : '<tspan class="tag-value">' + escapeHtml(value) + '</tspan>';
    }
    return match
      // The slash sits outside the part that shortens, so a namespace cut
      // short still reads as one: #pro…/atlas.
      ? '<span class="tag-label"><span class="tag-namespace"><span class="tag-namespace-text">' + escapeHtml(match[1].slice(0, -1)) + '</span>/</span><span class="tag-value">' + escapeHtml(match[2]) + '</span></span>'
      : '<span class="tag-label"><span class="tag-value">' + escapeHtml(value) + '</span></span>';
  }

  /** Render a tag as a control that opens its overview. */
  function renderTagButton(tag, className) {
    return '<button class="tag-open ' + (className || '') + '" data-action="open-tag" data-tag-key="'
      + escapeHtml(tag.key) + '" data-tip-overflow="' + escapeHtml(tag.label) + '" aria-label="Open ' + escapeHtml(tag.label) + ' overview">'
      + renderTagLabel(tag.label) + '</button>';
  }

  /**
   * A task's priority as a badge: an arrow for how far from the middle, and
   * the word. The row, the board card, and the query block all draw it, so
   * priority looks like one thing everywhere. The word "priority" is for a
   * screen reader; the edge and the arrow say it on screen.
   */
  const PRIORITY_MARKS = { highest: '↑↑', high: '↑', medium: '', low: '↓', lowest: '↓↓' };
  function renderPriorityBadge(priority) {
    const key = String(priority || '').toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(PRIORITY_MARKS, key)) return '';
    const word = key.charAt(0).toUpperCase() + key.slice(1);
    const mark = PRIORITY_MARKS[key];
    return '<span class="priority-badge priority-' + key + '" title="' + word + ' priority">'
      + (mark ? '<span class="priority-mark" aria-hidden="true">' + mark + '</span>' : '')
      + word + '<span class="visually-hidden"> priority</span></span>';
  }

  /** The rail step a weight fills to: three for 0.75 and up, two from 0.375. */
  function getWeightLevel(weight) {
    const value = Number(weight);
    if (!Number.isFinite(value) || value <= 0) return 0;
    if (value >= 0.75) return 3;
    if (value >= 0.375) return 2;
    return 1;
  }

  /** How much a tag weighs, as a rail of three steps filled to level. */
  function renderWeightRail(level, title) {
    let html = '<span class="tag-weight-rail"' + (title ? ' title="' + escapeHtml(title) + '"' : '') + ' aria-hidden="true">';
    for (let index = 0; index < 3; index += 1) {
      html += '<span class="tag-weight-rail-segment' + (index < level ? ' filled' : '') + '"></span>';
    }
    return html + '</span>';
  }

  /** Give built-in and user-created namespaces the same readable title form. */
  function formatEntityTitle(kind, name) {
    function formatPart(value) {
      return String(value)
        .replace(/[-_]+/g, ' ')
        .replace(/\\b[a-z]/g, function (character) { return character.toUpperCase(); });
    }
    return formatPart(kind) + ': ' + formatPart(name);
  }

  /** Replace tag tokens inside a title with controls, keeping their position. */
  function renderInlineTitle(title, tags, appendMissing) {
    const references = tags || [];
    const labels = references
      .map(function (tag) { return tag.label; })
      .filter(Boolean)
      .sort(function (left, right) { return right.length - left.length; });
    if (!labels.length) return escapeHtml(title);
    const pattern = new RegExp(labels.map(function (label) {
      return String(label).split('').map(function (character) {
        return '[]{}()|^$+*?.-'.indexOf(character) >= 0 || character === String.fromCharCode(92)
          ? String.fromCharCode(92) + character
          : character;
      }).join('');
    }).join('|'), 'g');
    let rendered = '';
    let offset = 0;
    const matchedKeys = new Set();
    title.replace(pattern, function (match, matchOffset) {
      rendered += escapeHtml(title.slice(offset, matchOffset));
      const tag = references.find(function (candidate) { return candidate.label === match; });
      if (tag) matchedKeys.add(tag.key);
      rendered += tag ? renderTagButton(tag, 'inline-tag') : escapeHtml(match);
      offset = matchOffset + match.length;
      return match;
    });
    const trailing = appendMissing === false ? '' : references
      .filter(function (tag) { return !matchedKeys.has(tag.key); })
      .map(function (tag) { return renderTagButton(tag, 'inline-tag'); })
      .join('');
    return rendered + escapeHtml(title.slice(offset)) + trailing;
  }

  /** Decorate tag text inside already-rendered Markdown without re-escaping it. */
  function renderTaskTitle(renderedTitle, references) {
    references = references || [];
    if (!references.length) return renderedTitle;
    const template = document.createElement('template');
    template.innerHTML = renderedTitle;
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach(function (node) {
      if (node.parentElement && node.parentElement.closest('a, button')) return;
      const source = node.nodeValue || '';
      const replacementHtml = renderInlineTitle(source, references, false);
      if (replacementHtml === escapeHtml(source)) return;
      const replacement = document.createElement('template');
      replacement.innerHTML = replacementHtml;
      node.parentNode.replaceChild(replacement.content, node);
    });
    return template.innerHTML;
  }

${getTipScript()}
${getUndoScript()}
  /**
   * An icon-only button: its label is its accessible name and its tip, and
   * it never carries title. options: { action, label, icon, tip, key,
   * className, attributes, pressed, disabledReason }.
   */
  function renderIconButton(options) {
    const tip = options.tip || options.label;
    return '<button type="button" class="icon-button' + (options.className ? ' ' + options.className : '') + '"'
      + (options.action ? ' data-action="' + escapeHtml(options.action) + '"' : '')
      + (options.attributes ? ' ' + options.attributes : '')
      + ' aria-label="' + escapeHtml(options.label) + '" data-tip="' + escapeHtml(tip) + '"'
      + (options.key ? ' data-tip-key="' + escapeHtml(options.key) + '"' : '')
      + (options.pressed === undefined ? '' : ' aria-pressed="' + Boolean(options.pressed) + '"')
      + (options.disabledReason ? ' aria-disabled="true" data-tip-disabled="' + escapeHtml(options.disabledReason) + '"' : '')
      + '>' + (options.icon || '') + '</button>';
  }

  /**
   * Right-click actions for any element carrying a tag key.
   *
   * Call installTagContextMenu(post) once; it wires the listeners and calls
   * back with the chosen action and tag.
   */
  let tagContextMenu;
  let tagContextKey;

  function closeTagContextMenu() {
    const wasOpen = Boolean(tagContextMenu && !tagContextMenu.hidden);
    if (tagContextMenu) tagContextMenu.hidden = true;
    tagContextKey = undefined;
    if (wasOpen) returnFocusFromMenu();
  }

  /**
   * A menu where the pointer is, of whatever a page offers there. Each item
   * is { action, label } and posts its action through the page's handler.
   */
  function openContextMenu(event, items) {
    if (!items.length) return;
    event.preventDefault();
    closeTagContextMenu();
    if (!tagContextMenu) {
      tagContextMenu = document.createElement('div');
      tagContextMenu.id = 'tag-context-menu';
      tagContextMenu.className = 'tag-context-menu popover';
      tagContextMenu.setAttribute('role', 'menu');
      document.body.appendChild(tagContextMenu);
    }
    tagContextMenu.innerHTML = items.map(function (item) {
      return '<button type="button" class="menu-item" role="menuitem" data-context-action="' + escapeHtml(item.action) + '"><span class="menu-label">' + escapeHtml(item.label) + '</span></button>';
    }).join('');
    tagContextMenu.hidden = false;
    const bounds = tagContextMenu.getBoundingClientRect();
    tagContextMenu.style.left = Math.max(8, Math.min(event.clientX, window.innerWidth - bounds.width - 8)) + 'px';
    tagContextMenu.style.top = Math.max(8, Math.min(event.clientY, window.innerHeight - bounds.height - 8)) + 'px';
    tagContextMenu.querySelector('button').focus();
  }

  /** The tags deckard.parked.tags lists, which the menu offers to unpark. */
  let parkedTagKeys = new Set();

  /** Called from each page's state handler with the host's parkedTags. */
  function setParkedTags(keys) {
    parkedTagKeys = new Set((keys || []).map(function (key) { return String(key).toLowerCase(); }));
  }

  /** The tag menu's park row: Park tag, or Unpark tag on a listed one. */
  function parkTagMenuItem(tagKey) {
    return parkedTagKeys.has(String(tagKey).toLowerCase())
      ? { action: 'unpark-tag', label: 'Unpark tag' }
      : { action: 'park-tag', label: 'Park tag' };
  }

  function openTagContextMenu(event, target) {
    const tagKey = target.dataset.tagKey;
    if (!tagKey) return;
    // Opening closes whatever was open, which lets go of the tag it was
    // about, so this menu's tag is remembered after that and not before.
    openContextMenu(event, [{ action: 'rename-tag', label: 'Rename tag' }, parkTagMenuItem(tagKey)]);
    tagContextKey = tagKey;
  }

  function installTagContextMenu(onAction) {
    document.addEventListener('contextmenu', function (event) {
      const target = event.target.closest('[data-tag-key]');
      if (target) openTagContextMenu(event, target);
    });
    document.addEventListener('click', function (event) {
      const chosen = event.target.closest('#tag-context-menu [data-context-action]');
      if (chosen) {
        const tagKey = tagContextKey;
        closeTagContextMenu();
        if (tagKey) onAction(chosen.dataset.contextAction, tagKey);
        return;
      }
      if (tagContextMenu && !event.target.closest('#tag-context-menu')) closeTagContextMenu();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && tagContextMenu && !tagContextMenu.hidden) closeTagContextMenu();
    });
  }

  /**
   * A menu of choices under a control, as a board card's ⋯ opens. groups is
   * a list of { label, items: [{ value, label }] }, and onChoose is called
   * with the chosen value. One element serves every opener; it closes on a
   * choice, Escape, or a click elsewhere, the arrow keys walk it, and focus
   * goes back to the control that opened it.
   */
  const CHECK_ICON = '${strokeIcon(ICON_PATHS.check)}';
  let actionMenu;
  let actionMenuChoose;
  let actionMenuOpener;

  function closeActionMenu() {
    if (!actionMenu || actionMenu.hidden) return;
    actionMenu.hidden = true;
    actionMenuChoose = undefined;
    const opener = actionMenuOpener;
    actionMenuOpener = undefined;
    if (opener && document.contains(opener)) {
      opener.setAttribute('aria-expanded', 'false');
      if (opener.focus) opener.focus();
    }
  }

  function openActionMenu(opener, groups, onChoose) {
    closeActionMenu();
    if (!actionMenu) {
      actionMenu = document.createElement('div');
      actionMenu.id = 'action-menu';
      actionMenu.className = 'tag-context-menu action-menu popover';
      actionMenu.setAttribute('role', 'menu');
      actionMenu.hidden = true;
      document.body.appendChild(actionMenu);
      document.addEventListener('click', function (event) {
        const chosen = event.target.closest('#action-menu [data-menu-value]');
        if (chosen) {
          const choose = actionMenuChoose;
          closeActionMenu();
          if (choose) choose(chosen.dataset.menuValue);
          return;
        }
        if (actionMenu.hidden || event.target.closest('#action-menu')) return;
        if (actionMenuOpener && actionMenuOpener.contains(event.target)) return;
        closeActionMenu();
      });
      document.addEventListener('keydown', function (event) {
        if (actionMenu.hidden) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          closeActionMenu();
          return;
        }
        // The key a row shows works in the open menu too, so the hint is
        // true in both places: 2 in the menu chooses High.
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          const keyed = Array.prototype.find.call(actionMenu.querySelectorAll('[data-menu-key]'), function (item) { return item.dataset.menuKey === event.key; });
          if (keyed) {
            event.preventDefault();
            keyed.click();
            return;
          }
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].indexOf(event.key) < 0) return;
        const items = Array.prototype.slice.call(actionMenu.querySelectorAll('[data-menu-value]'));
        const index = items.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0
          : event.key === 'End' ? items.length - 1
          : event.key === 'ArrowDown' ? (index + 1) % items.length
          : (index - 1 + items.length) % items.length;
        event.preventDefault();
        items[next].focus();
      });
    }
    // A named group is a group to a screen reader too, so "Due today" is
    // heard as one of the Due choices rather than as a bare item. A group
    // whose items say whether they are checked is a single choice: its items
    // are radios, and every row keeps a check's width so the labels align.
    const shown = groups.filter(function (group) { return group.items.length; });
    const checks = shown.some(function (group) { return group.items.some(function (item) { return item.checked !== undefined; }); });
    actionMenu.innerHTML = shown.map(function (group, groupIndex) {
      const items = group.items.map(function (item) {
        const radio = item.checked !== undefined;
        return '<button type="button" class="menu-item" role="' + (radio ? 'menuitemradio' : 'menuitem') + '"'
          + (radio ? ' aria-checked="' + Boolean(item.checked) + '"' : '')
          + (item.key ? ' aria-keyshortcuts="' + escapeHtml(item.key) + '" data-menu-key="' + escapeHtml(item.key) + '"' : '')
          + ' data-menu-value="' + escapeHtml(item.value) + '">'
          + (checks ? '<span class="menu-check" aria-hidden="true">' + (item.checked ? CHECK_ICON : '') + '</span>' : '')
          + '<span class="menu-label">' + escapeHtml(item.label) + '</span>'
          + (item.key ? '<kbd class="menu-key" aria-hidden="true">' + escapeHtml(item.key) + '</kbd>' : '')
          + '</button>';
      }).join('');
      if (!group.label) return items;
      const headingId = 'action-menu-group-' + groupIndex;
      return '<div class="menu-group" role="group" aria-labelledby="' + headingId + '"><div class="menu-heading" id="' + headingId + '" role="presentation">' + escapeHtml(group.label) + '</div>' + items + '</div>';
    }).join('');
    // Focus opens on what the task is now, so the arrows start from it.
    const first = actionMenu.querySelector('[aria-checked="true"]') || actionMenu.querySelector('[data-menu-value]');
    if (!first) return;
    actionMenuChoose = onChoose;
    actionMenuOpener = opener;
    opener.setAttribute('aria-expanded', 'true');
    actionMenu.hidden = false;
    const at = opener.getBoundingClientRect();
    const bounds = actionMenu.getBoundingClientRect();
    actionMenu.style.left = Math.max(8, Math.min(at.right - bounds.width, window.innerWidth - bounds.width - 8)) + 'px';
    actionMenu.style.top = Math.max(8, Math.min(at.bottom + 4, window.innerHeight - bounds.height - 8)) + 'px';
    first.focus();
  }

  /**
   * The element a keyboard opened a context menu from, so closing the menu
   * gives focus back to it. A pointer leaves this unset. Opening a menu
   * closes whatever was open first, so a close consumes it only when a menu
   * was showing.
   */
  let contextMenuOpener;

  /** Gives focus back to where a keyboard opened the menu that just closed. */
  function returnFocusFromMenu() {
    const opener = contextMenuOpener;
    contextMenuOpener = undefined;
    if (opener && document.contains(opener) && opener.focus) opener.focus();
  }

  /**
   * The keyboard's way to every context menu. Each menu here opens on a
   * contextmenu event, wired by the page or by a helper above, so the menu
   * key, Shift+F10, and Alt+Enter on a focused tag, card, or row raise that
   * event at the element, and whatever menu a pointer would get there opens
   * for the keyboard too. Installed once, ahead of the pages' own listeners,
   * so a handler that opens on the same keys can see the key was taken.
   */
  document.addEventListener('keydown', function (event) {
    const isMenuKey = event.key === 'ContextMenu'
      || (event.key === 'F10' && event.shiftKey)
      || (event.key === 'Enter' && event.altKey);
    if (!isMenuKey || event.defaultPrevented) return;
    if (!event.target || !event.target.closest) return;
    // A field keeps the browser's own menu.
    if (event.target.closest('input, textarea, select')) return;
    const target = event.target.closest('[data-tag-key], .card, .task-row, .task, .row');
    if (!target) return;
    const bounds = target.getBoundingClientRect();
    contextMenuOpener = target;
    const raised = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: bounds.left + 12,
      clientY: bounds.top + bounds.height,
    });
    target.dispatchEvent(raised);
    if (raised.defaultPrevented) event.preventDefault();
    else contextMenuOpener = undefined;
  });

  /**
   * Arrow keys between a search's result tabs, as the tab role promises: Left
   * and Right move and choose, Home and End go to the ends. The dashboard's
   * own tabs have the same in their page.
   */
  document.addEventListener('keydown', function (event) {
    if (!event.target || !event.target.closest) return;
    const tab = event.target.closest('[role="tab"][data-action="set-result-tab"]');
    if (!tab) return;
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(event.key) < 0) return;
    const list = tab.closest('[role="tablist"]');
    const tabs = list ? Array.prototype.slice.call(list.querySelectorAll('[role="tab"]')) : [tab];
    const index = tabs.indexOf(tab);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    event.preventDefault();
    const chosen = tabs[next].dataset.tab;
    tabs[next].click();
    // The page redraws on the click, so the tab to focus is found again.
    const drawn = document.querySelector('[role="tab"][data-action="set-result-tab"][data-tab="' + chosen + '"]');
    if (drawn) drawn.focus();
  });

  /**
   * One figure in a row of .metrics: its label, its value, and, with a query,
   * a button that opens the search the figure counts. code is the theme's
   * decorative caption, such as TSK.OVR // 01.
   */
  function renderMetric(label, value, query, hint, code, trend) {
    const codeAttribute = code ? ' data-code="' + escapeHtml(code) + '"' : '';
    const change = trend ? describeChange(trend.change) : '';
    const body = '<span class="metric-label">' + escapeHtml(label) + '</span><strong class="metric-value">' + value + '</strong>'
      + (trend ? renderSparkline(trend.points) + '<span class="metric-change">' + escapeHtml(change) + '</span>' : '');
    const said = label + ', ' + value + (change ? ', ' + change : '');
    if (!query) return '<article class="metric"' + codeAttribute + (trend ? ' aria-label="' + escapeHtml(said) + '"' : '') + '>' + body + '</article>';
    const tip = hint + (trend && trend.note ? '. ' + trend.note : '');
    return '<button type="button" class="metric metric-open"' + codeAttribute + ' data-action="open-search" data-query="' + escapeHtml(query) + '" data-tip="' + escapeHtml(tip) + '" aria-label="' + escapeHtml(said + '. ' + hint) + '">' + body + '</button>';
  }

  /**
   * A total's last twelve weeks as a line: min to max top to bottom, a flat
   * run as a midline, the latest point marked. Each point names itself on
   * hover ("3 weeks ago: 402") through a thin strip under it. Hidden from
   * assistive technology: the tile says the change in words.
   */
  function renderSparkline(points) {
    if (!points || points.length < 2) return '';
    const width = (points.length - 1) * 10;
    const low = Math.min.apply(null, points);
    const high = Math.max.apply(null, points);
    const y = function (value) { return high === low ? 10 : 18 - ((value - low) / (high - low)) * 16; };
    const coordinates = points.map(function (value, index) { return (index * 10) + ',' + y(value).toFixed(1); });
    const last = points.length - 1;
    const hits = points.map(function (value, index) {
      const ago = last - index;
      const when = ago === 0 ? 'Now' : ago === 1 ? '1 week ago' : ago + ' weeks ago';
      return '<rect class="sparkline-hit" x="' + (index * 10 - 4) + '" y="0" width="8" height="20"><title>' + when + ': ' + value + '</title></rect>';
    }).join('');
    const endY = y(points[last]).toFixed(1);
    return '<svg class="sparkline" viewBox="0 0 ' + width + ' 20" preserveAspectRatio="none" aria-hidden="true" focusable="false">'
      + '<polyline class="sparkline-line" points="' + coordinates.join(' ') + '"/>'
      + '<line class="sparkline-end" x1="' + width + '" y1="' + endY + '" x2="' + width + '" y2="' + endY + '"/>'
      + hits + '</svg>';
  }

  /** "+9 in the last 7 days", "−3 in the last 7 days", or no change. */
  function describeChange(change) {
    if (!change) return 'No change in the last 7 days';
    return (change > 0 ? '+' + change : '\u2212' + Math.abs(change)) + ' in the last 7 days';
  }

  /** The Status, Priority, and Due date switch above a task board. */
  /** The namespaces the board's Tag… menu offers, from the last state. */
  let taskBoardNamespaces = [];
  let taskBoardNamespace;

  function renderTaskBoardGroupSwitch(groupBy, namespace, namespaces) {
    taskBoardNamespaces = namespaces || [];
    taskBoardNamespace = groupBy === 'tag' ? namespace : undefined;
    const byTag = groupBy === 'tag' && namespace;
    const none = taskBoardNamespaces.length === 0 && !byTag;
    // Tag… is a menu of the namespaces in use, and names the one chosen.
    const tag = '<button type="button" class="' + (byTag ? 'active' : '') + '" data-action="pick-board-namespace" aria-haspopup="menu" aria-expanded="false" aria-pressed="' + Boolean(byTag) + '"'
      + (none
        ? ' aria-disabled="true" data-tip-disabled="No open task carries a namespaced tag such as #context/phone yet"'
        : ' data-tip="' + (byTag ? 'Grouped by #' + escapeHtml(namespace) + '/… tags. Choose another namespace' : 'Group by the tags in one namespace, such as #project/… or #context/…') + '"')
      + '>' + (byTag ? '#' + escapeHtml(namespace) : 'Tag…') + '</button>';
    return '<div class="segmented task-board-group" role="group" aria-label="Group tasks by">'
      + [['status', 'Status'], ['priority', 'Priority'], ['due', 'Due date'], ['assignee', 'Person']].map(function (option) {
        const active = option[0] === groupBy;
        return '<button type="button" class="' + (active ? 'active' : '') + '" data-action="set-board-group" data-group="' + option[0] + '" aria-pressed="' + active + '">' + option[1] + '</button>';
      }).join('') + tag + '</div>';
  }

  /**
   * A card's key: its column and its task. A task with two tags in the
   * namespace the board is grouped by is two cards, and each is found,
   * moved, and focused as itself.
   */
  function boardCardKey(columnId, taskId) {
    return String(columnId) + '\\u0000' + String(taskId);
  }

  function cardKeyOf(card) {
    return boardCardKey(card.dataset.cardColumn, card.dataset.taskId);
  }

  /**
   * Every edit a card can make, whatever the board is grouped by.
   *
   * The menu used to offer the columns of the current grouping alone, so
   * changing a due date meant regrouping the whole board first, and the most
   * common edits ended in the Markdown file instead.
   */
  function taskCardMoves(card, columnId, columns, settings) {
    const current = card.current || [];
    // Status, priority, and due are single choices: each keeps the task's
    // own value, checked, rather than leaving it out, and shows its key.
    const option = function (value, label, key) {
      const item = { value: value, label: label, checked: current.indexOf(value) >= 0 || value === columnId };
      if (key) item.key = key;
      return item;
    };
    const move = function (value, label) {
      return value === columnId ? undefined : { value: value, label: label };
    };
    const group = function (label, options) {
      return { label: label, items: options.filter(Boolean) };
    };
    const statuses = (settings && settings.statuses) || [];
    const statusOptions = [option('status:', 'No status')].concat(statuses.map(function (status) {
      return option('status:' + status, status.charAt(0).toUpperCase() + status.slice(1).replace(/[-_]+/g, ' '));
    }));
    const priorityOptions = [['highest', 'Highest', '1'], ['high', 'High', '2'], ['medium', 'Medium', '3'], ['low', 'Low', '4'], ['lowest', 'Lowest', '5'], ['', 'No priority', '0']].map(function (entry) {
      return option('priority:' + entry[0], entry[1], entry[2]);
    });
    const dueOptions = [['today', 'Due today', 't'], ['tomorrow', 'Due tomorrow', 'm'], ['', 'No due date']].map(function (entry) {
      return option('due:' + entry[0], entry[1], entry[2]);
    }).concat([{ value: 'pick-date', label: 'Due on a date…', key: 'd' }]);
    const done = card.completed ? '' : { value: 'done', label: 'Complete it', key: 'x' };
    // Any column of the current grouping that is not one of the above, such
    // as a due band the board made, still moves the card.
    const others = columns.filter(function (column) {
      return column.droppable && column.id !== columnId
        && column.id.indexOf('status:') !== 0
        && column.id.indexOf('priority:') !== 0
        && column.id.indexOf('due:') !== 0
        && column.id !== 'done';
    }).map(function (column) { return move(column.id, column.label); });
    return [
      group('Status', statusOptions),
      group('Priority', priorityOptions),
      group('Due', dueOptions),
      group('This board', others),
      group('Steps', [{ value: 'break-steps', label: card.steps ? 'Add steps…' : 'Break into steps…', key: 's' }]),
      group('Done', done ? [done] : []),
      group('Note', [{ value: 'move-to', label: 'Move to…' }]),
    ];
  }

  /** The moves each drawn card offers, by task id, for its menu to open. */
  let taskBoardMoves = {};

  /** One task card, with its checkbox and the menu that edits it. */
  const ELLIPSIS_ICON = '${strokeIcon(ICON_PATHS.ellipsis)}';

  function renderTaskBoardCard(card, columnId, columns, settings) {
    taskBoardMoves[boardCardKey(columnId, card.taskId)] = taskCardMoves(card, columnId, columns, settings);
    const details = card.details.map(function (detail) {
      // The host words the due date, "overdue 15 days · 2026-09-08", so the
      // state is in the text; the page only colors it.
      const overdue = card.overdue && detail.indexOf('overdue') === 0;
      const quiet = overdue && card.overdueTone === 'quiet';
      const stale = card.stale && detail.indexOf('was due') === 0;
      // The host words priority as "high priority"; the card draws the badge
      // the task rows draw, so it is told from the due date beside it.
      const priority = /^(highest|high|medium|low|lowest) priority$/.exec(detail);
      if (priority) return renderPriorityBadge(priority[1]);
      // A date is one word: "2026-09-01" broke at its hyphens in a narrow
      // column, leaving "2026-09-" on one line and "01" on the next.
      const text = escapeHtml(detail).replace(/\\d{4}-\\d{2}-\\d{2}/g, function (date) {
        return '<span class="board-date">' + date + '</span>';
      });
      return '<span' + (quiet ? ' class="overdue quiet"' : overdue ? ' class="overdue"' : stale ? ' class="stale"' : '') + '>' + text + '</span>';
    }).join('');
    const plainTitle = String(card.title || '');
    // The file and line, then the headings above, fold under the card as
    // they do under a row: the file name was the last detail on every card.
    const cardPath = renderHeadingPath(card.headingPath, String(card.filePath).split('/').pop() || card.filePath, '');
    // A short name for the card as a whole, since a focused article is read
    // in full otherwise: its title, its column, and when it is due.
    const columnLabel = (columns.find(function (column) { return column.id === columnId; }) || {}).label;
    const dueDetail = (card.details || []).find(function (detail) { return /^(due|overdue|was due)/i.test(detail); });
    const steps = card.steps
      ? '<p class="source board-steps"><span class="board-steps-label">' + escapeHtml(card.steps.label) + '</span>'
        + (card.steps.next ? '<span class="board-steps-next"> · next: ' + escapeHtml(card.steps.next) + '</span>' : '')
        + '</p>'
      : '';
    const cardName = [plainTitle, columnLabel, dueDetail, card.steps ? card.steps.label : ''].filter(Boolean).join(', ');
    // The board is one Tab stop: the card last focused, or the first. Arrow
    // keys move between cards, and a card's checkbox and menu are keys of
    // their own, so neither is a Tab stop either.
    const tabStop = boardCardKey(columnId, card.taskId) === taskBoardTabStop ? '0' : '-1';
    return '<article class="task board-card' + (card.completed ? ' completed' : '') + '" draggable="true" tabindex="' + tabStop + '" aria-label="' + escapeHtml(cardName) + '" aria-keyshortcuts="x t m d e s 1 2 3 4 5 [ ]"'
      + ' data-task-id="' + escapeHtml(card.taskId) + '" data-card-column="' + escapeHtml(columnId) + '" data-file-path="' + escapeHtml(card.filePath) + '" data-line="' + card.line + '">'
      + '<input type="checkbox" tabindex="-1" data-action="board-toggle-task" aria-label="' + escapeHtml((card.completed ? 'Reopen ' : 'Complete ') + plainTitle) + '" data-tip="' + (card.completed ? 'Reopen' : 'Complete') + ' this task"' + (card.completed ? ' checked' : '') + '>'
      + '<div class="task-summary"><div class="task-title">' + renderTaskTitle(card.renderedTitle, card.titleTags) + '</div>'
      + '<p class="source board-details">' + details + '</p>'
      + steps
      + '<span class="task-source">' + escapeHtml(formatSourceLocation(String(card.filePath).split('/').pop() || card.filePath, card.line)) + '</span>'
      + (cardPath ? '<span class="task-source heading-path">' + cardPath + '</span>' : '')
      + renderIconButton({
        action: 'board-menu',
        className: 'board-move',
        label: 'Change ' + plainTitle + ': status, priority, or due date',
        tip: 'Change this task',
        icon: ELLIPSIS_ICON,
        attributes: 'tabindex="-1" aria-haspopup="menu" aria-expanded="false"',
      })
      + '</div></article>';
  }

  /**
   * A column's count as its header shows it, "40 / 3 · 38 overdue", and its
   * name as a screen reader hears it.
   */
  function describeBoardColumn(label, count, limit, overdueCount) {
    return {
      count: String(count) + (limit !== undefined ? ' / ' + limit : '') + (overdueCount ? ' · ' + overdueCount + ' overdue' : ''),
      name: label + ', ' + count + (count === 1 ? ' task' : ' tasks') + (limit !== undefined ? ', limit ' + limit : '') + (overdueCount ? ', ' + overdueCount + ' overdue' : ''),
    };
  }

  /**
   * Draw a task board from the host's columns. isVisible, when given, hides
   * cards a page filters locally, such as by a search.
   */
  function renderTaskBoard(board, isVisible) {
    taskBoardMoves = {};
    const shown = board.columns.reduce(function (all, column) {
      return all.concat((isVisible ? column.cards.filter(isVisible) : column.cards).map(function (card) {
        return boardCardKey(column.id, card.taskId);
      }));
    }, []);
    if (shown.indexOf(taskBoardTabStop) < 0) {
      taskBoardTabStop = shown.length ? shown[0] : undefined;
    }
    // Grouped by status with almost no statuses written, the board is one
    // tall column and four near-empty ones. Say so, and offer the grouping
    // that works for any task, before the reader takes the board for broken.
    const hint = board.statusHint
      ? '<p class="board-hint">' + board.statusHint.withoutStatus + ' of ' + board.statusHint.open + ' open tasks have no status. Write a <code>#' + escapeHtml((board.settings && board.settings.statusNamespace) || 'status') + '/todo</code> tag on a task, or drag a card into a column, to give it one. <button type="button" data-action="set-board-group" data-group="due">Group by due date</button></p>'
      : '';
    return hint + '<div class="board task-board" aria-label="Task board">' + board.columns.map(function (column) {
      const cards = isVisible ? column.cards.filter(isVisible) : column.cards;
      const count = cards.length + column.hiddenCount;
      // Counted from the cards shown, so typed words that hide cards recount
      // the overdue ones too. Done and Overdue itself need no such count.
      const overdueCount = column.id === 'done' || column.id === 'due:overdue'
        ? 0
        : cards.filter(function (card) { return card.overdue && !card.completed; }).length;
      const limit = column.limit;
      const overLimit = limit !== undefined && count > limit;
      const described = describeBoardColumn(column.label, count, limit, overdueCount);
      const countText = described.count;
      const columnName = described.name;
      const body = cards.length
        ? cards.map(function (card) { return renderTaskBoardCard(card, column.id, board.columns, board.settings); }).join('')
        : '<p class="board-empty">' + (column.droppable ? 'Drop a task here' : 'No tasks') + '</p>';
      return '<section class="board-column' + (column.id === 'due:overdue' ? ' is-overdue' : '') + (overLimit ? ' over-limit' : '') + '"'
        + ' data-column-id="' + escapeHtml(column.id) + '" data-droppable="' + column.droppable + '"'
        + ' data-hidden-count="' + (column.hiddenCount || 0) + '"' + (limit !== undefined ? ' data-limit="' + limit + '"' : '')
        + ' aria-label="' + escapeHtml(columnName) + '">'
        + '<h2 class="board-column-title"><span>' + escapeHtml(column.label) + '</span><span class="board-count">' + escapeHtml(countText) + '</span></h2>'
        // A column that takes a drop takes a new task the same way, from under
        // its title: at the foot of a long column it was out of sight.
        + (column.droppable && column.id !== 'done'
          ? '<button type="button" class="board-add" data-action="board-add-task" data-column-id="' + escapeHtml(column.id) + '" data-tip="Capture a task straight into ' + escapeHtml(column.label) + '">+ Add task</button>'
          : '')
        + '<div class="board-cards">' + body + '</div>'
        + (column.hiddenCount ? '<p class="board-more"><button data-action="show-column-rest" data-column-id="' + escapeHtml(column.id) + '">Show ' + column.hiddenCount + ' more</button></p>' : '')
        // One that does not take a drop says so while a card is dragged, and
        // where to go instead.
        + (column.droppable ? '' : '<p class="board-refuses">' + (column.id.indexOf('due:') === 0 ? 'A card cannot be dropped on a range of days. Pick its date from its ⋯ menu.' : 'A card cannot be dropped here.') + '</p>')
        + '</section>';
    }).join('') + '</div>';
  }

  /**
   * Wire every task board on the page, once. Listeners sit on the document,
   * so a page may redraw its boards freely. post receives openSource,
   * toggleTask, moveTask, and setBoardGroup messages. A dropped card moves at
   * once; the host's next state confirms it or puts it back.
   */
  let taskBoardDragId;
  /** The column the dragged card was in. */
  let taskBoardDragColumn;
  /** The card that is the board's one Tab stop, kept across redraws. */
  let taskBoardTabStop;
  /** Until when a card just completed stays on screen before the redraw. */
  let taskBoardLingerUntil = 0;

  /**
   * How long the next redraw should wait for a completed card to finish
   * leaving. A card that vanished the moment its box was ticked left the
   * reader unsure they had ticked the right one.
   */
  function taskBoardLingerRemaining() {
    return Math.max(0, taskBoardLingerUntil - Date.now());
  }

  function reducedMotion() {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function installTaskBoard(post) {
    function boardCard(target) {
      return target && target.closest ? target.closest('.task-board .board-card') : undefined;
    }
    function dropColumn(event) {
      const column = event.target && event.target.closest ? event.target.closest('.task-board .board-column') : undefined;
      return column && taskBoardDragId && column.dataset.droppable === 'true' ? column : undefined;
    }
    function clearDropTargets() {
      document.querySelectorAll('.board-column.drop-target').forEach(function (column) { column.classList.remove('drop-target'); });
    }
    function openCard(card, event) {
      post(openSourceMessage(card, event));
    }

    function completeCard(card, completed) {
      post({ type: 'toggleTask', taskId: card.dataset.taskId, completed: completed });
      announce((completed ? 'Completed ' : 'Reopened ') + taskTitleOf(card) + '.');
      if (completed && !reducedMotion()) {
        card.classList.add('is-completing');
        taskBoardLingerUntil = Date.now() + 800;
      }
    }
    function moveCard(card, column, said) {
      const from = card.dataset.cardColumn;
      applyMove(card, column);
      post({ type: 'moveTask', taskId: card.dataset.taskId, column: column, from: from });
      announce(said);
    }
    /** A column's header counted again from the cards it holds now. */
    function recountColumn(column) {
      if (!column) return;
      const title = column.querySelector('.board-column-title span');
      const cards = Array.prototype.filter.call(column.querySelectorAll('.board-card'), function (card) { return !card.hidden; });
      const count = cards.length + Number(column.dataset.hiddenCount || 0);
      const id = column.dataset.columnId;
      const overdue = id === 'done' || id === 'due:overdue' ? 0 : cards.filter(function (card) { return card.querySelector('.board-details .overdue') && !card.classList.contains('completed'); }).length;
      const limit = column.dataset.limit === undefined ? undefined : Number(column.dataset.limit);
      const described = describeBoardColumn(title ? title.textContent : '', count, limit, overdue);
      const counter = column.querySelector('.board-count');
      if (counter) counter.textContent = described.count;
      column.setAttribute('aria-label', described.name);
      column.classList.toggle('over-limit', limit !== undefined && count > limit);
    }
    /**
     * A move shows at once: the card goes to the top of its new column, both
     * counts change, and it is marked pending until the host's next state
     * replaces the board. A move to a column this grouping does not draw,
     * such as a priority on a status board, marks the card where it is.
     */
    function applyMove(card, columnId) {
      const from = card.closest('.board-column');
      const to = Array.prototype.find.call(document.querySelectorAll('.task-board .board-column'), function (column) { return column.dataset.columnId === columnId; });
      if (to && to !== from) {
        const cards = to.querySelector('.board-cards');
        const empty = cards && cards.querySelector('.board-empty');
        if (empty) empty.remove();
        if (cards) cards.prepend(card);
        // It is this column's card now, for its key and its focus.
        card.setAttribute('data-card-column', columnId);
        taskBoardTabStop = cardKeyOf(card);
        recountColumn(from);
        recountColumn(to);
      }
      card.classList.add('is-pending');
      card.setAttribute('aria-busy', 'true');
      focusCard(card);
    }
    function visibleCards(column) {
      return Array.prototype.filter.call(column.querySelectorAll('.board-card'), function (card) { return !card.hidden; });
    }
    function focusCard(card) {
      if (!card) return;
      document.querySelectorAll('.task-board .board-card[tabindex="0"]').forEach(function (other) { other.setAttribute('tabindex', '-1'); });
      card.setAttribute('tabindex', '0');
      taskBoardTabStop = cardKeyOf(card);
      card.focus();
      if (card.scrollIntoView) card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    function columnTitle(column) {
      const title = column && column.querySelector('.board-column-title span');
      return title ? title.textContent : 'the column';
    }
    /** The keys a focused card answers, which the ? sheet lists. */
    function handleCardKey(event, card) {
      const column = card.closest('.board-column');
      const columns = Array.prototype.slice.call(document.querySelectorAll('.task-board .board-column'));
      const cards = visibleCards(column);
      const at = cards.indexOf(card);
      const key = event.key;
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        focusCard(cards[at + (key === 'ArrowDown' ? 1 : -1)]);
        return true;
      }
      if (key === 'Home' || key === 'End') {
        focusCard(key === 'Home' ? cards[0] : cards[cards.length - 1]);
        return true;
      }
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        const step = key === 'ArrowRight' ? 1 : -1;
        for (let index = columns.indexOf(column) + step; index >= 0 && index < columns.length; index += step) {
          const next = visibleCards(columns[index]);
          if (next.length) {
            focusCard(next[Math.min(at, next.length - 1)]);
            break;
          }
        }
        return true;
      }
      if (key === 'x') {
        completeCard(card, !card.classList.contains('completed'));
        return true;
      }
      if (key === 't' || key === 'm') {
        moveCard(card, key === 't' ? 'due:today' : 'due:tomorrow', taskTitleOf(card) + (key === 't' ? ' is due today.' : ' is due tomorrow.'));
        return true;
      }
      if (/^[0-5]$/.test(key)) {
        const priority = ['', 'highest', 'high', 'medium', 'low', 'lowest'][Number(key)];
        moveCard(card, 'priority:' + priority, taskTitleOf(card) + (priority ? ': ' + priority + ' priority.' : ': no priority.'));
        return true;
      }
      if (key === '[' || key === ']') {
        const droppable = columns.filter(function (candidate) { return candidate.dataset.droppable === 'true'; });
        const target = droppable[droppable.indexOf(column) + (key === ']' ? 1 : -1)];
        if (target && droppable.indexOf(column) >= 0) moveCard(card, target.dataset.columnId, 'Moved ' + taskTitleOf(card) + ' to ' + columnTitle(target) + '.');
        return true;
      }
      if (key === 'd') {
        post({ type: 'pickTaskDate', taskId: card.dataset.taskId });
        return true;
      }
      if (key === 'e') {
        post({ type: 'editTask', taskId: card.dataset.taskId });
        return true;
      }
      if (key === 's') {
        post({ type: 'breakIntoSteps', taskId: card.dataset.taskId });
        return true;
      }
      return false;
    }

    function openCardMenu(card, opener) {
      const groups = taskBoardMoves[cardKeyOf(card)];
      if (!groups) return false;
      openActionMenu(opener, groups, function (value) {
        if (value === 'pick-date') {
          post({ type: 'pickTaskDate', taskId: card.dataset.taskId });
          return;
        }
        if (value === 'move-to') {
          post({ type: 'moveTaskTo', taskId: card.dataset.taskId });
          return;
        }
        if (value === 'break-steps') {
          post({ type: 'breakIntoSteps', taskId: card.dataset.taskId });
          return;
        }
        // Said as the menu said it: "Draft spec: Priority, High."
        const group = groups.find(function (candidate) { return candidate.items.some(function (item) { return item.value === value; }); });
        const chosen = group ? group.items.find(function (item) { return item.value === value; }) : undefined;
        if (chosen && chosen.checked) {
          announce(taskTitleOf(card) + ': ' + (group.label || 'It') + ' is already ' + chosen.label + '.');
          return;
        }
        const from = card.dataset.cardColumn;
        applyMove(card, value);
        post({ type: 'moveTask', taskId: card.dataset.taskId, column: value, from: from });
        announce(taskTitleOf(card) + ': ' + (group && group.label ? group.label + ', ' : '') + (chosen ? chosen.label : value) + '.');
      });
      return true;
    }

    document.addEventListener('click', function (event) {
      const group = event.target.closest('[data-action="set-board-group"]');
      if (group) {
        post({ type: 'setBoardGroup', groupBy: group.dataset.group });
        return;
      }
      const namespaceButton = event.target.closest('[data-action="pick-board-namespace"]');
      if (namespaceButton) {
        const choices = taskBoardNamespaces.filter(function (namespace) { return namespace.name !== taskBoardNamespace; });
        if (!choices.length) return;
        openActionMenu(namespaceButton, [{
          label: 'Group by tag namespace',
          items: choices.map(function (namespace) {
            return { value: namespace.name, label: '#' + namespace.name + ' · ' + namespace.openTasks + ' open ' + (namespace.openTasks === 1 ? 'task' : 'tasks') };
          }),
        }], function (name) {
          post({ type: 'setBoardGroup', groupBy: 'tag', namespace: name });
        });
        return;
      }
      const menuButton = event.target.closest('[data-action="board-menu"]');
      if (menuButton) {
        const card = boardCard(menuButton);
        if (card) openCardMenu(card, menuButton);
        return;
      }
      const rest = event.target.closest('[data-action="show-column-rest"]');
      if (rest) {
        post({ type: 'showColumnRest', columnId: rest.dataset.columnId });
        return;
      }
      const add = event.target.closest('[data-action="board-add-task"]');
      if (add) {
        post({ type: 'addTaskToColumn', column: add.dataset.columnId });
        return;
      }
      if (event.target.closest('input, select, button, a')) return;
      const card = boardCard(event.target);
      if (card) openCard(card, event);
    });
    document.addEventListener('keydown', function (event) {
      const card = event.target.matches && event.target.matches('.task-board .board-card') ? event.target : undefined;
      if (!card || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'Enter') {
        openCard(card);
        return;
      }
      if (handleCardKey(event, card)) event.preventDefault();
    });
    // A card reached by Tab or a click becomes the board's Tab stop.
    document.addEventListener('focusin', function (event) {
      const card = event.target.matches && event.target.matches('.task-board .board-card') ? event.target : undefined;
      if (!card || card.getAttribute('tabindex') === '0') return;
      document.querySelectorAll('.task-board .board-card[tabindex="0"]').forEach(function (other) { other.setAttribute('tabindex', '-1'); });
      card.setAttribute('tabindex', '0');
      taskBoardTabStop = cardKeyOf(card);
    });
    document.addEventListener('change', function (event) {
      const card = boardCard(event.target);
      if (!card) return;
      if (event.target.dataset.action === 'board-toggle-task') completeCard(card, event.target.checked);
    });
    // A right-click on a card, or the menu key on a focused one, opens the
    // same menu its ⋯ does, anchored to that button.
    document.addEventListener('contextmenu', function (event) {
      const card = boardCard(event.target);
      if (!card || event.target.closest('[data-tag-key], a, input')) return;
      const button = card.querySelector('[data-action="board-menu"]');
      if (button && openCardMenu(card, button)) event.preventDefault();
    });
    document.addEventListener('dragstart', function (event) {
      const card = boardCard(event.target);
      if (!card) return;
      taskBoardDragId = card.dataset.taskId;
      taskBoardDragColumn = card.dataset.cardColumn;
      card.classList.add('dragging');
      // The columns that will not take the card say so while it is held.
      const board = card.closest('.task-board');
      if (board) board.classList.add('is-dragging-card');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', taskBoardDragId);
    });
    document.addEventListener('dragend', function (event) {
      const card = boardCard(event.target);
      if (card) card.classList.remove('dragging');
      document.querySelectorAll('.task-board.is-dragging-card').forEach(function (board) { board.classList.remove('is-dragging-card'); });
      clearDropTargets();
      taskBoardDragId = undefined;
      taskBoardDragColumn = undefined;
    });
    document.addEventListener('dragover', function (event) {
      const column = dropColumn(event);
      if (!column) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (!column.classList.contains('drop-target')) {
        clearDropTargets();
        column.classList.add('drop-target');
      }
    });
    document.addEventListener('dragleave', function (event) {
      const column = event.target && event.target.closest ? event.target.closest('.board-column') : undefined;
      if (column && !column.contains(event.relatedTarget)) column.classList.remove('drop-target');
    });
    document.addEventListener('drop', function (event) {
      const column = dropColumn(event);
      if (!column) return;
      event.preventDefault();
      // The card dragged, not another copy of its task in another column.
      const card = Array.prototype.find.call(
        document.querySelectorAll('.task-board .board-card[data-task-id="' + CSS.escape(taskBoardDragId) + '"]'),
        function (candidate) { return taskBoardDragColumn === undefined || candidate.dataset.cardColumn === taskBoardDragColumn; },
      );
      if (card && card.closest('.board-column') !== column) {
        const from = card.dataset.cardColumn;
        applyMove(card, column.dataset.columnId);
        post({ type: 'moveTask', taskId: taskBoardDragId, column: column.dataset.columnId, from: from });
        const title = column.querySelector('.board-column-title span');
        announce('Moved ' + taskTitleOf(card) + ' to ' + (title ? title.textContent : 'the column') + '.');
      }
      clearDropTargets();
    });
  }

  /**
   * The gear that holds a page's view options. groups is a list of
   * { label, html, stacked }, one row of the menu each. A menu that was open
   * before a redraw is open after it.
   */
  /**
   * The way to Help from any page. Help was reachable only from one icon in
   * the Related Notes sidebar, or the command palette, so the pages a reader
   * gets stuck on offered no route to it.
   */
  function renderHelpButton(anchor) {
    return renderIconButton({
      action: 'open-help',
      className: 'help-button',
      label: 'Open Help',
      icon: '${helpIcon}',
      attributes: anchor ? 'data-help-anchor="' + escapeHtml(anchor) + '"' : '',
    });
  }

  function renderViewOptions(groups) {
    const wasOpen = Boolean(document.querySelector('.view-options[open]'));
    return '<details class="view-options"' + (wasOpen ? ' open' : '') + '><summary aria-label="View options" data-tip="View options">' + '${settingsIcon}' + '</summary>'
      + '<div class="view-options-menu popover is-dropdown">' + groups.map(function (group) {
        return '<div class="view-options-group' + (group.stacked ? ' is-stacked' : '') + '"><span>' + escapeHtml(group.label) + '</span>' + group.html + '</div>';
      }).join('') + '</div></details>';
  }

  /**
   * A row of choices for the gear's menu, such as List and Board. choices
   * is a list of [value, text, ariaLabel]. Each button carries data-action,
   * data-value, and any attributes given.
   */
  function renderViewOptionChoices(action, choices, selected, label, attributes) {
    return '<div class="segmented view-options-choices" role="group" aria-label="' + escapeHtml(label) + '">' + choices.map(function (choice) {
      const value = String(choice[0]);
      const active = value === String(selected);
      return '<button type="button" class="' + (active ? 'active' : '') + '" data-action="' + escapeHtml(action) + '" data-value="' + escapeHtml(value) + '"' + (attributes ? ' ' + attributes : '') + ' aria-pressed="' + active + '"' + (choice[2] ? ' aria-label="' + escapeHtml(choice[2]) + '"' : '') + '>' + escapeHtml(choice[1]) + '</button>';
    }).join('') + '</div>';
  }

  /**
   * The gear's zen row, the same on every page that has a gear. The current
   * state is read from the body class rather than from the page's snapshot,
   * so no page has to carry zen through its state builder.
   */
  function renderZenOption() {
    const enabled = document.body.classList.contains('zen');
    return {
      label: 'Zen',
      html: renderViewOptionChoices('set-zen-mode', [['off', 'Off'], ['on', 'On']], enabled ? 'on' : 'off', 'Zen mode'),
    };
  }

  /**
   * The gear's theme row, directly above zen on every page with a gear: one
   * button naming the theme in use, which opens Choose Theme… to preview the
   * others on the open pages. The name is written when the page is built,
   * and a new theme redraws the page.
   */
  function renderThemeOption() {
    const name = ${JSON.stringify(deckardThemeNames[theme])};
    return {
      label: 'Theme',
      html: '<button type="button" class="theme-choice" data-action="choose-theme" aria-label="Theme: ' + escapeHtml(name) + '. Choose another">' + escapeHtml(name) + '…</button>',
    };
  }

  /**
   * Close the gear's menu on a click outside it, and on Escape, handing focus
   * back to the gear. Call once, before the page's own listeners, so a click
   * that redraws the page is seen while its target is still in the menu.
   *
   * The zen row is handled here rather than by each page: it posts through
   * the shared vscode handle, and the host's own configuration listener
   * redraws the page, so a page needs no handler of its own.
   */
  function installViewOptions() {
    document.addEventListener('click', function (event) {
      const zen = event.target && event.target.closest ? event.target.closest('[data-action="set-zen-mode"]') : undefined;
      if (zen) {
        vscode.postMessage({ type: 'setZenMode', enabled: zen.dataset.value === 'on' });
      }
      const theme = event.target && event.target.closest ? event.target.closest('[data-action="choose-theme"]') : undefined;
      if (theme) {
        vscode.postMessage({ type: 'chooseTheme' });
      }
      const inside = event.target && event.target.closest ? event.target.closest('.view-options') : undefined;
      document.querySelectorAll('.view-options[open]').forEach(function (options) {
        if (options !== inside) options.open = false;
      });
    });
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      const options = document.querySelector('.view-options[open]');
      if (!options) return;
      options.open = false;
      options.querySelector('summary').focus();
    });
  }

  /** Writes a task timestamp as the YYYY-MM-DD form the note uses. */
  function formatTaskDate(timestamp) {
    const date = new Date(timestamp);
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  /**
   * One task in a task list: its checkbox, title, and where it is written.
   * item is a DashboardTask. options.draggable marks a row that can be
   * ranked; options.titleDisplay is the tagTitleDisplayMode.
   */
  /**
   * Said on a parked result: it stays searchable, and is left out of the
   * lists of things to do. A plain span, so its title is not on a control.
   */
  function renderParkedLabel() {
    return '<span class="parked-label" title="Parked: left out of the Tasks view, the Task board, and Related Notes.">Parked</span>';
  }

  function renderTaskListRow(item, options) {
    const task = item.task;
    const settings = options || {};
    // The host words an open task's due date beside today, "Overdue 15 days
    // · 2026-09-08", so the state is in the text and not in the color alone.
    // A done task keeps its date as written.
    const dueDate = item.dueLabel
      ? '<span class="due-date ' + (item.overdue ? 'overdue' : item.stale ? 'stale' : '') + '">' + escapeHtml(item.dueLabel) + '</span>'
      : (task.dueText
        ? '<span class="due-date">Due ' + escapeHtml(task.dueText) + '</span>'
        : '');
    // As written, not in capitals: the working labels read as written
    // everywhere else since the UX pass, and these were the last three.
    const scheduled = task.scheduledAt !== undefined
      ? '<span class="task-detail">Scheduled ' + escapeHtml(formatTaskDate(task.scheduledAt)) + '</span>'
      : '';
    const priority = renderPriorityBadge(task.priority);
    const recurrence = task.recurrence
      ? '<span class="task-detail">Repeats ' + escapeHtml(task.recurrence) + '</span>'
      : '';
    const steps = item.stepsLabel
      ? '<span class="task-detail task-steps">' + escapeHtml(item.stepsLabel) + '</span>'
      : '';
    const title = settings.titleDisplay === 'separate' ? item.renderedTitle : renderTaskTitle(item.renderedTitle, item.titleTags);
    // The headings above the task, tags stripped, under the file and line:
    // the same two lines a note card and the sidebar show.
    const taskPath = renderHeadingPath(item.headingPath, item.fileName, '');
    return '<div class="row task-row' + (task.completed ? ' completed' : '') + (settings.draggable ? ' is-draggable' : '') + '" draggable="false" tabindex="0" data-task-id="' + escapeHtml(task.id) + '" data-file-path="' + escapeHtml(task.filePath) + '" data-line="' + task.lineNumber + '">'
      // A row that cannot be completed from here, such as a repeat's later
      // date, draws its own mark where the checkbox goes.
      + (settings.leading !== undefined ? settings.leading : '<input type="checkbox" data-action="toggle-task" data-task-id="' + escapeHtml(task.id) + '" ' + (task.completed ? 'checked' : '') + ' aria-label="Toggle ' + escapeHtml(task.title) + '">')
      + '<div><div class="task-title">' + title + '</div><div class="task-meta">' + (item.parked ? renderParkedLabel() : '') + dueDate + scheduled + priority + recurrence + steps + '<span class="task-source">' + escapeHtml(formatSourceLocation(item.fileName, task.lineNumber)) + '</span>' + (taskPath ? '<span class="task-source heading-path">' + taskPath + '</span>' : '') + '</div></div>'
      + (settings.trailing || '')
      + '</div>';
  }

  /**
   * The Notes and Tasks tabs over a search's results. tabs is a list of
   * { id, label, count }; each button carries data-action="set-result-tab".
   */
  function renderResultTabs(tabs, active, label) {
    // One tab stop for the list, arrow keys between the tabs, and each tab
    // naming the panel it shows: what the tab role promises a screen reader.
    return '<div class="overview-tabs-row"><div class="segmented overview-tabs" role="tablist" aria-label="' + escapeHtml(label) + '">' + tabs.map(function (tab) {
      const selected = tab.id === active;
      return '<button class="' + (selected ? 'active' : '') + '" id="' + resultTabId(tab.id) + '" data-action="set-result-tab" data-tab="' + escapeHtml(tab.id) + '" role="tab" aria-selected="' + selected + '" aria-controls="' + resultPanelId(tab.id) + '" tabindex="' + (selected ? '0' : '-1') + '">' + escapeHtml(tab.label) + ' (<span data-search-count="' + escapeHtml(tab.id) + '">' + tab.count + '</span>)</button>';
    }).join('') + '</div></div>';
  }

  /** The id of a result tab, and of the panel it shows. */
  function resultTabId(id) { return 'result-tab-' + escapeHtml(id); }
  function resultPanelId(id) { return 'result-panel-' + escapeHtml(id); }

  /** The attributes a result tab's panel carries, so the two name each other. */
  function resultPanelAttributes(id) {
    return ' id="' + resultPanelId(id) + '" role="tabpanel" aria-labelledby="' + resultTabId(id) + '"';
  }

  /**
   * Rows a reader ranks by dragging them, or by Move to top and Move to
   * bottom on their context menu. Call once; listeners sit on the document,
   * so a page may redraw its rows freely.
   *
   *   kinds       { name: { selector, key, edgeLabels } }: a row's
   *               selector, the dataset key that names it, such as taskId,
   *               and optionally the menu's two labels, first then last
   *   canRank(kind)          whether rows of this kind can be ranked now
   *   reorder(kind, key, targetKey, before, placeholder)
   *               ranks key next to targetKey; returns true when it did
   *   move(kind, key, toTop) ranks key first or last
   *   menuActions(kind, key) optional; more menu buttons, each with
   *               data-context-action
   *   onMenuAction(action, kind, key) optional; runs one of those
   */
  /** One row of a context menu, as every menu draws it. */
  function renderMenuItem(action, label) {
    return '<button type="button" class="menu-item" role="menuitem" data-context-action="' + escapeHtml(action) + '"><span class="menu-label">' + escapeHtml(label) + '</span></button>';
  }

  let rankMenu;
  let rankMenuKind;
  let rankMenuKey;

  function closeRankMenu() {
    const wasOpen = Boolean(rankMenu && !rankMenu.hidden);
    if (rankMenu) rankMenu.hidden = true;
    rankMenuKind = undefined;
    rankMenuKey = undefined;
    if (wasOpen) returnFocusFromMenu();
  }

  function installRankedRows(options) {
    const names = Object.keys(options.kinds);
    const rowSelector = names.map(function (name) { return options.kinds[name].selector; }).join(', ');
    const keyAttributes = names.map(function (name) {
      return 'data-' + options.kinds[name].key.replace(/[A-Z]/g, function (letter) { return '-' + letter.toLowerCase(); });
    }).concat(['data-file-path', 'data-line']);
    let drag;
    let ghost;
    let placeholder;
    let dropTarget;
    let dropBefore = true;
    let suppressClick = false;

    function kindOf(row) {
      return names.find(function (name) { return row.matches(options.kinds[name].selector); });
    }
    function keyOf(row, kind) {
      return row.dataset[options.kinds[kind].key];
    }
    function strip(element) {
      element.classList.remove('is-dragging');
      element.removeAttribute('draggable');
      keyAttributes.forEach(function (attribute) { element.removeAttribute(attribute); });
      element.setAttribute('aria-hidden', 'true');
    }
    function clearPreview() {
      if (ghost) ghost.remove();
      if (placeholder) placeholder.remove();
      ghost = undefined;
      placeholder = undefined;
      dropTarget = undefined;
      document.querySelectorAll('.is-dragging').forEach(function (row) { row.classList.remove('is-dragging'); });
    }
    function begin(event) {
      clearPreview();
      const row = drag.row;
      ghost = row.cloneNode(true);
      strip(ghost);
      ghost.classList.add('drag-ghost');
      const bounds = row.getBoundingClientRect();
      ghost.style.width = bounds.width + 'px';
      ghost.style.height = bounds.height + 'px';
      document.body.appendChild(ghost);
      placeholder = row.cloneNode(true);
      strip(placeholder);
      placeholder.removeAttribute('tabindex');
      placeholder.classList.add('drag-placeholder');
      placeholder.querySelectorAll('[data-action], button, input, [tabindex]').forEach(function (element) {
        element.removeAttribute('data-action');
        keyAttributes.forEach(function (attribute) { element.removeAttribute(attribute); });
        element.setAttribute('tabindex', '-1');
      });
      if (row.parentElement) row.parentElement.insertBefore(placeholder, row);
      row.classList.add('is-dragging');
      drag.active = true;
      follow(event.clientX, event.clientY);
    }
    function follow(clientX, clientY) {
      if (ghost) {
        ghost.style.left = clientX + 12 + 'px';
        ghost.style.top = clientY + 12 + 'px';
      }
      const element = document.elementFromPoint(clientX, clientY);
      const row = element ? element.closest(options.kinds[drag.kind].selector) : undefined;
      if (!row || row === drag.row || keyOf(row, drag.kind) === drag.key) return;
      const bounds = row.getBoundingClientRect();
      const before = clientY < bounds.top + bounds.height / 2;
      if (dropTarget === row && dropBefore === before) return;
      dropTarget = row;
      dropBefore = before;
      const insertionPoint = before ? row : row.nextSibling;
      if (placeholder && row.parentElement && insertionPoint !== placeholder) row.parentElement.insertBefore(placeholder, insertionPoint);
    }
    function finish(event, canceled) {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const current = drag;
      if (current.row.hasPointerCapture && current.row.hasPointerCapture(event.pointerId)) current.row.releasePointerCapture(event.pointerId);
      if (!current.active) {
        drag = undefined;
        return;
      }
      let dropped = false;
      if (!canceled) {
        follow(event.clientX, event.clientY);
        const targetKey = dropTarget ? keyOf(dropTarget, current.kind) : undefined;
        dropped = Boolean(targetKey) && targetKey !== current.key && options.canRank(current.kind)
          && options.reorder(current.kind, current.key, targetKey, dropBefore, placeholder) === true;
        suppressClick = true;
      }
      // A dropped row takes the placeholder's place until the host answers.
      if (dropped && placeholder && placeholder.parentElement) {
        placeholder.parentElement.insertBefore(current.row, placeholder);
        current.row.classList.remove('is-dragging');
      }
      clearPreview();
      drag = undefined;
    }
    /** Moves a row one place, past the row of its kind above or below it. */
    function step(kind, key, up) {
      if (!options.canRank(kind)) return;
      const rows = Array.prototype.filter.call(document.querySelectorAll(options.kinds[kind].selector), function (candidate) {
        return !candidate.classList.contains('drag-placeholder') && !candidate.classList.contains('drag-ghost');
      });
      const row = rows.find(function (candidate) { return keyOf(candidate, kind) === key; });
      const at = rows.indexOf(row);
      const target = rows[at + (up ? -1 : 1)];
      if (!row || !target) return;
      // The row stands in for the drop placeholder, which says which group a
      // row lands in; one step never leaves its group.
      if (options.reorder(kind, key, keyOf(target, kind), up, row) === true) {
        announce('Moved ' + (up ? 'up' : 'down') + '.');
      }
    }

    function openMenu(event, row) {
      const kind = kindOf(row);
      const key = kind ? keyOf(row, kind) : undefined;
      if (!key) return;
      const actions = options.menuActions ? options.menuActions(kind, key) : [];
      if (options.canRank(kind)) {
        const labels = options.kinds[kind].edgeLabels || ['Move to top', 'Move to bottom'];
        // One step at a time as well as to either end, so any place in the
        // order is reachable without dragging (WCAG 2.5.7).
        actions.push(renderMenuItem('up', 'Move up'));
        actions.push(renderMenuItem('down', 'Move down'));
        actions.push(renderMenuItem('top', labels[0]));
        actions.push(renderMenuItem('bottom', labels[1]));
      }
      if (!actions.length) return;
      event.preventDefault();
      closeRankMenu();
      if (!rankMenu) {
        rankMenu = document.createElement('div');
        rankMenu.setAttribute('id', 'rank-context-menu');
        rankMenu.setAttribute('class', 'rank-context-menu popover');
        rankMenu.setAttribute('role', 'menu');
        document.body.appendChild(rankMenu);
      }
      rankMenuKind = kind;
      rankMenuKey = key;
      rankMenu.innerHTML = actions.join('');
      rankMenu.hidden = false;
      const bounds = rankMenu.getBoundingClientRect();
      rankMenu.style.left = Math.max(8, Math.min(event.clientX, window.innerWidth - bounds.width - 8)) + 'px';
      rankMenu.style.top = Math.max(8, Math.min(event.clientY, window.innerHeight - bounds.height - 8)) + 'px';
      rankMenu.querySelector('button').focus();
    }

    document.addEventListener('click', function (event) {
      const chosen = event.target.closest('#rank-context-menu [data-context-action]');
      if (chosen) {
        const kind = rankMenuKind;
        const key = rankMenuKey;
        const action = chosen.dataset.contextAction;
        closeRankMenu();
        if (!kind || !key) return;
        if (action === 'top' || action === 'bottom') {
          if (options.canRank(kind)) options.move(kind, key, action === 'top');
        } else if (action === 'up' || action === 'down') {
          step(kind, key, action === 'up');
        } else if (options.onMenuAction) {
          options.onMenuAction(action, kind, key);
        }
        return;
      }
      if (rankMenu && !event.target.closest('#rank-context-menu')) closeRankMenu();
      // The click a drag ends with is not a click on the row.
      if (suppressClick) {
        suppressClick = false;
        if (event.target.closest(rowSelector)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }
    }, true);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && rankMenu && !rankMenu.hidden) {
        closeRankMenu();
        return;
      }
      // Alt+Up and Alt+Down move the focused row one place.
      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && event.target.matches && event.target.matches(rowSelector)) {
        const kind = kindOf(event.target);
        if (kind) {
          event.preventDefault();
          step(kind, keyOf(event.target, kind), event.key === 'ArrowUp');
        }
        return;
      }
      // Reordering was a drag or a right-click, so a keyboard could reach
      // neither. The same menu opens on the focused row with the menu key,
      // Shift+F10, or Alt+Enter, at the row itself.
      const isMenuKey = event.key === 'ContextMenu'
        || (event.key === 'F10' && event.shiftKey)
        || (event.key === 'Enter' && event.altKey);
      // The shared listener raises a contextmenu event for these keys first,
      // which this menu's own listener answers; nothing to do twice.
      if (!isMenuKey || event.defaultPrevented) return;
      const row = event.target.closest ? event.target.closest(rowSelector) : undefined;
      if (!row) return;
      const bounds = row.getBoundingClientRect();
      openMenu({
        preventDefault: function () { event.preventDefault(); },
        clientX: bounds.left + 12,
        clientY: bounds.top + bounds.height,
      }, row);
    });
    document.addEventListener('contextmenu', function (event) {
      const row = event.target.closest(rowSelector);
      if (row) openMenu(event, row);
    });
    document.addEventListener('pointerdown', function (event) {
      suppressClick = false;
      const row = event.target.closest(rowSelector);
      if (!row || event.button !== 0 || drag) return;
      // A control inside a row, such as a widget's gear, keeps its click: a
      // drag would capture the pointer and take the click away from it.
      if (event.target.closest('button, input, select, textarea, a, summary, label, [data-action]')) return;
      const kind = kindOf(row);
      if (!kind || !row.classList.contains('is-draggable') || !options.canRank(kind)) return;
      drag = { row: row, kind: kind, key: keyOf(row, kind), pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false };
      if (row.setPointerCapture) row.setPointerCapture(event.pointerId);
    });
    document.addEventListener('pointermove', function (event) {
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!drag.active) {
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
        begin(event);
      }
      event.preventDefault();
      follow(event.clientX, event.clientY);
    });
    document.addEventListener('pointerup', function (event) { finish(event, false); });
    document.addEventListener('pointercancel', function (event) { finish(event, true); });
  }

  /**
   * Moves key before or after targetKey in keys, for a drag that ranked it.
   * Returns the new order, or undefined when either is missing.
   */
  function rankKeys(keys, key, targetKey, before) {
    const from = keys.indexOf(key);
    const to = keys.indexOf(targetKey);
    if (from < 0 || to < 0) return undefined;
    const next = keys.slice();
    const insertion = to + (before ? 0 : 1);
    next.splice(from, 1);
    next.splice(insertion > from ? insertion - 1 : insertion, 0, key);
    return next;
  }

  /** Moves key to the start or end of keys. */
  function moveKeyToEdge(keys, key, toTop) {
    if (keys.indexOf(key) < 0) return undefined;
    const next = keys.filter(function (candidate) { return candidate !== key; });
    if (toTop) next.unshift(key);
    else next.push(key);
    return next;
  }

  /**
   * The page numbers to offer, with a gap where numbers are left out.
   *
   * The first and last pages are always there, because they are where a
   * reader goes back to, and the pages either side of the current one,
   * because they are the next step. A gap is a null.
   */
  function pageNumbers(current, pageCount) {
    if (pageCount <= 7) {
      return Array.from({ length: pageCount }, function (_, index) { return index + 1; });
    }
    const wanted = [1, pageCount, current, current - 1, current + 1];
    const pages = wanted
      .filter(function (page) { return page >= 1 && page <= pageCount; })
      .filter(function (page, index, all) { return all.indexOf(page) === index; })
      .sort(function (left, right) { return left - right; });
    const withGaps = [];
    pages.forEach(function (page, index) {
      if (index > 0 && page - pages[index - 1] > 1) withGaps.push(null);
      withGaps.push(page);
    });
    return withGaps;
  }

  /**
   * Previous, the page numbers, and Next: the control that walks a list.
   *
   * Every list that pages uses this one, so a search page and a widget on
   * Home are walked the same way. \`action\` and \`attributes\` say who is being
   * paged, and \`noun\` names the entries for a screen reader.
   */
  function renderPageSteps(paging, action, attributes, noun) {
    if (!paging || paging.pageCount <= 1) return '';
    const own = attributes ? ' ' + attributes : '';
    const step = function (page, label, enabled) {
      return '<button class="page-step" data-action="' + action + '" data-page="' + page + '"' + own
        + (enabled ? '' : ' disabled')
        + ' aria-label="' + label + ' page of ' + escapeHtml(noun) + '">' + label + '</button>';
    };
    const numbers = pageNumbers(paging.page, paging.pageCount).map(function (page) {
      if (page === null) return '<span class="page-gap" aria-hidden="true">…</span>';
      const current = page === paging.page;
      return '<button class="page-number' + (current ? ' is-current' : '') + '" data-action="' + action + '" data-page="' + page + '"' + own
        + (current ? ' aria-current="page"' : '')
        + ' aria-label="Page ' + page + ' of ' + escapeHtml(noun) + '">' + page + '</button>';
    }).join('');
    return step(paging.page - 1, 'Previous', paging.page > 1)
      + numbers
      + step(paging.page + 1, 'Next', paging.page < paging.pageCount);
  }

  /** "271–300 of 3760", the part of a list a page is showing. */
  function describePageRange(paging) {
    if (!paging || !paging.total) return '';
    const first = (paging.page - 1) * paging.size + 1;
    const last = Math.min(paging.page * paging.size, paging.total);
    return first + '\u2013' + last + ' of ' + paging.total;
  }
`;
}

/**
 * The search box's behavior, inserted in a page script after
 * getComponentScript(), whose helpers it uses.
 *
 * Like getComponentScript(), this string is interpolated into a template
 * literal, so a backslash meant for the output is written doubled here.
 */
export function getQueryEditorScript(): string {
  return `
  /**
   * One search box: the query bar and its completions, the builder, the
   * search's removable terms, and the facets that narrow its results.
   *
   * The host owns the applied search. The editor keeps only what is being
   * typed and any builder rows not finished yet, and hands a finished search
   * back through options.apply.
   *
   *   getState()     the host's QueryViewState for this search, if any
   *   render()       redraws the page, which draws the editor's parts
   *   apply(text)    runs a search typed, built, or refined here
   *   clear()        empties the search
   *   onDraft(text)  optional; hears every keystroke, so a page can filter
   *                  what it already shows by the plain words being typed
   *   placeholder()  the empty box's hint
   *   label          what the box searches, for assistive technology
   *   clearedText()  optional; what Clear leaves in the box, such as the
   *                  page's own tag on a tag overview. Empty unless given;
   *                  Clear is disabled while the box holds only this.
   *   resultKinds    optional; what the search can find, notes and tasks
   *                  unless a page lists only one, such as ['tasks']
   *   refineElsewhere() optional; true while the sidebar shows this search's
   *                  Refine options, so the page shows a line in their place
   *   actions(hasText) optional; the page's own buttons for the bar, such as
   *                  Save. A button that needs text carries
   *                  data-query-needs-text, and is always drawn, disabled
   *                  until there is text, so the bar never shifts under the
   *                  pointer while a search is typed.
   */
  function createQueryEditor(options) {
    const DEFAULT_OPERATORS = {
      tag: ['eq', 'neq'], link: ['eq', 'neq'], text: ['contains', 'notContains', 'eq', 'neq'], is: ['eq', 'neq'],
      task: ['eq', 'neq'], due: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'], scheduled: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
      start: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'], done: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
      priority: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'], has: ['eq', 'neq'], kind: ['eq', 'neq'],
      file: ['eq', 'neq', 'contains', 'notContains'], path: ['eq', 'neq', 'contains', 'notContains'], in: ['eq', 'neq'],
      created: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'], updated: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
    };
    const SYMBOL_OPERATORS = { '=': 'eq', '!=': 'neq', '~': 'contains', '!~': 'notContains', '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte' };
    const OPERATOR_LABELS = { eq: '=', neq: '!=', contains: '~', notContains: '!~', gt: '>', gte: '>=', lt: '<', lte: '<=' };
    /** Hover text, since a symbol alone does not say what it compares. */
    const OPERATOR_DESCRIPTIONS = { eq: 'is', neq: 'is not', contains: 'contains', notContains: 'does not contain', gt: 'after', gte: 'on or after', lt: 'before', lte: 'on or before' };
    /** The text field matches whole words with = and any substring with ~. */
    const TEXT_OPERATOR_DESCRIPTIONS = { eq: 'is the whole word', neq: 'does not have the whole word' };
    /** Priority compares rank, not time. */
    const PRIORITY_OPERATOR_DESCRIPTIONS = { gt: 'above', gte: 'at or above', lt: 'below', lte: 'at or below' };
    const FIELD_PLACEHOLDERS = {
      tag: '#project/atlas', link: 'Atlas#Decision', text: 'vendor review', is: 'open', task: 'open', due: 'today', scheduled: 'today',
      start: 'today', done: '7d', priority: 'high', has: 'due', kind: 'project', file: '2026-09-*.md',
      path: 'notes/*', in: 'notes/projects', created: '2026-09-13', updated: '30d',
    };
    /** Fields written as one field:value token. */
    const SHORTHAND_FIELDS = ['is', 'has', 'in'];

    /**
     * A whole search waiting to be run, such as one the builder wrote or Clear
     * left; undefined means the box shows the applied search and the entry.
     */
    let draft;
    /** The next term, being typed in the field after the chips. */
    let entry = '';
    /** The entry the last search that ran was written with. */
    let lastEntry = '';
    /** The entry to keep once the host answers the search that ran. */
    let entryAfterRun = '';
    /** The applied search the editor last saw. */
    let appliedSeen;
    /** Set between applying a search and seeing the host's answer. */
    let awaitingApply = false;
    /** Refine facets opened past their first five, kept through redraws. */
    const expandedFacets = new Set();
    /** Fires a second into a search that has not come back. */
    let searchingTimer;
    let builderOpen = false;
    /**
     * Local builder rows. A row not finished yet contributes nothing to the
     * search text, so the rows cannot come straight from the host's parse;
     * the draft owns them until they turn into text the host can parse.
     */
    let builderDraft;
    /** The applied search the rows were last reconciled with. */
    let builderSourceText;
    /** A builder value input to focus once the next render settles. */
    let pendingBuilderFocus;
    let restoreFocus = false;
    /**
     * Set while the page redraws around the box. A redraw takes the field out
     * of the document, which the browser reports as the reader leaving it,
     * and what was typed would be let go as if they had clicked away. The
     * draft's own results arriving is the commonest redraw of all.
     */
    let redrawing = false;
    /** Where the caret sat when the redraw began, to put it back. */
    let caretAtRedraw;
    /** Set while the caret is being put back, so the list stays closed. */
    let suppressFocusSuggestions = false;
    /** Set when the reader asked for the box itself, such as by pressing /. */
    let openSuggestionsOnRestore = false;
    let suggestionItems = [];
    let suggestionIndex = -1;
    /** Which input the completion list belongs to, if any. */
    let suggestionHostKey;
    /** The partial text the completion list is filtering on. */
    let suggestionToken = '';

    function query() { return options.getState() || {}; }
    function suggestions() { return query().suggestions || {}; }
    function appliedText() { return query().text || ''; }
    function currentText() { return draft === undefined ? combineQuery(appliedText(), entry) : draft; }
    function operatorsFor(field) {
      const table = suggestions().operators || DEFAULT_OPERATORS;
      return table[field] || DEFAULT_OPERATORS[field] || ['eq'];
    }
    function fieldNames() {
      const listed = (suggestions().fields || []).map(function (field) { return field.value; });
      return listed.length ? listed : Object.keys(DEFAULT_OPERATORS);
    }
    function clearedText() {
      return options.clearedText ? String(options.clearedText() || '') : '';
    }
    /** Why Clear cannot act: nothing is in the box, or only the page's own tag. */
    function clearReason() {
      return clearedText().trim() ? 'Only this page\\'s own tag is left' : 'The search is already empty';
    }
    /** Whether Clear would change the search. */
    function canClear(text) {
      return String(text || '').trim() !== clearedText().trim();
    }
    function placeholder() {
      return typeof options.placeholder === 'function' ? options.placeholder() : (options.placeholder || '');
    }

    /** The bar, its status line, the search's terms, and the builder. */
    /**
     * statusControls is the page's own HTML for the line under the box, such
     * as a sort control, kept there so it takes no row of its own.
     */
    function renderBar(statusControls) {
      const value = currentText();
      const hasText = Boolean(String(value).trim());
      const errors = (query().diagnostics || []).filter(function (diagnostic) { return diagnostic.severity === 'error'; });
      const terms = renderChips();
      const status = errors.length
        ? '<span class="query-error" role="alert">' + escapeHtml(errors[0].message) + '</span>'
        : '<span class="query-hint">Enter searches. Words, #tags, is:open, has:due, in:folder; AND, OR, NOT. Press / to search.</span>';
      const label = options.label || 'Search';
      return '<section class="query-workspace' + (searchInFlight ? ' is-searching' : '') + '"' + (hasText ? ' data-has-text' : '') + ' aria-label="' + escapeHtml(label) + '">'
        + '<div class="query-bar-row">'
        + '<span class="query-input-shell query-bar-shell' + (errors.length ? ' invalid' : '') + '" data-query-text="' + escapeHtml(value) + '">' + terms + '<input class="query-input' + (errors.length ? ' invalid' : '') + '" type="text" data-action="query-input" data-suggest-key="query" spellcheck="false" autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="suggestions-query" aria-label="' + escapeHtml(terms ? label + ': add a term' : label) + '" placeholder="' + escapeHtml(terms ? '' : placeholder()) + '" value="' + escapeHtml(entry) + '"><div class="query-suggestions popover is-dropdown" id="suggestions-query" data-suggestions="query" hidden role="listbox" aria-label="Suggestions"></div></span>'
        + '<button class="query-apply" data-action="apply-query" data-tip="Run this search">Search</button>'
        + '<button data-action="clear-query" data-query-clears data-tip="Clear the search" data-tip-disabled="' + escapeHtml(clearReason()) + '"' + (canClear(value) ? '' : ' aria-disabled="true"') + '>Clear</button>'
        + (options.actions ? options.actions(hasText) : '')
        + '</div>'
        + '<div class="query-status"><button class="query-builder-toggle" data-action="toggle-builder" aria-expanded="' + builderOpen + '" data-tip="Build the search one condition at a time">' + (builderOpen ? 'Hide builder' : 'Builder') + '</button>' + status + (statusControls || '') + '</div>'
        + renderBuilder()
        + '</section>';
    }

    /**
     * The search's words, with where each starts and ends: a tag, written as
     * #tag, -#tag, tag:#tag, or tag = #tag; an operator; a parenthesis; or
     * anything else. Quoted text is one word.
     */
    function scanQuery(text) {
      const tokens = [];
      const pattern = /-?\\[\\[[^\\]]*(?:\\]\\]?)?|"(?:[^"\\\\]|\\\\.)*"?|'[^']*'?|[()]|[^\\s()]+/g;
      let match;
      while ((match = pattern.exec(text))) {
        tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
      }
      const pieces = [];
      const unquote = function (value) { return value.replace(/^["']|["']$/g, ''); };
      for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        const word = token.text;
        if (/^-?\\[\\[/.test(word)) {
          // [[Atlas plan]] is one term, spaces and all.
          pieces.push({ kind: 'link', start: token.start, end: token.end, negated: word.charAt(0) === '-' });
          continue;
        }
        let tag = /^(-|!)?([#@][^\\s()"']+)$/.exec(unquote(word));
        if (tag) {
          pieces.push({ kind: 'tag', start: token.start, end: token.end, negated: Boolean(tag[1]) });
          continue;
        }
        tag = /^(-)?tags?(:|!?=)(.+)$/i.exec(word);
        if (tag && /^[#@]/.test(unquote(tag[3]))) {
          pieces.push({ kind: 'tag', start: token.start, end: token.end, negated: Boolean(tag[1]) || tag[2] === '!=' });
          continue;
        }
        const operator = tokens[index + 1];
        const value = tokens[index + 2];
        if (/^tags?$/i.test(word) && operator && value && /^!?=$/.test(operator.text) && /^[#@]/.test(unquote(value.text))) {
          pieces.push({ kind: 'tag', start: token.start, end: value.end, negated: operator.text === '!=' });
          index += 2;
          continue;
        }
        if (/^(and|or|not|&&|\\|\\|)$/i.test(word)) {
          pieces.push({ kind: 'op', start: token.start, end: token.end });
          continue;
        }
        pieces.push({ kind: word === '(' || word === ')' ? 'paren' : 'word', start: token.start, end: token.end });
      }
      return pieces;
    }

    /** A term's text, with its AND, OR, and NOT in their own color. */
    function renderTermText(text) {
      let html = '';
      let offset = 0;
      scanQuery(text).forEach(function (piece) {
        if (piece.kind !== 'op' && piece.kind !== 'paren') return;
        html += escapeHtml(text.slice(offset, piece.start))
          + '<span class="' + (piece.kind === 'op' ? 'query-op' : 'query-paren') + '">' + escapeHtml(text.slice(piece.start, piece.end).toUpperCase()) + '</span>';
        offset = piece.end;
      });
      return html + escapeHtml(text.slice(offset));
    }

    /**
     * The applied search as chips, each removing its own term, joined by
     * the word between them. A group is a bordered run of its own chips
     * with a remove of its own at the end, nested as the builder has it,
     * so a condition inside a group goes alone and the group goes whole.
     */
    function renderChips() {
      const text = appliedText().trim();
      if (!text) return '';
      const terms = (query().terms || []).length ? query().terms : [{ text: text, without: '' }];
      return renderTermChips(terms, query().termsJoin || 'and');
    }

    function renderTermChips(terms, join) {
      const word = join === 'or' ? 'OR' : 'AND';
      return terms.map(function (term, index) {
        return (index > 0 ? '<span class="query-chip-join" aria-hidden="true">' + word + '</span>' : '') + renderTermChip(term);
      }).join('');
    }

    function renderTermChip(term) {
      // Words show as the text condition they run.
      const label = term.label || term.text;
      if (term.items && term.items.length) {
        // The frame removes the group, as a chip's whole face removes its
        // term; a chip inside is found first by the click, so it goes alone.
        return '<span class="query-chip-group' + (term.negated ? ' is-negated' : '') + '" role="group" aria-label="' + escapeHtml(label) + '" data-action="remove-term" data-without="' + escapeHtml(term.without) + '">'
          + (term.negated ? '<span class="query-chip-join" aria-hidden="true">NOT</span>' : '')
          + renderTermChips(term.items, term.join)
          + '<button type="button" class="query-chip query-chip-group-remove" data-action="remove-term" data-without="' + escapeHtml(term.without) + '" aria-label="Remove the group ' + escapeHtml(label) + '" data-tip="Remove the group ' + escapeHtml(label) + '"><span class="query-chip-remove" aria-hidden="true">&#215;</span></button>'
          + '</span>';
      }
      const pieces = scanQuery(term.text);
      const tag = pieces.length === 1 && pieces[0].kind === 'tag' ? pieces[0] : undefined;
      // A link is one chip, struck through when negated, as a tag is.
      const link = pieces.length === 1 && pieces[0].kind === 'link' ? pieces[0] : undefined;
      const className = 'query-chip' + (tag ? ' is-tag' : '') + (term.negated || (tag && tag.negated) || (link && link.negated) ? ' is-negated' : '');
      return '<button type="button" class="' + className + '" data-action="remove-term" data-without="' + escapeHtml(term.without) + '" aria-label="Remove ' + escapeHtml(label) + '" data-tip="Remove ' + escapeHtml(label) + '" data-tip-overflow="' + escapeHtml(label) + '"><span class="query-chip-label">' + renderTermText(label) + '</span><span class="query-chip-remove" aria-hidden="true">&#215;</span></button>';
    }

    /**
     * The applied search with a new term added by AND. A term whose top level
     * is an OR is wrapped, so it adds one condition.
     */
    function combineQuery(applied, extra) {
      const text = String(applied || '').trim();
      const addition = joinTags(String(extra || '').trim());
      if (!addition) return text;
      if (!text) return addition;
      const wrapped = /(^|\\s)(or|\\|\\|)(\\s|$)/i.test(addition) && !/^\\(.*\\)$/.test(addition) ? '(' + addition + ')' : addition;
      return (query().canAppend === false ? '(' + text + ')' : text) + ' AND ' + wrapped;
    }

    /**
     * Writes AND between two tags that stand side by side, so a search of
     * several tags reads as what it does.
     */
    function joinTags(text) {
      const value = String(text);
      const pieces = scanQuery(value);
      let result = '';
      let offset = 0;
      pieces.forEach(function (piece, index) {
        const previous = pieces[index - 1];
        if (piece.kind === 'tag' && previous && previous.kind === 'tag' && !value.slice(previous.end, piece.start).trim()) {
          result += value.slice(offset, previous.end) + ' AND ';
          offset = piece.start;
        }
      });
      return result + value.slice(offset);
    }

    /** Set the entry, in the field and in the state, without a redraw. */
    function setEntry(input, text) {
      entry = String(text || '');
      draft = undefined;
      if (input && input.value !== entry) input.value = entry;
      syncTextButtons(currentText());
      if (options.onDraft) options.onDraft(currentText());
    }

    // Text typed and not added as a term is let go when the search box loses
    // focus, as a multi-select does; moving to the box's own buttons keeps it.
    let pointerInWorkspace = false;
    document.addEventListener('mousedown', function (event) {
      pointerInWorkspace = Boolean(event.target && event.target.closest && event.target.closest('.query-workspace'));
    }, true);
    document.addEventListener('mouseup', function () {
      setTimeout(function () { pointerInWorkspace = false; }, 0);
    }, true);
    document.addEventListener('focusout', function (event) {
      const target = event.target;
      if (redrawing) return;
      if (!target || !target.dataset || target.dataset.action !== 'query-input' || !entry) return;
      const next = event.relatedTarget;
      if (pointerInWorkspace || (next && next.closest && next.closest('.query-workspace'))) return;
      closeSuggestions();
      setEntry(target, '');
    }, true);

    /**
     * Enable the bar's buttons that need text as soon as there is some, in
     * place, rather than redrawing the bar while a search is typed.
     */
    function syncTextButtons(text) {
      const hasText = Boolean(String(text || '').trim());
      // aria-disabled rather than disabled: the button keeps its place in
      // the Tab order, and says why it cannot act when focused.
      const enable = function (button, enabled) {
        if (enabled) button.removeAttribute('aria-disabled');
        else button.setAttribute('aria-disabled', 'true');
        if (button.matches('[data-query-clears]')) button.setAttribute('data-tip-disabled', clearReason());
      };
      document.querySelectorAll('[data-query-needs-text]').forEach(function (button) { enable(button, hasText); });
      document.querySelectorAll('[data-query-clears]').forEach(function (button) { enable(button, canClear(text)); });
      document.querySelectorAll('.query-bar-shell').forEach(function (shell) { shell.setAttribute('data-query-text', String(text || '')); });
    }

    /** Whether the applied search ran and matched nothing of any kind. */
    function matchedNothing() {
      if (!appliedText().trim()) return false;
      const counts = query().matchCounts;
      if (!counts) return false;
      return (options.resultKinds || ['notes', 'tasks']).every(function (kind) { return !counts[kind]; });
    }

    /**
     * Ways out of a search that found nothing. Narrowing is useless here, so
     * the Refine row offers the two ways to widen instead: drop the term that
     * was added last, or go back to what the page opened with.
     */
    function renderRecovery() {
      const terms = query().terms || [];
      const last = terms.length > 1 ? terms[terms.length - 1] : undefined;
      const label = last ? String(last.label || last.text) : '';
      const drop = last
        ? '<button data-action="remove-term" data-without="' + escapeHtml(last.without) + '" data-tip="Run this search without its last term">Drop ' + escapeHtml(label) + '</button>'
        : '';
      const clear = canClear(currentText())
        ? '<button data-action="clear-query" data-query-clears data-tip="Clear the search">Clear</button>'
        : '';
      if (!drop && !clear) return '';
      return '<span class="query-facets-empty">Nothing matched.</span><span class="query-recovery">' + drop + clear + '</span>';
    }

    /** What the results could still be narrowed by, with counts. */
    function renderFacets() {
      const facets = query().facets || [];
      const count = renderMatchCount();
      const recovery = matchedNothing() ? renderRecovery() : '';
      if (!facets.length && !count) return '';
      if (options.refineElsewhere && options.refineElsewhere()) {
        // The sidebar still says where Refine went; a search that matched
        // nothing has nothing to narrow, so it offers the way back instead.
        const note = facets.length
          ? '<span class="query-facets-empty">In the Context sidebar.</span>'
          : (recovery || '<span class="query-facets-empty">Nothing left to narrow by.</span>');
        return '<section class="query-facets is-elsewhere" aria-label="Refine these results"><div class="query-facets-groups"><span class="query-facets-heading">Refine</span>' + note + '</div>' + count + '</section>';
      }
      const empty = facets.length ? '' : (recovery || '<span class="query-facets-empty">Nothing left to narrow by.</span>');
      return '<section class="query-facets" aria-label="Refine these results"><div class="query-facets-groups"><span class="query-facets-heading">Refine</span>' + empty + facets.map(function (facet) {
        const shown = facetValuesShown(facet, expandedFacets, 'query-facet-more');
        return '<div class="query-facet" role="group" aria-label="' + escapeHtml(facet.label) + '"><span class="query-facet-label">' + escapeHtml(facet.label) + '</span><span class="query-facet-values">' + shown.values.map(function (value) {
          return renderFacetValue(facet, value);
        }).join('') + shown.more + '</span></div>';
      }).join('') + '</div>' + count + '</section>';
    }

    /**
     * What clicking a Refine value does to the search, in the words of the
     * query it writes. A reader is choosing between AND, OR and NOT, so the
     * tooltip names them rather than describing them.
     */
    /** A related tag's share of the results, as its chip says it aloud. */
    function describeShare(value) {
      return typeof value.total === 'number'
        ? ', in ' + value.count + ' of ' + value.total + ' results'
        : ', related ' + getWeightLevel(value.strength) + ' of 3';
    }

    function describeFacetValue(value) {
      const clause = value.clause || '';
      return [
        value.detail ? value.detail : '',
        'Click — AND ' + clause + ': keep only results that match it',
        'Alt-click — AND NOT ' + clause + ': leave those results out',
        'Shift-click — OR ' + clause + ': widen the last value chosen here, so either matches',
      ].filter(Boolean).join('\\n');
    }

    /**
     * One value of a facet, with how strongly it is related when it is a tag.
     *
     * A value is one button. It used to sit between a hidden − and +, which
     * held their width open whether or not anyone hovered; the same three
     * things are said by the click, Alt-click and Shift-click the tooltip
     * spells out, and a keyboard does them with Enter, Alt-Enter and
     * Shift-Enter on the focused value.
     */
    function renderFacetValue(facet, value) {
      const isTag = facet.id === 'tags' || facet.id === 'related';
      const hasStrength = typeof value.strength === 'number';
      const name = value.label;
      const title = describeFacetValue(value);
      const strength = hasStrength ? describeShare(value) : '';
      const shared = ' data-facet-id="' + escapeHtml(facet.id) + '" data-clause="' + escapeHtml(value.clause) + '"';
      return '<button class="query-facet-value" data-action="facet"' + shared + ' data-tip="' + escapeHtml(title) + '" data-tip-overflow="' + escapeHtml(name) + '" aria-label="' + escapeHtml(facet.label + ': ' + name + strength + ', ' + value.count + '. Enter adds AND ' + value.clause + ', Alt-Enter adds AND NOT, Shift-Enter adds OR.') + '">' + (hasStrength ? renderWeightRail(getWeightLevel(value.strength)) : '') + (isTag ? renderTagLabel(name) : escapeHtml(name)) + '<span class="query-facet-count">' + value.count + '</span></button>';
    }

    /** How many of each kind of result the applied search matches. */
    function renderMatchCount() {
      if (!appliedText().trim()) return '';
      const counts = query().matchCounts || { notes: 0, tasks: 0 };
      const nouns = { notes: ['note', 'notes'], tasks: ['task', 'tasks'] };
      const elsewhere = options.countElsewhere && options.countElsewhere();
      return '<span class="query-facets-count' + (elsewhere ? ' visually-hidden' : '') + '" role="status">' + (options.resultKinds || ['notes', 'tasks']).map(function (kind) {
        const count = counts[kind] || 0;
        return count + ' ' + nouns[kind][count === 1 ? 0 : 1];
      }).join(' &middot; ') + '</span>';
    }

    function renderBuilder() {
      if (!builderOpen) return '';
      return '<div class="query-builder">' + renderGroup(builderTree(), [], 0)
        + '<p class="query-builder-note">In a new row, type a tag, a word, or a value such as open. Enter adds another row, Backspace in an empty row removes it, and Ctrl or Cmd+Enter adds a group beside the row. A group matches all of its rows or any of them, and not turns it around.</p>'
        + '</div>';
    }

    /** A group, nested to any depth: its head, its rows and groups, and what adds to it. */
    function renderGroup(group, path, depth) {
      const at = pathText(path);
      const items = group.items.length
        ? group.items.map(function (item, index) {
          const itemPath = path.concat(index);
          const joiner = '<span class="query-builder-and">' + (index === 0 ? 'where' : (group.join === 'or' ? 'or' : 'and')) + '</span>';
          return item.items
            ? '<div class="query-builder-item has-group">' + joiner + renderGroup(item, itemPath, depth + 1) + '</div>'
            : renderBuilderRow(item, itemPath, joiner);
        }).join('')
        : '<p class="query-builder-note">This group is empty. Add a condition to start it.</p>';
      const head = '<div class="query-builder-group-head">'
        + '<button type="button" class="query-builder-not' + (group.negated ? ' active' : '') + '" data-action="builder-toggle-not" data-path="' + at + '" aria-pressed="' + (group.negated ? 'true' : 'false') + '" data-tip="Turn this group around: match what it does not">not</button>'
        + '<span class="query-builder-head-text">match</span>'
        + '<select data-action="builder-set-join" data-path="' + at + '" aria-label="How this group combines its rows">'
        + '<option value="and"' + (group.join !== 'or' ? ' selected' : '') + '>all of</option>'
        + '<option value="or"' + (group.join === 'or' ? ' selected' : '') + '>any of</option>'
        + '</select>'
        + (depth > 0 ? '<button class="query-builder-remove" data-action="builder-remove-group" data-path="' + at + '">Remove group</button>' : '')
        + '</div>';
      const actions = '<div class="query-builder-actions">'
        + '<button data-action="builder-add-row" data-path="' + at + '">Add condition</button>'
        + '<button data-action="builder-add-group" data-path="' + at + '">Add group</button>'
        + '</div>';
      return '<div class="query-builder-group' + (depth === 0 ? ' is-root' : '') + (group.negated ? ' is-negated' : '') + '" data-group-path="' + at + '">' + head + items + actions + '</div>';
    }

    function renderBuilderRow(row, path, joiner) {
      const at = pathText(path);
      const position = ' data-path="' + at + '"';
      const suggestKey = 'p' + (at ? at.replace(/\\./g, '_') : '');
      const remove = '<button class="query-builder-remove" data-action="builder-remove-row"' + position + ' aria-label="Remove this condition">Remove</button>';
      if (row.pending) {
        return '<div class="query-builder-row">' + joiner
          + '<span class="query-input-shell query-builder-value-shell"><input class="query-builder-value query-builder-pending" data-action="builder-set-value" data-pending="true" data-suggest-key="' + suggestKey + '"' + position + ' value="' + escapeHtml(row.value || '') + '" placeholder="Type a tag, a word, or a value such as open" aria-label="New condition" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="suggestions-' + suggestKey + '" autocomplete="off" spellcheck="false"><div class="query-suggestions popover is-dropdown" id="suggestions-' + suggestKey + '" data-suggestions="' + suggestKey + '" hidden role="listbox" aria-label="Suggestions"></div></span>'
          + remove + '</div>';
      }
      if (!row.supported) {
        return '<div class="query-builder-row">' + joiner
          + '<code class="query-builder-readonly">' + escapeHtml(row.text) + '</code>' + remove + '</div>';
      }
      const fields = fieldNames().map(function (field) {
        return '<option value="' + escapeHtml(field) + '"' + (field === row.field ? ' selected' : '') + '>' + escapeHtml(field) + '</option>';
      }).join('');
      const descriptions = row.field === 'text'
        ? Object.assign({}, OPERATOR_DESCRIPTIONS, TEXT_OPERATOR_DESCRIPTIONS)
        : row.field === 'priority'
          ? Object.assign({}, OPERATOR_DESCRIPTIONS, PRIORITY_OPERATOR_DESCRIPTIONS)
          : OPERATOR_DESCRIPTIONS;
      const operators = operatorsFor(row.field).map(function (operator) {
        return '<option value="' + operator + '" title="' + escapeHtml(descriptions[operator] || '') + '"' + (operator === row.operator ? ' selected' : '') + '>' + escapeHtml(OPERATOR_LABELS[operator] || operator) + '</option>';
      }).join('');
      const operatorTitle = descriptions[row.operator] || 'Operator';
      return '<div class="query-builder-row">' + joiner
        + '<select data-action="builder-set-field"' + position + ' aria-label="Field">' + fields + '</select>'
        + '<select class="query-builder-operator" data-action="builder-set-operator"' + position + ' aria-label="Operator: ' + escapeHtml(operatorTitle) + '" data-tip="' + escapeHtml(operatorTitle) + '">' + operators + '</select>'
        + '<span class="query-input-shell query-builder-value-shell"><input class="query-builder-value" data-action="builder-set-value" data-suggest-key="' + suggestKey + '" data-field="' + escapeHtml(row.field) + '"' + position + ' value="' + escapeHtml(row.value) + '" placeholder="' + escapeHtml(FIELD_PLACEHOLDERS[row.field] || '') + '" aria-label="Value" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="suggestions-' + suggestKey + '" autocomplete="off" spellcheck="false"><div class="query-suggestions popover is-dropdown" id="suggestions-' + suggestKey + '" data-suggestions="' + suggestKey + '" hidden role="listbox" aria-label="Suggestions"></div></span>'
        + remove + '</div>';
    }

    /** A row waiting for a value, which then decides its field. */
    function pendingRow() {
      return { pending: true, field: 'text', operator: 'contains', value: '', supported: true, text: '' };
    }

    /** The path attribute of a row or group, as a list of indices into items. */
    function pathOf(element) {
      const text = String((element && element.dataset && element.dataset.path) || '');
      return text ? text.split('.').map(Number) : [];
    }

    function pathText(path) {
      return path.join('.');
    }

    /** The group at a path, walking down from the root; undefined if a row is met. */
    function groupAt(tree, path) {
      let group = tree;
      for (let i = 0; i < path.length; i += 1) {
        const item = group.items[path[i]];
        if (!item || !item.items) return undefined;
        group = item;
      }
      return group;
    }

    function itemAt(tree, path) {
      if (!path.length) return undefined;
      const parent = groupAt(tree, path.slice(0, -1));
      return parent ? parent.items[path[path.length - 1]] : undefined;
    }

    function cloneTree(tree) {
      return JSON.parse(JSON.stringify(tree));
    }

    /**
     * Read the builder's tree, seeding it from the host's parse on first
     * use. Returns a copy a caller can change and hand to applyBuilderTree.
     */
    function builderTree() {
      if (!builderDraft) {
        builderDraft = cloneTree(query().builder || { join: 'and', items: [] });
        builderSourceText = appliedText();
      }
      return cloneTree(builderDraft);
    }

    /**
     * Adopt the edited tree, then run the search it describes. A row still
     * empty changes the tree without changing the search, so that case
     * redraws locally instead of making a round trip that would drop it.
     */
    function applyBuilderTree(tree) {
      builderDraft = tree;
      const text = buildQueryFromTree(tree, 0);
      if (text === appliedText()) {
        options.render();
        return;
      }
      builderSourceText = text;
      draft = text;
      run(text, true, false, false);
    }

    /**
     * Write the tree as search text, skipping rows with no value yet. This
     * mirrors fromBuilderTree on the host: a nested group with more than one
     * term is parenthesized, and a negated one is NOT (...).
     */
    function buildQueryFromTree(group, depth) {
      const terms = group.items.map(function (item) {
        if (item.items) return buildQueryFromTree(item, depth + 1);
        if (item.pending) return '';
        if (!item.supported) return item.text.trim();
        if (!String(item.value).trim()) return '';
        return formatBuilderCondition(item);
      }).filter(Boolean);
      if (!terms.length) return '';
      const body = terms.join(group.join === 'or' ? ' OR ' : ' AND ');
      if (group.negated) return 'NOT ' + (terms.length > 1 ? '(' + body + ')' : body);
      return depth > 0 && terms.length > 1 ? '(' + body + ')' : body;
    }

    /** One row as text, with shorthands written the way they are typed. */
    function formatBuilderCondition(row) {
      if (row.field === 'link') return 'link ' + (OPERATOR_LABELS[row.operator] || '=') + ' [[' + stripLinkBrackets(row.value) + ']]';
      const value = quoteQueryValue(String(row.value).trim());
      if (row.field === 'has') return (row.operator === 'neq' ? 'no' : 'has') + ':' + value;
      if (SHORTHAND_FIELDS.indexOf(row.field) >= 0) return (row.operator === 'neq' ? '-' : '') + row.field + ':' + value;
      return row.field + ' ' + (OPERATOR_LABELS[row.operator] || '=') + ' ' + value;
    }

    /** A link's note, as typed with or without its brackets and alias. */
    function stripLinkBrackets(value) {
      return String(value).trim().replace(/^\\[\\[/, '').replace(/\\]\\]$/, '').replace(/\\|.*$/, '').trim();
    }

    function quoteQueryValue(value) {
      // [[x]] unquoted would read back as a link rather than the characters.
      return /[\\s:=<>~!()"']/.test(value) || value.indexOf('[[') >= 0 || !value
        ? '"' + value.replace(/(["\\\\])/g, '\\\\$1') + '"'
        : value;
    }

    /** The field a word names, from the host's spellings or the built-in names. */
    function fieldFor(word) {
      const aliases = suggestions().aliases || {};
      const name = String(word).toLowerCase();
      if (aliases[name]) return aliases[name];
      if (name === 'no') return 'has';
      return DEFAULT_OPERATORS[name] ? name : undefined;
    }

    function unquote(value) {
      const text = String(value).trim();
      return /^(["']).*\\1$/.test(text) ? text.slice(1, -1) : text;
    }

    /**
     * Read one condition as it would be typed, such as is:open,
     * priority >= high, #project/atlas, or a plain word, into a builder row.
     */
    function parseConditionText(text) {
      const value = String(text).trim();
      const row = function (field, operator, rowValue) {
        return { field: field, operator: operator, value: rowValue, supported: true, text: '' };
      };
      let match = /^(-?)([A-Za-z]+):(.+)$/.exec(value);
      if (match && fieldFor(match[2])) {
        const word = match[2].toLowerCase();
        const field = fieldFor(word);
        const negated = (match[1] === '-') !== (word === 'no');
        const rest = unquote(match[3]);
        const comparison = /^(>=|<=|!=|!~|>|<|~)/.exec(rest);
        if (comparison && SHORTHAND_FIELDS.indexOf(field) < 0) {
          return row(field, SYMBOL_OPERATORS[comparison[1]], unquote(rest.slice(comparison[1].length)));
        }
        return row(field, negated ? 'neq' : (field === 'text' ? 'contains' : 'eq'), rest);
      }
      match = /^([A-Za-z]+)\\s*(!=|!~|>=|<=|=|~|>|<)\\s*(.+)$/.exec(value);
      if (match && fieldFor(match[1])) {
        return row(fieldFor(match[1]), SYMBOL_OPERATORS[match[2]], unquote(match[3]));
      }
      match = /^(-?)\\[\\[(.+?)\\]\\]$/.exec(value);
      if (match) return row('link', match[1] ? 'neq' : 'eq', stripLinkBrackets(match[2]));
      if (/^-?[#@]/.test(value)) return row('tag', value.charAt(0) === '-' ? 'neq' : 'eq', value.replace(/^-/, ''));
      return row('text', 'contains', unquote(value));
    }

    /**
     * Run a search. A search that takes in what was typed empties the field;
     * one that only removes or adds a chip, or comes from the builder, keeps
     * it, as keepEntry says.
     */
    function run(text, keepEntry, incidental, focusBar) {
      awaitingApply = true;
      // A search still out after a second shows a thin bar under the box.
      clearTimeout(searchingTimer);
      // The page's document, held here: the timer can outlive the frame
      // that set it, and must not reach for a global that has since gone.
      const page = document;
      searchingTimer = setTimeout(function () {
        if (!awaitingApply || !page || !page.querySelectorAll) return;
        searchInFlight = true;
        page.querySelectorAll('.query-workspace').forEach(function (workspace) { workspace.classList.add('is-searching'); });
        const app = page.getElementById ? page.getElementById('app') : null;
        if (app) app.setAttribute('aria-busy', 'true');
      }, 1000);
      lastEntry = entry;
      entryAfterRun = keepEntry ? entry : '';
      // The host answers with a fresh snapshot, and the page rebuilds itself
      // from it. Without this the caret would be thrown away on every search,
      // so the next keystroke would go nowhere. A search built in the builder
      // keeps its own field instead.
      restoreFocus = focusBar !== false;
      // A facet click or a dropped chip is a step along the way, not a search
      // worth keeping: recording those evicts what the reader actually typed
      // from the short list of recent searches.
      options.apply(joinTags(String(text).trim()), !incidental);
    }

    /**
     * Narrow by a facet value: add it, leave it out with Alt, or with Shift
     * allow it as well as the value of the same facet already chosen.
     */
    function refine(clause, facetId, mode) {
      const text = appliedText().trim();
      if (mode === 'or') {
        const facet = (query().facets || []).find(function (candidate) { return candidate.id === facetId; });
        const existing = facet && facet.applied && facet.applied[0];
        const merged = existing ? mergeAlternative(text, existing, clause) : undefined;
        if (merged !== undefined) {
          run(merged, true, true);
          return;
        }
      }
      const term = mode === 'exclude' ? '-' + clause : clause;
      if (!text) run(term, true, true);
      else if (query().canAppend === false) run('(' + text + ') AND ' + term, true, true);
      else run(text + ' AND ' + term, true, true);
    }

    /** Put a clause beside an existing one as an alternative. */
    function mergeAlternative(text, existing, clause) {
      const escaped = existing.replace(/[.*+?^$(){}|[\\]\\\\]/g, '\\\\$&');
      const match = new RegExp('(^|[\\\\s(])' + escaped + '(?=$|[\\\\s)])', 'i').exec(text);
      if (!match) return undefined;
      const start = match.index + match[1].length;
      const end = start + existing.length;
      let depth = 0;
      for (let position = 0; position < start; position += 1) {
        if (text.charAt(position) === '(') depth += 1;
        if (text.charAt(position) === ')') depth -= 1;
      }
      return depth > 0
        ? text.slice(0, end) + ' OR ' + clause + text.slice(end)
        : text.slice(0, start) + '(' + existing + ' OR ' + clause + ')' + text.slice(end);
    }

    /**
     * Completions for the word under the caret in the bar. After a field
     * and its operator they are that field's values; otherwise conditions,
     * field names, and tags, each of which stands on its own. An empty bar
     * offers recent searches.
     */
    function queryBarSuggestions(input) {
      const all = suggestions();
      if (!input.value.trim()) {
        return {
          token: '',
          showAll: true,
          items: (all.recent || []).slice(0, 8).map(function (item) {
            // A recent search is a whole search, so choosing one runs it.
            return { value: item.value, label: item.label, detail: item.detail, insert: item.value, replaceAll: true, apply: true };
          }),
        };
      }
      const caret = caretPosition(input);
      const prefix = input.value.slice(0, caret);
      // After [[ the notes are what is being written, whatever came before.
      const opened = /\\[\\[[^\\]]*$/.exec(prefix);
      if (opened) {
        return {
          token: opened[0],
          items: ((all.values || {}).link || []).map(function (item) {
            return { value: item.label, label: item.label, detail: item.detail, insert: '[[' + item.value + ']] ', term: true };
          }),
        };
      }
      const context = valueContext(prefix, all.aliases || {});
      if (context) {
        const values = (all.values || {})[context.field] || [];
        return {
          token: context.token,
          items: values.map(function (item) {
            return { value: item.value, label: item.label, detail: item.detail, insert: quoteQueryValue(item.value) + ' ', term: true };
          }),
        };
      }
      const token = (prefix.match(/[^\\s()]*$/) || [''])[0];
      const conditions = (all.conditions || []).map(function (item) {
        return { value: item.value, label: item.label, detail: item.detail, insert: item.value + ' ', term: true };
      });
      const fields = (all.fields || []).map(function (item) {
        const shorthand = SHORTHAND_FIELDS.indexOf(item.value) >= 0;
        return { value: item.value, label: item.label + (shorthand ? ':' : ' ='), detail: item.detail, insert: item.value + (shorthand ? ':' : ' = ') };
      });
      const tags = ((all.values || {}).tag || []).map(function (item) {
        return { value: item.value, label: item.label, detail: item.detail, insert: item.value + ' ', term: true };
      });
      return { token: token, items: conditions.concat(fields, tags) };
    }

    /** Where the caret sits, defaulting to the end of the value. */
    function caretPosition(input) {
      return typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
    }

    /** Detect a caret in the value of a field condition, such as is:ov. */
    function valueContext(prefix, aliases) {
      const match = prefix.match(/([A-Za-z]+)\\s*(!=|!~|>=|<=|[:=~<>])\\s*([^\\s()]*)$/);
      if (!match) return undefined;
      const field = aliases[match[1].toLowerCase()];
      return field ? { field: field, token: match[3] } : undefined;
    }

    /** Completions for one builder row's value. */
    function builderValueSuggestions(field, token) {
      const values = (suggestions().values || {})[field] || [];
      return {
        token: token,
        items: values.map(function (item) {
          return { value: item.value, label: item.label, detail: item.detail, insert: item.value };
        }),
      };
    }

    /**
     * Completions for a new row, which starts from a value: a condition, a
     * tag, a field to fill in, or failing those the words themselves.
     */
    function pendingRowSuggestions(token) {
      const all = suggestions();
      const opened = /^(-?)(\\[\\[.*)$/.exec(token || '');
      if (opened) {
        // A link, whole: -[[Atlas]] leaves out what links to Atlas.
        return {
          token: opened[2],
          items: ((all.values || {}).link || []).map(function (item) {
            return { value: item.label, label: opened[1] + item.label, detail: item.detail, condition: opened[1] + item.label };
          }),
        };
      }
      const conditions = (all.conditions || []).map(function (item) {
        return { value: item.value, label: item.label, detail: item.detail, condition: item.value };
      });
      const tags = ((all.values || {}).tag || []).map(function (item) {
        return { value: item.value, label: item.label, detail: item.detail, condition: item.value };
      });
      const fields = (all.fields || []).map(function (item) {
        return { value: item.value, label: item.label + (SHORTHAND_FIELDS.indexOf(item.value) >= 0 ? ':' : ' =') + ' …', detail: item.detail, field: item.value };
      });
      const words = token && !/^-?[#@]/.test(token)
        ? [{ value: token, label: 'text ~ ' + quoteQueryValue(token), detail: 'Entries containing these words', condition: 'text ~ ' + quoteQueryValue(token), always: true }]
        : [];
      return { token: token, items: conditions.concat(tags, fields, words) };
    }

    /** Populate and show the list attached to an input. */
    function openSuggestions(input) {
      const key = input.dataset.suggestKey;
      if (!key) return;
      const source = key === 'query'
        ? queryBarSuggestions(input)
        : input.dataset.pending
          ? pendingRowSuggestions(input.value.trim())
          : builderValueSuggestions(input.dataset.field, input.value);
      const token = String(source.token || '').toLowerCase();
      suggestionItems = source.showAll
        ? source.items
        : !token
          ? []
          : source.items.filter(function (item) {
            return item.always
              || String(item.value).toLowerCase().indexOf(token) >= 0
              || String(item.label).toLowerCase().indexOf(token) >= 0;
          }).slice(0, 12);
      suggestionToken = String(source.token || '');
      suggestionHostKey = key;
      // Nothing is highlighted until the author arrows into the list, so
      // Enter runs what they typed instead of silently taking a completion.
      suggestionIndex = -1;
      renderSuggestions(input);
    }

    function suggestionContainer(key) {
      return document.querySelector('[data-suggestions="' + key + '"]');
    }

    function renderSuggestions(input) {
      const container = suggestionContainer(suggestionHostKey);
      if (!container) return;
      if (!suggestionItems.length) {
        container.hidden = true;
        container.innerHTML = '';
        if (input) {
          input.setAttribute('aria-expanded', 'false');
          input.removeAttribute('aria-activedescendant');
        }
        return;
      }
      // Focus stays in the field, as the ARIA combobox pattern has it; the
      // highlighted option is named to a screen reader by its id instead, so
      // the options are not Tab stops of their own.
      const idPrefix = container.id || 'suggestions';
      container.innerHTML = suggestionItems.map(function (item, index) {
        return '<button type="button" role="option" tabindex="-1" id="' + idPrefix + '-' + index + '" aria-selected="' + (index === suggestionIndex) + '" class="query-suggestion' + (index === suggestionIndex ? ' active' : '') + '" data-action="query-suggestion" data-suggestion-index="' + index + '"><span class="query-suggestion-label">' + renderTermText(item.label) + '</span>' + (item.detail ? '<span class="query-suggestion-detail">' + escapeHtml(item.detail) + '</span>' : '') + '</button>';
      }).join('');
      container.hidden = false;
      if (input) {
        input.setAttribute('aria-expanded', 'true');
        if (suggestionIndex >= 0) input.setAttribute('aria-activedescendant', idPrefix + '-' + suggestionIndex);
        else input.removeAttribute('aria-activedescendant');
      }
      const active = container.querySelector('.query-suggestion.active');
      if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
    }

    function closeSuggestions() {
      suggestionItems = [];
      suggestionIndex = -1;
      const container = suggestionContainer(suggestionHostKey);
      if (container) {
        container.hidden = true;
        container.innerHTML = '';
      }
      const host = suggestionHostKey ? document.querySelector('[data-suggest-key="' + suggestionHostKey + '"]') : null;
      if (host) {
        host.setAttribute('aria-expanded', 'false');
        host.removeAttribute('aria-activedescendant');
      }
      suggestionHostKey = undefined;
    }

    function rowAt(tree, input) {
      const item = itemAt(tree, pathOf(input));
      return item && !item.items ? item : undefined;
    }

    /**
     * Turn a new row into the condition it was given, and open another new
     * row after it so the next condition can be typed straight away.
     */
    function commitPendingRow(input, conditionText) {
      const text = String(conditionText).trim();
      if (!text) return;
      const tree = builderTree();
      const path = pathOf(input);
      const parent = groupAt(tree, path.slice(0, -1));
      const index = path[path.length - 1];
      if (!parent || !parent.items[index]) return;
      parent.items[index] = parseConditionText(text);
      parent.items.push(pendingRow());
      pendingBuilderFocus = { path: pathText(path.slice(0, -1).concat(parent.items.length - 1)) };
      applyBuilderTree(tree);
    }

    /** Replace the word being completed with the chosen suggestion. */
    function acceptSuggestion(index) {
      const item = suggestionItems[index];
      if (!item) return;
      const key = suggestionHostKey;
      const input = document.querySelector('[data-suggest-key="' + key + '"]');
      if (!input) return;

      if (key === 'query') {
        closeSuggestions();
        // A recent search is a whole search, and replaces this one.
        if (item.apply) {
          setEntry(input, '');
          run(item.insert);
          return;
        }
        const caret = caretPosition(input);
        const start = caret - suggestionToken.length;
        const text = input.value.slice(0, start) + item.insert + input.value.slice(caret);
        // A tag or condition, or a field's value, is a whole term: it becomes
        // a chip at once. A field name waits for its value.
        if (item.term) {
          setEntry(input, '');
          run(combineQuery(appliedText(), text));
          return;
        }
        setEntry(input, text);
        const nextCaret = start + item.insert.length;
        input.setSelectionRange(nextCaret, nextCaret);
        input.focus();
        return;
      }

      closeSuggestions();
      if (input.dataset.pending) {
        if (item.field) {
          // A field chosen without a value becomes an ordinary row to fill in.
          const tree = builderTree();
          const path = pathOf(input);
          const parent = groupAt(tree, path.slice(0, -1));
          if (!parent) return;
          parent.items[path[path.length - 1]] = { field: item.field, operator: operatorsFor(item.field)[0], value: '', supported: true, text: '' };
          pendingBuilderFocus = { path: pathText(path) };
          builderDraft = tree;
          options.render();
          return;
        }
        commitPendingRow(input, item.condition);
        return;
      }
      // A builder value is committed as soon as it is chosen, so the results
      // update without waiting for the field to lose focus.
      input.value = item.insert;
      commitBuilderValue(input);
    }

    function commitBuilderValue(input) {
      const tree = builderTree();
      const row = rowAt(tree, input);
      if (!row) return;
      row.value = input.value;
      pendingBuilderFocus = { path: String(input.dataset.path || '') };
      applyBuilderTree(tree);
    }

    function removeRow(input) {
      const tree = builderTree();
      const removed = removeItem(tree, pathOf(input));
      if (!removed) return;
      const index = removed.path[removed.path.length - 1];
      if (index > 0) pendingBuilderFocus = { path: pathText(removed.path.slice(0, -1).concat(index - 1)) };
      applyBuilderTree(tree);
    }

    /** Takes the row or group at path out of the tree. A group left with
        nothing in it goes too, and so on upward, so an emptied group never
        lingers as a box with only a head; the root is the one group that
        stays. Returns the path that was finally removed, or null. */
    function removeItem(tree, path) {
      if (!path.length) return null;
      let at = path.slice();
      for (;;) {
        const parent = groupAt(tree, at.slice(0, -1));
        if (!parent) return null;
        parent.items.splice(at[at.length - 1], 1);
        if (parent.items.length || at.length === 1) return { path: at };
        at = at.slice(0, -1);
      }
    }

    /** A group inside the group at path, joined the other way, with a row to type in. */
    function addGroup(path) {
      const tree = builderTree();
      const parent = groupAt(tree, path);
      if (!parent) return;
      parent.items.push({ join: parent.join === 'or' ? 'and' : 'or', items: [pendingRow()] });
      pendingBuilderFocus = { path: pathText(path.concat(parent.items.length - 1, 0)) };
      applyBuilderTree(tree);
    }

    function isEditable(target) {
      return Boolean(target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]'));
    }

    return {
      renderBar: renderBar,
      renderFacets: renderFacets,
      currentText: currentText,

      /**
       * The plain words of a search, which a page can match at once because
       * every one of them must appear. A field, its operator, and its value
       * are a condition rather than words, and a search with OR, NOT, or
       * parentheses is not only words, so it waits for the host.
       */
      previewWords: function (text) {
        const value = String(text || '');
        if (/(^|\\s)(or|not)(\\s|$)|\\|\\||[()]/i.test(value)) return [];
        const tokens = value.split(/\\s+/).filter(Boolean);
        const words = [];
        let lastWordIndex = -2;
        for (let index = 0; index < tokens.length; index += 1) {
          const token = tokens[index];
          const operator = /^(!=|!~|>=|<=|=|~|>|<)/.exec(token);
          if (operator) {
            if (lastWordIndex === index - 1) words.pop();
            if (token === operator[1]) index += 1;
            continue;
          }
          if (!/^[-!#@"']/.test(token) && !/[:=<>~]/.test(token) && !/^(and|&&)$/i.test(token)) {
            words.push(token.toLowerCase());
            lastWordIndex = index;
          }
        }
        return words;
      },

      /** Reconcile with a fresh host state, before the page redraws. */
      receive: function () {
        const text = appliedText();
        // The answer to a search this editor ran replaces what was typed even
        // when the text comes back the same, as when a typed tag moves into
        // the page's title and leaves nothing behind.
        if (text !== appliedSeen || awaitingApply) {
          const input = document.activeElement;
          const typing = Boolean(input && input.dataset && input.dataset.action === 'query-input');
          // A search this editor ran turns what was typed into chips; one that
          // did not parse keeps it in the field with its error. Any other
          // change, such as a save elsewhere, leaves a term being typed.
          if (awaitingApply) {
            entry = query().pending ? lastEntry : entryAfterRun;
            draft = undefined;
          } else if (!typing) {
            entry = '';
            draft = undefined;
          }
          appliedSeen = text;
          awaitingApply = false;
          clearTimeout(searchingTimer);
          if (searchInFlight) {
            searchInFlight = false;
            document.querySelectorAll('.query-workspace.is-searching').forEach(function (workspace) { workspace.classList.remove('is-searching'); });
            syncBusy();
          }
        }
        if (text !== builderSourceText) {
          builderDraft = undefined;
          builderSourceText = text;
        }
      },

      /**
       * Told before the page redraws, so that taking the field out of the
       * document is not mistaken for the reader leaving it, and the caret can
       * be put back where they were typing.
       */
      beforeRender: function () {
        const active = document.activeElement;
        if (active && active.dataset && active.dataset.action === 'query-input') {
          redrawing = true;
          caretAtRedraw = active.selectionStart;
          restoreFocus = true;
        }
      },

      /** Restore focus and any open completion list after a redraw. */
      afterRender: function () {
        const caretWanted = caretAtRedraw;
        redrawing = false;
        caretAtRedraw = undefined;
        if (restoreFocus) {
          restoreFocus = false;
          const bar = document.querySelector('[data-suggest-key="query"]');
          if (bar && bar.focus) {
            // Putting the caret back is not the reader asking for the recent
            // searches: only focusing the empty box by hand opens those.
            if (!openSuggestionsOnRestore) suppressFocusSuggestions = true;
            openSuggestionsOnRestore = false;
            bar.focus();
            suppressFocusSuggestions = false;
            const typed = bar.value ? bar.value.length : 0;
            // Back where they were typing, not at the end: a redraw in the
            // middle of a word would otherwise move the caret under them.
            const caret =
              caretWanted === undefined || caretWanted === null
                ? typed
                : Math.min(caretWanted, typed);
            if (bar.setSelectionRange) bar.setSelectionRange(caret, caret);
          }
        }
        if (pendingBuilderFocus) {
          const target = document.querySelector('[data-action="builder-set-value"][data-path="' + pendingBuilderFocus.path + '"]');
          pendingBuilderFocus = undefined;
          if (target && target.focus) target.focus();
        }
        if (suggestionHostKey && suggestionItems.length) {
          renderSuggestions(document.querySelector('[data-suggest-key="' + suggestionHostKey + '"]'));
        }
      },

      /** Put the caret in the search box, with its recent searches. */
      focus: function () {
        restoreFocus = true;
        openSuggestionsOnRestore = true;
        options.render();
      },

      handleMousedown: function (event) {
        // Pressing on a completion must not move focus out of its field: a
        // builder value commits on blur, which would redraw the row and
        // destroy the completion before its click could land.
        if (event.target.closest && event.target.closest('[data-action="query-suggestion"]')) {
          event.preventDefault();
          return true;
        }
        // Pressing the field around the chips puts the caret in it.
        const shell = event.target.classList && event.target.classList.contains('query-bar-shell') ? event.target : undefined;
        const input = shell ? shell.querySelector('[data-action="query-input"]') : undefined;
        if (input && input.focus) {
          event.preventDefault();
          input.focus();
          return true;
        }
        return false;
      },

      handleFocusIn: function (event) {
        const target = event.target;
        if (suppressFocusSuggestions) return;
        if (target && target.dataset && target.dataset.action === 'query-input' && !target.value) {
          openSuggestions(target);
        }
      },

      /** Returns true when the click belonged to the editor. */
      handleClick: function (event) {
        if (suggestionItems.length && !(event.target.closest && event.target.closest('.query-input-shell'))) {
          closeSuggestions();
        }
        const target = event.target.closest ? event.target.closest('[data-action]') : undefined;
        if (!target) return false;
        // A disabled button in the bar is there to hold its place, not to act.
        if (target.disabled === true || (target.getAttribute && (target.getAttribute('disabled') !== null || target.getAttribute('aria-disabled') === 'true'))) return true;
        const action = target.dataset.action;
        if (action === 'toggle-builder') {
          builderOpen = !builderOpen;
          if (builderOpen) {
            // The builder always opens with an empty row to type in, even when
            // the search already has conditions, such as a page's own tags.
            const tree = builderTree();
            if (!tree.items.some(function (item) { return !item.items && item.pending; })) {
              tree.items.push(pendingRow());
            }
            builderDraft = tree;
            pendingBuilderFocus = { path: pathText([tree.items.length - 1]) };
          }
          options.render();
          return true;
        }
        if (action === 'apply-query') {
          closeSuggestions();
          run(currentText());
          return true;
        }
        if (action === 'clear-query') {
          entry = '';
          entryAfterRun = '';
          document.querySelectorAll('[data-suggest-key="query"]').forEach(function (bar) { bar.value = ''; });
          draft = clearedText();
          closeSuggestions();
          awaitingApply = true;
          syncTextButtons(draft);
          if (options.onDraft) options.onDraft(draft);
          options.clear();
          return true;
        }
        if (action === 'query-suggestion') {
          acceptSuggestion(Number(target.dataset.suggestionIndex));
          return true;
        }
        if (action === 'remove-term') {
          closeSuggestions();
          run(target.dataset.without || '', true, true);
          const bar = document.querySelector('[data-suggest-key="query"]');
          if (bar && bar.focus) bar.focus();
          return true;
        }
        if (action === 'facet') {
          refine(target.dataset.clause, target.dataset.facetId, event.altKey ? 'exclude' : event.shiftKey ? 'or' : 'and');
          return true;
        }
        if (action === 'facet-more') {
          const id = target.dataset.facetId;
          if (expandedFacets.has(id)) expandedFacets.delete(id);
          else expandedFacets.add(id);
          renderKeepingPlace(options.render);
          return true;
        }
        if (action === 'builder-add-group') {
          addGroup(pathOf(target));
          return true;
        }
        if (action === 'builder-add-row') {
          const tree = builderTree();
          const path = pathOf(target);
          const group = groupAt(tree, path);
          if (group) {
            group.items.push(pendingRow());
            pendingBuilderFocus = { path: pathText(path.concat(group.items.length - 1)) };
            applyBuilderTree(tree);
          }
          return true;
        }
        if (action === 'builder-remove-group' || action === 'builder-remove-row') {
          const tree = builderTree();
          if (removeItem(tree, pathOf(target))) applyBuilderTree(tree);
          return true;
        }
        if (action === 'builder-toggle-not') {
          const tree = builderTree();
          const group = groupAt(tree, pathOf(target));
          if (group) {
            group.negated = !group.negated;
            applyBuilderTree(tree);
          }
          return true;
        }
        return false;
      },

      /** Returns true when the key belonged to the editor. */
      handleKeydown: function (event) {
        const input = event.target.closest ? event.target.closest('[data-suggest-key]') : undefined;
        if (!input) {
          if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !isEditable(event.target)) {
            event.preventDefault();
            restoreFocus = true;
            options.render();
            return true;
          }
          return false;
        }
        const isBar = input.dataset.suggestKey === 'query';
        if (event.key === 'ArrowDown' && suggestionItems.length) {
          event.preventDefault();
          suggestionIndex = (suggestionIndex + 1) % suggestionItems.length;
          renderSuggestions(input);
          return true;
        }
        if (event.key === 'ArrowUp' && suggestionItems.length) {
          event.preventDefault();
          suggestionIndex = (suggestionIndex - 1 + suggestionItems.length) % suggestionItems.length;
          renderSuggestions(input);
          return true;
        }
        if (event.key === 'Tab' && suggestionItems.length) {
          // Tab means "complete this", so it takes the first entry when the
          // author has not picked one.
          event.preventDefault();
          acceptSuggestion(suggestionIndex >= 0 ? suggestionIndex : 0);
          return true;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          if (!isBar && (event.metaKey || event.ctrlKey)) {
            closeSuggestions();
            addGroup(pathOf(input).slice(0, -1));
            return true;
          }
          if (suggestionItems.length && suggestionIndex >= 0) {
            acceptSuggestion(suggestionIndex);
            return true;
          }
          closeSuggestions();
          if (isBar) run(currentText());
          else if (input.dataset.pending) commitPendingRow(input, input.value);
          else commitBuilderValue(input);
          return true;
        }
        // Backspace in an empty field removes the last chip.
        if (isBar && event.key === 'Backspace' && !input.value && draft === undefined) {
          const terms = query().terms || [];
          if (appliedText().trim()) {
            event.preventDefault();
            closeSuggestions();
            run(terms.length ? terms[terms.length - 1].without : '', false, true);
          }
          return true;
        }
        if (event.key === 'Backspace' && !isBar && !input.value) {
          event.preventDefault();
          closeSuggestions();
          removeRow(input);
          return true;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          if (suggestionItems.length) {
            closeSuggestions();
            return true;
          }
          if (isBar) {
            // Escape with no completions open abandons the term being typed.
            setEntry(input, '');
          }
          return true;
        }
        return true;
      },

      handleInput: function (event) {
        const target = event.target;
        if (target.dataset.action === 'query-input') {
          setEntry(target, target.value);
          openSuggestions(target);
          return true;
        }
        if (target.dataset.action === 'builder-set-value') {
          if (target.dataset.pending) {
            const tree = builderTree();
            const row = rowAt(tree, target);
            if (row) {
              row.value = target.value;
              builderDraft = tree;
            }
          }
          openSuggestions(target);
          return true;
        }
        return false;
      },

      handleChange: function (event) {
        const target = event.target;
        const action = target.dataset.action;
        if (action === 'builder-set-join') {
          const tree = builderTree();
          const group = groupAt(tree, pathOf(target));
          if (group) {
            group.join = target.value === 'or' ? 'or' : 'and';
            applyBuilderTree(tree);
          }
          return true;
        }
        if (action !== 'builder-set-field' && action !== 'builder-set-operator' && action !== 'builder-set-value') return false;
        // A new row waits for Enter or a completion; leaving it is not a choice.
        if (target.dataset.pending) return true;
        const tree = builderTree();
        const row = rowAt(tree, target);
        if (!row) return true;
        if (action === 'builder-set-field') {
          row.field = target.value;
          // Keep the operator valid for the new field.
          const allowed = operatorsFor(row.field);
          if (allowed.indexOf(row.operator) < 0) row.operator = allowed[0];
        }
        if (action === 'builder-set-operator') row.operator = target.value;
        if (action === 'builder-set-value') row.value = target.value;
        applyBuilderTree(tree);
        return true;
      },
    };
  }
`;
}

/**
 * A per-webview nonce for the page's scripts.
 */
export function createNonce(): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index += 1) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}

