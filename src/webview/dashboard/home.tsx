/**
 * Home: its widgets in a grid, the line above them that says what is new or
 * that Home can be arranged, the bar Home is arranged from, and, for a
 * workspace with no notes, the way in.
 */
import type { DashboardSavedFilter, DashboardWidget, DashboardWidgetConfig } from '../../ui/protocol/dashboard';
import { WIDGET_KINDS } from '../../domain/dashboard/widgetCatalog';
import { Loading } from '../shared/loading';
import type { HomeContext } from './homeContext';
import type { DashboardDraw } from './model';
import { HomeWidget } from './widgets';

/** A widget + Add widget offers: its value, its name, and what it shows. */
export interface WidgetChoice {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

/**
 * What + Add widget offers, which Related Notes offers too while Home is in
 * front: every kind Home may hold another of, then a saved search's widget
 * for each saved search, as `savedQuery:<id>`.
 */
export function widgetChoices(widgets: readonly DashboardWidgetConfig[], savedFilters: readonly DashboardSavedFilter[]): WidgetChoice[] {
  const present = new Set(widgets.map((widget) => widget.kind));
  const kinds = (Object.keys(WIDGET_KINDS) as Array<keyof typeof WIDGET_KINDS>)
    .filter((kind) => kind !== 'savedQuery' && (WIDGET_KINDS[kind].repeatable || !present.has(kind)))
    .map((kind): WidgetChoice => ({ value: kind, label: WIDGET_KINDS[kind].label, description: WIDGET_KINDS[kind].description }));
  return [...kinds, ...savedFilters.map((filter): WidgetChoice => ({ value: `savedQuery:${filter.id}`, label: `Saved search: ${filter.name}` }))];
}

/** + Add widget: a select of what can be added, which always shows its prompt. */
function AddWidget({ choices }: { readonly choices: readonly WidgetChoice[] }) {
  return (
    <select data-action="add-widget" aria-label="Add a widget" value="">
      <option key="" value="">+ Add widget…</option>
      {choices.map((choice) => <option key={choice.value} value={choice.value} title={choice.description}>{choice.label}</option>)}
    </select>
  );
}

/** The bar Home is arranged from: + Add widget, Reset widgets…, and Finish. */
function EditBar({ choices }: { readonly choices: readonly WidgetChoice[] }) {
  return (
    <div class="home-edit-bar" role="status">
      <span>Customizing Home. Drag a widget to move it, or right-click it to move it first or last.</span>
      <div class="home-edit-actions">
        <AddWidget choices={choices} />
        {/* The host asks first, in VS Code's own modal: a reset cannot be undone. */}
        <button type="button" data-action="reset-widgets" data-tip="Put back the widgets Home started with">Reset widgets…</button>
        <button type="button" class="active" data-action="finish-customizing">Finish</button>
      </div>
    </div>
  );
}

/**
 * The line over a resting Home. What's new comes first, and takes the line
 * while it has something to say. Then Home says it can be arranged, until it
 * has been, or the reader closes the line: a fixed line of instruction is
 * read the first few times and skipped after. Customize stays in the gear
 * throughout. It is not the customizing bar, and does not share its class:
 * that one means "Home is being edited".
 */
function HintBar({ snapshot, view }: DashboardDraw) {
  if (snapshot.whatsNew) {
    return (
      <div class="home-hint-bar whats-new-bar">
        <span>{`Updated to Deckard ${snapshot.whatsNew.version}.`}</span>
        <span class="home-hint-actions">
          <button type="button" data-action="open-whats-new">What's new</button>
          <button type="button" data-action="dismiss-whats-new" data-tip="Stop saying so">Dismiss</button>
        </span>
      </div>
    );
  }
  if (snapshot.homeArranged || view.homeHintDismissed) {
    return null;
  }
  return (
    <div class="home-hint-bar">
      <span>Home is yours to arrange.</span>
      <span class="home-hint-actions">
        <button type="button" data-action="customize-home">Customize</button>
        <button type="button" data-action="dismiss-home-hint" data-tip="Stop saying so">Dismiss</button>
      </span>
    </div>
  );
}

/**
 * A workspace with no notes yet gets the next step, not a grid of empty
 * widgets each saying there is nothing to show.
 */
function GetStarted() {
  return (
    <section class="home-start" aria-label="Get started">
      <h2>No notes here yet</h2>
      <p>Deckard reads every saved Markdown file in this workspace. Start with today’s note, or take the tour: a sample workspace of notes that show what Deckard does and say what to try.</p>
      <div class="home-start-actions">
        <button type="button" class="active" data-action="open-daily-note">Create today’s note</button>
        <button type="button" data-action="open-view" data-view="sampleWorkspace">Create a sample workspace</button>
        <button type="button" data-action="open-view" data-view="checkSetup">Check my setup</button>
      </div>
    </section>
  );
}

/** Home's widgets in their grid, keyed by how many times a drag changed it, or a way to add some. */
function WidgetGrid({ widgets, home, generation }: { readonly widgets: readonly DashboardWidget[]; readonly home: HomeContext; readonly generation: number }) {
  if (!widgets.length) {
    return <div class="empty">{'Home has no widgets. '}<button type="button" data-action="customize-home">Customize</button></div>;
  }
  return (
    <div key={`grid-${generation}`} class="home-grid">
      {widgets.map((widget) => <HomeWidget key={widget.id} widget={widget} home={home} />)}
    </div>
  );
}

/** What Home is drawn from: the page, its widgets' context, what + Add widget offers, and the grid's generation. */
export interface HomePanelProps extends DashboardDraw {
  readonly home: HomeContext;
  readonly choices: readonly WidgetChoice[];
  readonly generation: number;
}

/** Home's content: drawn only while Home is the tab shown, and waiting on its widgets until the host sends them. */
function HomeContent(props: HomePanelProps) {
  const { snapshot, view } = props;
  // The widgets arrive once the host knows Home is showing.
  if (!snapshot.widgets) {
    return <Loading label="Loading Home…" />;
  }
  return (
    <>
      {view.editingHome ? <EditBar choices={props.choices} /> : <HintBar snapshot={snapshot} view={view} />}
      {snapshot.totalNoteCount === 0 && !view.editingHome ? <GetStarted /> : null}
      <WidgetGrid widgets={snapshot.widgets} home={props.home} generation={props.generation} />
    </>
  );
}

/** Home's panel, empty and hidden while the Tags tab is shown. */
export function HomePanel(props: HomePanelProps) {
  const shown = props.view.mode === 'home';
  return (
    <section id="home-panel" class="dashboard-panel" role="tabpanel" aria-labelledby="home-tab" hidden={!shown}>
      {shown ? <HomeContent {...props} /> : null}
    </section>
  );
}
