/**
 * The Notes and Tasks tabs over a search's results, and the panels they
 * show: one tab stop for the list, arrow keys between the tabs, and each
 * tab naming the panel it shows, which is what the tab role promises a
 * screen reader.
 */

/** One tab: what it shows, its name, and how many results are behind it. */
export interface ResultTab {
  readonly id: string;
  readonly label: string;
  readonly count: number;
}

/** The id of a result tab. */
function resultTabId(id: string): string {
  return `result-tab-${id}`;
}

/** The id of the panel a result tab shows. */
function resultPanelId(id: string): string {
  return `result-panel-${id}`;
}

/** The attributes a result tab's panel carries, so it and its tab name each other. */
export function resultPanelAttributes(id: string): { id: string; role: 'tabpanel'; 'aria-labelledby': string } {
  return { id: resultPanelId(id), role: 'tabpanel', 'aria-labelledby': resultTabId(id) };
}

/**
 * The tabs, each a `set-result-tab` button carrying its count in a
 * `data-search-count` span; the one `active` is selected and the tab stop.
 */
export function ResultTabs({ tabs, active, label }: { readonly tabs: readonly ResultTab[]; readonly active: string; readonly label: string }) {
  return (
    <div class="overview-tabs-row">
      <div class="segmented overview-tabs" role="tablist" aria-label={label}>
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              class={selected ? 'active' : ''}
              id={resultTabId(tab.id)}
              data-action="set-result-tab"
              data-tab={tab.id}
              role="tab"
              aria-selected={selected}
              aria-controls={resultPanelId(tab.id)}
              tabIndex={selected ? 0 : -1}
            >
              {`${tab.label} (`}<span data-search-count={tab.id}>{tab.count}</span>)
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The tab a key moves to from the tab at `index` of `count`: Left and Right wrap, Home and End go to the ends. */
function nextTabIndex(key: string, index: number, count: number): number {
  if (key === 'Home') {
    return 0;
  }
  if (key === 'End') {
    return count - 1;
  }
  return (index + (key === 'ArrowRight' ? 1 : count - 1)) % count;
}

/**
 * Arrow keys between a search's result tabs, as the tab role promises: Left
 * and Right move and choose, Home and End go to the ends. Install once,
 * ahead of the page's own listeners.
 */
export function installResultTabKeys(): void {
  document.addEventListener('keydown', (event) => {
    const target = event.target as Element | null;
    if (!target || !target.closest) {
      return;
    }
    const tab = target.closest<HTMLElement>('[role="tab"][data-action="set-result-tab"]');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      return;
    }
    const list = tab.closest('[role="tablist"]');
    const tabs = list ? Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]')) : [tab];
    const next = nextTabIndex(event.key, tabs.indexOf(tab), tabs.length);
    event.preventDefault();
    const chosen = tabs[next].dataset.tab;
    tabs[next].click();
    // The page draws again on the click, so the tab to focus is found again.
    const drawn = document.querySelector<HTMLElement>(`[role="tab"][data-action="set-result-tab"][data-tab="${chosen}"]`);
    if (drawn) {
      drawn.focus();
    }
  });
}
