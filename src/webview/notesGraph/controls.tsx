/**
 * Everything the Notes Graph draws around its canvas: the control groups,
 * the zoom controls with Reset and its Undo, the legend and status line,
 * the empty-state line, and the tooltip's box. Drawn by Preact into the
 * body, from the reader's settings and what the page last said, as the
 * template wrote them, down to the space between two elements.
 *
 * The canvas is one element here, with a ref: the frame loop sizes it and
 * draws into it outside Preact, and writes the zoom readout, the
 * Simulating note, and the tooltip's contents, which Preact draws once.
 */
import type { ComponentChildren, RefObject } from 'preact';

import { UndoNotice } from '../shared/undoToast';
import type { GraphSettings, GraphState } from './model';

/** What the page last said in its controls, beside the settings. */
export interface ControlsState {
  /** Around this note, its hops and its daily notes, as the host last drew the graph or the reader set them. */
  readonly focus: {
    readonly local: boolean;
    readonly skipPeriodic: boolean;
    readonly skipDisabled: boolean;
    readonly depth: string;
    readonly note: string;
  };
  /** The tags listed, and the filter they were listed under, from the last time the list was drawn; null before a graph. */
  readonly tagList: { readonly tags: readonly (readonly [string, string, number])[]; readonly filter: string } | null;
  /** The group the list was last set to, as given; undefined until it is first set. */
  readonly groupValue: unknown;
  /** The status line, and whether the legend names lines through a daily note. */
  readonly status: { readonly text: string; readonly joinedShown: boolean };
  /** The empty-state line's display, once a graph has said. */
  readonly emptyDisplay?: string;
  /** Reset's offer of Undo, or the word that it was taken. */
  readonly resetUndo: 'none' | 'offer' | 'restored';
}

/** The elements the page reads and writes outside Preact. */
export interface ControlRefs {
  readonly canvas: RefObject<HTMLCanvasElement>;
  readonly search: RefObject<HTMLInputElement>;
  readonly tagSearch: RefObject<HTMLInputElement>;
  readonly zoomReadout: RefObject<HTMLSpanElement>;
  readonly simNote: RefObject<HTMLSpanElement>;
  readonly tooltip: RefObject<HTMLDivElement>;
  readonly resetUndo: RefObject<HTMLSpanElement>;
}

/** A setting a checkbox turns on and off. */
export type ToggleKey = 'showNotes' | 'showTasks' | 'showTags' | 'showOrphans' | 'showParked' | 'onlyWrittenLinks' | 'showAllLinks';
/** A setting a slider sets. */
export type SliderKey =
  | 'nodeSize' | 'linkThickness' | 'linkDensity' | 'tagSpecificity' | 'bridgeStrength' | 'labelThreshold'
  | 'centerStrength' | 'clusterCohesion' | 'communitySpacing' | 'repelStrength' | 'linkStrength' | 'linkDistance';

/** What each control does, which the page supplies. */
export interface ControlHandlers {
  /** Around this note or Pass through daily notes changed. */
  readonly scope: (event: Event) => void;
  readonly depthInput: (event: Event) => void;
  readonly depthChange: (event: Event) => void;
  readonly toggle: (key: ToggleKey, event: Event) => void;
  readonly slider: (key: SliderKey, event: Event) => void;
  readonly headings: (value: string) => void;
  readonly searchInput: () => void;
  readonly tagSearchInput: () => void;
  readonly tagToggle: (key: string, event: Event) => void;
  readonly clearTags: () => void;
  readonly groupChange: (event: Event) => void;
  readonly zoom: (button: 'in' | 'out' | 'fit', event: Event) => void;
  readonly reset: () => void;
  readonly resetUndoClick: (event: Event) => void;
}

/** What the controls are drawn from. */
export interface ControlsProps {
  readonly ui: ControlsState;
  readonly settings: GraphSettings;
  readonly graph: GraphState;
  readonly refs: ControlRefs;
  readonly on: ControlHandlers;
}

/** The legend's words for its sliders' fifths. */
const FEWEST_TO_MOST = 'fewest,fewer,about half,more,most';
/** The legend's words for Favor rare tags. */
const LEAST_TO_MOST = 'least,less,about half,more,most';
/** How many tags the list draws before it says how many more there are. */
const MAXIMUM_TAG_ROWS = 200;

/** Everything in the body around the canvas, in the template's order. */
export function GraphBody(props: ControlsProps) {
  const { ui, refs } = props;
  return (
    <>
      {' '}
      <canvas
        id="graph"
        tabIndex={0}
        role="application"
        aria-label="Notes graph. Press Tab or the arrow keys to move between nodes, Enter to open one, Alt+Enter to open it beside the graph, Escape to clear."
        aria-describedby="graph-legend"
        ref={refs.canvas}
      />
      {' '}
      <div class="empty-state" id="empty-state" style={ui.emptyDisplay === undefined ? undefined : { display: ui.emptyDisplay }}>
        No indexed notes yet — save a Markdown file with tags or links.
      </div>
      {' '}
      <div class="overlay" role="group" aria-label="Graph controls">
        {' '}
        <FocusGroup {...props} />
        {' '}
        <FiltersGroup {...props} />
        {' '}
        <DisplayGroup {...props} />
        {' '}
        <ForcesGroup {...props} />
        {' '}
        <RelationshipsGroup />
        {' '}
      </div>
      {' '}
      <ZoomControls {...props} />
      {' '}
      <StatusLine {...props} />
      {' '}
      <div class="tooltip" id="tooltip" aria-hidden="true" ref={refs.tooltip} />
    </>
  );
}

/** A folding group of controls, open or closed to begin with. */
function ControlGroup({ title, open, extraClass, children }: {
  readonly title: string;
  readonly open?: boolean;
  readonly extraClass?: string;
  readonly children: ComponentChildren;
}) {
  return (
    <details class={extraClass ? `control-group ${extraClass}` : 'control-group'} open={open}>
      {' '}
      <summary>{title}</summary>
      {' '}
      <div class="control-body">{children}</div>
      {' '}
    </details>
  );
}

/** A checkbox and its label, a space between them. */
function Toggle({ id, tip, label, checked, onChange }: {
  readonly id: string;
  readonly tip: string;
  readonly label: string;
  readonly checked: unknown;
  readonly onChange: (event: Event) => void;
}) {
  return (
    <label class="toggle-row">
      <input type="checkbox" id={id} checked={checked as boolean} data-tip={tip} onChange={onChange} />
      {` ${label}`}
    </label>
  );
}

/** A setting's checkbox. */
function SettingToggle({ props, id, setting, tip, label }: {
  readonly props: ControlsProps;
  readonly id: string;
  readonly setting: ToggleKey;
  readonly tip: string;
  readonly label: string;
}) {
  return <Toggle id={id} tip={tip} label={label} checked={props.settings[setting]} onChange={(event) => props.on.toggle(setting, event)} />;
}

/** What a slider is, beside its value. */
interface SliderSpec {
  readonly id: string;
  readonly setting: SliderKey;
  readonly label: string;
  readonly tip: string;
  readonly min: string;
  readonly max: string;
  readonly step: string;
  /** Decimals its number is said with, in its output. */
  readonly decimals?: number;
  /** For a slider with no number worth reading: its ends, and a word for each fifth. */
  readonly words?: { readonly low: string; readonly high: string; readonly list: string };
}

/**
 * A slider said as a word a screen reader says: by which fifth of its range
 * it is in, or its value when that has no word.
 */
function sliderWord(spec: SliderSpec, value: unknown): string {
  const words = (spec.words as NonNullable<SliderSpec['words']>).list.split(',');
  const min = Number(spec.min);
  const span = Number(spec.max) - min || 1;
  const fifth = Math.min(4, Math.floor(((Number(value) - min) / span) * 5));
  return words[Math.max(0, fifth)] || String(value);
}

/** A setting's slider, with its number in an output, or its ends in words. */
function SettingSlider({ props, spec }: { readonly props: ControlsProps; readonly spec: SliderSpec }) {
  const value = props.settings[spec.setting];
  const onInput = (event: Event) => props.on.slider(spec.setting, event);
  const input = (
    <input
      type="range"
      id={spec.id}
      data-tip={spec.tip}
      data-words={spec.words ? spec.words.list : undefined}
      min={spec.min}
      max={spec.max}
      step={spec.step}
      aria-valuetext={spec.words ? sliderWord(spec, value) : undefined}
      value={String(value)}
      onInput={onInput}
    />
  );
  return (
    <div class="control-row">
      <label for={spec.id}>{spec.label}</label>
      {spec.words
        ? <div class="slider-line"><span class="slider-end" aria-hidden="true">{spec.words.low}</span>{input}<span class="slider-end" aria-hidden="true">{spec.words.high}</span></div>
        : <div class="slider-line">{input}<output id={`${spec.id}-out`}>{Number(value).toFixed(spec.decimals)}</output></div>}
    </div>
  );
}

/** Focus: the graph around the note in the editor, how far out, and whether daily notes are passed through. */
function FocusGroup({ ui, on }: ControlsProps) {
  const { focus } = ui;
  return (
    <ControlGroup title="Focus" open>
      {' '}
      <Toggle id="local-graph" tip="Draw only the note open in the editor and what it is connected to." label="Around this note" checked={focus.local} onChange={on.scope} />
      {' '}
      <div class="control-row">
        <label for="local-depth">Hops out</label>
        <div class="slider-line">
          <input type="range" id="local-depth" data-tip="How many connections out from the note the graph reaches." min="1" max="3" step="1" value={focus.depth} onInput={on.depthInput} onChange={on.depthChange} />
          <output id="local-depth-out">{focus.depth}</output>
        </div>
      </div>
      {' '}
      <label class="toggle-row">
        <input type="checkbox" id="skip-periodic" checked={focus.skipPeriodic} disabled={focus.skipDisabled} data-tip="Pass through daily, weekly, and monthly notes" onChange={on.scope} />
        {' Pass through daily notes'}
      </label>
      {' '}
      <p class="focus-note" id="focus-note">{focus.note}</p>
      {' '}
    </ControlGroup>
  );
}

/** Filters: the search, what kinds of node are drawn, the tag list, and the group picked. */
function FiltersGroup(props: ControlsProps) {
  const { on, refs } = props;
  return (
    <ControlGroup title="Filters" open>
      {' '}
      <input class="graph-search" id="search" type="search" placeholder="Search notes…" aria-label="Search graph nodes" data-tip="Filter note, task, and tag titles and file paths." ref={refs.search} onInput={on.searchInput} />
      {' '}
      <SettingToggle props={props} id="show-notes" setting="showNotes" tip="Show or hide note nodes and their visible links." label="Show notes" />
      {' '}
      <SettingToggle props={props} id="show-tasks" setting="showTasks" tip="Show or hide task nodes and their visible links." label="Show tasks" />
      {' '}
      <SettingToggle props={props} id="show-tags" setting="showTags" tip="Show tag nodes and tag links; hidden tags still guide clustering." label="Show tags" />
      {' '}
      <SettingToggle props={props} id="show-orphans" setting="showOrphans" tip="Show nodes with no currently visible connections." label="Show orphans" />
      {' '}
      <SettingToggle props={props} id="only-written-links" setting="onlyWrittenLinks" tip="Draw only the wiki links written in your notes. Headings and tags still place each note, but are not drawn." label="Only links I wrote" />
      {' '}
      <SettingToggle props={props} id="show-parked" setting="showParked" tip="Show parked notes, tasks, and tags. They are hidden unless this is on." label="Show parked" />
      {' '}
      <input class="tag-search" id="tag-search" type="search" placeholder="Filter tag list…" aria-label="Filter tag checklist" data-tip="Narrow the tag checklist without changing the graph." ref={refs.tagSearch} onInput={on.tagSearchInput} />
      {' '}
      <div class="tag-list" id="tag-list" role="group" aria-label="Tag filters"><TagRows {...props} /></div>
      {' '}
      <GroupRow {...props} />
      {' '}
      <button class="clear-tags" id="clear-tags" type="button" data-tip="Remove the tag filters and the group picked out." onClick={on.clearTags}>Clear filters</button>
      {' '}
    </ControlGroup>
  );
}

/** The tag checklist: the first 200 tags under the filter, then how many more, or that none match. */
function TagRows({ ui, settings, on }: ControlsProps) {
  if (!ui.tagList) {
    return null;
  }
  const filter = ui.tagList.filter.trim().toLowerCase();
  const selected: Record<string, true> = {};
  settings.selectedTags.forEach((key) => {
    selected[key] = true;
  });
  const rows = [];
  let total = 0;
  for (const [key, label, count] of ui.tagList.tags) {
    if (filter && label.toLowerCase().indexOf(filter) === -1) {
      continue;
    }
    total += 1;
    if (rows.length >= MAXIMUM_TAG_ROWS) {
      continue;
    }
    rows.push(
      <label class="toggle-row" key={key}>
        <input type="checkbox" checked={Boolean(selected[key])} data-tip={`Filter to nodes carrying the ${label} tag.`} onChange={(event) => on.tagToggle(key, event)} />
        <span>{label}</span>
        <span class="tag-count">{String(count)}</span>
      </label>,
    );
  }
  return (
    <>
      {rows}
      {total > rows.length ? <div class="tag-list-note">{`${total - rows.length} more — refine the tag filter`}</div> : null}
      {total === 0 ? <div class="tag-list-note">No matching tags</div> : null}
    </>
  );
}

/** The Group list: every named group, largest first, shown once there are two. */
function GroupRow({ ui, graph, on }: ControlsProps) {
  const { groups } = graph;
  const order: number[] = [];
  groups.forEach((group, community) => {
    if (group) {
      order.push(community);
    }
  });
  order.sort((left, right) => (groups[right]?.size ?? 0) - (groups[left]?.size ?? 0) || left - right);
  return (
    <div class="control-row" id="group-row" hidden={graph.namedGroupCount < 2}>
      <label for="group-filter">Group</label>
      <select
        class="graph-select"
        id="group-filter"
        data-tip="Pick out one group: the others dim, and the view frames it. A click on a group's name does the same."
        value={ui.groupValue as string | undefined}
        onChange={on.groupChange}
      >
        <option value="">All groups</option>
        {order.map((community) => {
          const group = groups[community] as NonNullable<(typeof groups)[number]>;
          return <option value={group.key}>{`${group.name} (${group.size})`}</option>;
        })}
      </select>
    </div>
  );
}

/** Display: how nodes, links, labels, and headings are drawn, with the rarer choices under Advanced. */
function DisplayGroup(props: ControlsProps) {
  return (
    <ControlGroup title="Display">
      {' '}
      <SettingSlider props={props} spec={{ id: 'node-size', setting: 'nodeSize', label: 'Node size', tip: 'Scale node circles; larger nodes make highly connected items easier to spot.', min: '0.5', max: '3', step: '0.1', decimals: 1 }} />
      {' '}
      <SettingSlider props={props} spec={{ id: 'link-thickness', setting: 'linkThickness', label: 'Link thickness', tip: 'Scale the width of visible edges.', min: '0.5', max: '3', step: '0.1', decimals: 1 }} />
      {' '}
      <SettingSlider props={props} spec={{ id: 'link-density', setting: 'linkDensity', label: 'Links per note', tip: 'How many of each note\'s strongest links are drawn. Fewer is easier to read. The sidebar\'s connections do not change.', min: '0.15', max: '1', step: '0.05', words: { low: 'Fewer', high: 'More', list: FEWEST_TO_MOST } }} />
      {' '}
      <SettingSlider props={props} spec={{ id: 'label-threshold', setting: 'labelThreshold', label: 'Label fade zoom', tip: 'Set the zoom level where node labels begin to appear; higher values keep labels hidden longer.', min: '0.5', max: '4', step: '0.1', decimals: 1 }} />
      {' '}
      <HeadingsChoice {...props} />
      {' '}
      <ControlGroup title="Advanced" extraClass="advanced">
        {' '}
        <SettingSlider props={props} spec={{ id: 'tag-specificity', setting: 'tagSpecificity', label: 'Favor rare tags', tip: 'How much more a tag on a few notes counts than a tag on nearly every note, when choosing which links to draw.', min: '0', max: '1', step: '0.05', words: { low: 'Less', high: 'More', list: LEAST_TO_MOST } }} />
        {' '}
        <SettingSlider props={props} spec={{ id: 'bridge-strength', setting: 'bridgeStrength', label: 'Links between groups', tip: 'How strongly a note\'s other tags pull it toward other groups.', min: '0', max: '1', step: '0.05', words: { low: 'Fewer', high: 'More', list: FEWEST_TO_MOST } }} />
        {' '}
        <SettingToggle props={props} id="show-all-links" setting="showAllLinks" tip="Draw every link rather than each note's strongest. Busy on a large workspace." label="Show every link" />
        {' '}
      </ControlGroup>
      {' '}
    </ControlGroup>
  );
}

/** One of the Headings choices, pressed when it is the setting. */
function HeadingsButton({ props, value, tip, label }: {
  readonly props: ControlsProps;
  readonly value: string;
  readonly tip: string;
  readonly label: string;
}) {
  return (
    <button type="button" data-headings={value} aria-pressed={props.settings.headings === value} data-tip={tip} onClick={() => props.on.headings(value)}>
      {label}
    </button>
  );
}

/** Headings: by zoom, always, or never drawn as nodes of their own. */
function HeadingsChoice(props: ControlsProps) {
  return (
    <div class="control-row">
      <span class="control-label" id="headings-label">Headings</span>
      <div class="segmented graph-segmented" role="group" aria-labelledby="headings-label">
        <HeadingsButton props={props} value="zoom" tip="Zoomed out, draw each file as one node; zoomed in past Label fade zoom, draw its headings." label="By zoom" />
        <HeadingsButton props={props} value="always" tip="Draw every heading as a node of its own, at every zoom." label="Always" />
        <HeadingsButton props={props} value="never" tip="Draw each file as one node, at every zoom." label="Never" />
      </div>
    </div>
  );
}

/** Forces: how the simulation pulls and pushes. */
function ForcesGroup(props: ControlsProps) {
  return (
    <ControlGroup title="Forces">
      {' '}
      <SettingSlider props={props} spec={{ id: 'center-strength', setting: 'centerStrength', label: 'Cluster centering', tip: 'Pull community anchors gently toward the center of the viewport.', min: '0', max: '1', step: '0.05', decimals: 2 }} />
      {' '}
      <SettingSlider props={props} spec={{ id: 'cluster-cohesion', setting: 'clusterCohesion', label: 'Cluster cohesion', tip: 'Strengthen or weaken the pull from notes and tasks toward their detected community anchor.', min: '0.5', max: '3', step: '0.1', decimals: 1 }} />
      {' '}
      <SettingSlider props={props} spec={{ id: 'community-spacing', setting: 'communitySpacing', label: 'Community spacing', tip: 'Increase or reduce the distance between detected communities; changing it recomputes the layout framing.', min: '0.6', max: '2.5', step: '0.1', decimals: 1 }} />
      {' '}
      <SettingSlider props={props} spec={{ id: 'repel-strength', setting: 'repelStrength', label: 'Repel strength', tip: 'Increase or reduce node-to-node repulsion; higher values spread crowded nodes apart.', min: '50', max: '2000', step: '25', decimals: 0 }} />
      {' '}
      <SettingSlider props={props} spec={{ id: 'link-strength', setting: 'linkStrength', label: 'Link strength', tip: 'Increase or reduce the spring force along visible links.', min: '0', max: '2', step: '0.05', decimals: 2 }} />
      {' '}
      <SettingSlider props={props} spec={{ id: 'link-distance', setting: 'linkDistance', label: 'Link distance', tip: 'Set the target length of visible links; larger values spread connected nodes farther apart.', min: '10', max: '200', step: '5', decimals: 0 }} />
      {' '}
    </ControlGroup>
  );
}

/** Relationships: how the graph groups notes and chooses what to draw, in words. */
function RelationshipsGroup() {
  return (
    <ControlGroup title="Relationships">
      {' '}
      <p class="relationship-note">The graph uses prevalence-aware groups: direct Wiki links and headings seed strong groups, while tag membership is discounted when a tag is too rare or too widespread. Hidden tags act as virtual anchors rather than high-mass particles, and each node keeps only its strongest local connections.</p>
      {' '}
      <p class="relationship-note">Each group is named after the tags its notes carry more than the rest of the workspace does.</p>
      {' '}
      <p class="relationship-note">Links per note controls that local budget. The status line reports strong links retained versus all indexed links; Connected Nodes in the sidebar still uses the complete graph.</p>
      {' '}
      <p class="relationship-note">Selecting a node highlights its direct graph neighbors and lists those same note, task, and tag nodes in the sidebar. Related Notes ranking remains exclusive to Markdown pages.</p>
      {' '}
    </ControlGroup>
  );
}

/** A magnifying glass, with a plus for zooming in, as the host's `zoomInIcon` and `zoomOutIcon` draw it. */
function ZoomIcon({ plus }: { readonly plus: boolean }) {
  return (
    <svg class="toolbar-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="7" cy="7" r="4.5" />
      <path d={plus ? 'm10.5 10.5 3 3M7 5v4M5 7h4' : 'm10.5 10.5 3 3M5 7h4'} />
    </svg>
  );
}

/** Zoom out and in, the zoom, Fit graph, Reset graph, and Reset's Undo. */
function ZoomControls({ ui, refs, on }: ControlsProps) {
  return (
    <div class="graph-zoom-controls">
      {' '}
      <div class="zoom-controls" role="group" aria-label="Zoom controls">
        {' '}
        <button type="button" id="zoom-out" aria-label="Zoom out" data-tip="Zoom out the graph." onClick={(event) => on.zoom('out', event)}><ZoomIcon plus={false} /></button>
        {' '}
        <span class="zoom-readout" id="zoom-readout" ref={refs.zoomReadout}>100%</span>
        {' '}
        <button type="button" id="zoom-in" aria-label="Zoom in" data-tip="Zoom in the graph." onClick={(event) => on.zoom('in', event)}><ZoomIcon plus /></button>
        {' '}
        <button type="button" id="zoom-fit" aria-label="Fit graph to view" data-tip="Fit the full graph in the current view." onClick={(event) => on.zoom('fit', event)}>Fit graph</button>
        {' '}
      </div>
      {' '}
      <button class="reset-graph-settings" id="reset-graph-settings" type="button" data-tip="Restore all graph controls and filters, clear node momentum, and reframe the graph. Undo is offered for a few seconds." onClick={on.reset}>Reset graph</button>
      {' '}
      <span class="graph-reset-undo" id="graph-reset-undo" role="status" aria-live="polite" ref={refs.resetUndo} onClick={on.resetUndoClick}>
        {ui.resetUndo === 'offer' ? <UndoNotice message="Graph reset." action="undo-graph-reset" buttonClass="reset-graph-settings" /> : null}
        {ui.resetUndo === 'restored' ? 'Graph settings restored.' : null}
      </span>
      {' '}
    </div>
  );
}

/** A 16×8 line sample for the legend, dashed as the canvas dashes that kind of edge. */
function LegendLine({ kind, dash, hidden }: { readonly kind: string; readonly dash?: string; readonly hidden?: boolean }) {
  return (
    <svg class="legend-line" data-legend={kind} viewBox="0 0 16 8" aria-hidden="true" focusable="false" hidden={hidden}>
      <line x1="1" y1="4" x2="15" y2="4" stroke-dasharray={dash} stroke-linecap={kind === 'tag' ? 'round' : undefined} />
    </svg>
  );
}

/**
 * The legend, the status line, and Simulating. The legend shows lines
 * through a daily note, the sample and its words, only while there are
 * any. The sample is an SVG element, which has no `hidden` property, so
 * it is hidden by its attribute, which the page's sheet reads.
 */
function StatusLine({ ui, refs }: ControlsProps) {
  return (
    <div class="status-line">
      <span id="graph-legend" class="graph-legend">
        <span class="legend-swatch legend-note" />Notes
        <span class="legend-swatch legend-task" />Tasks
        <span class="legend-swatch legend-tag" />Tags
        <LegendLine kind="wiki" />
        <span class="legend-word">Wiki link</span>
        <LegendLine kind="heading" dash="5 3" />
        <span class="legend-word">Heading</span>
        <LegendLine kind="tag" dash="1 3" />
        <span class="legend-word">Tag</span>
        <LegendLine kind="joined" dash="8 3 1 3" hidden={!ui.status.joinedShown} />
        <span class="legend-word" data-legend="joined" hidden={!ui.status.joinedShown}>Through a daily note</span>
      </span>
      <span id="status-counts">{ui.status.text}</span>
      <span class="sim-note" id="sim-note" hidden ref={refs.simNote}>Simulating…</span>
    </div>
  );
}
