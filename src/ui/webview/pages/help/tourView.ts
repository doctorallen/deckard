/**
 * Help's Tour tab, described by the host as a tree the page builds (plan
 * 48, section 4): the scene shown, its step, and the way to present it.
 */
import type { HelpViewNode } from '../../../protocol/help';
import { TOUR_CHAPTERS, TOUR_SCENES, type TourScene } from '../../../state/tour';
import type { TourState } from '../../tour';
import { h, inlineText } from './helpView';

/** A step's mark in the progress bar: the scene shown, a scene done, or none. */
function stepMark(state: TourState, scene: TourScene, index: number): string {
  if (index === state.progress.scene) {
    return ' is-current';
  }
  return state.progress.done.includes(scene.id) ? ' is-done' : '';
}

/** What the scene's forward button says: Finish on the last, Next once done, else Skip. */
function forwardLabel(last: boolean, done: boolean): string {
  if (last) {
    return 'Finish';
  }
  return done ? 'Next' : 'Skip';
}

/** Every scene of a chapter, with its place in the tour. */
function scenesOf(chapter: string): Array<{ scene: TourScene; index: number }> {
  return TOUR_SCENES.map((scene, index) => ({ scene, index })).filter(({ scene }) => scene.chapter === chapter);
}

/** The progress bar: a step per scene, a group per chapter. */
function progressBar(state: TourState): HelpViewNode {
  return h(
    'div',
    { class: 'tour-progress', role: 'list', 'aria-label': 'Scenes' },
    TOUR_CHAPTERS.map((chapter) => {
      const scenes = scenesOf(chapter);
      const group = h(
        'span',
        { class: 'tour-progress-chapter' },
        scenes.map(({ scene, index }) =>
          h('button', {
            type: 'button',
            role: 'listitem',
            class: `tour-progress-step${stepMark(state, scene, index)}`,
            'data-help-action': 'tour-go',
            'data-index': index,
            'aria-label': `Scene ${index + 1}: ${scene.title}${state.progress.done.includes(scene.id) ? ', done' : ''}`,
            'aria-current': index === state.progress.scene ? 'step' : undefined,
          }),
        ),
      );
      return { ...group, flex: scenes.length };
    }),
  );
}

/** The scene shown: its words, its step, and the ways on. */
function sceneView(state: TourState, scene: TourScene, index: number): HelpViewNode[] {
  const done = state.progress.done.includes(scene.id);
  const last = index === TOUR_SCENES.length - 1;
  const [page, anchor] = scene.guide.split('#');
  return [
    progressBar(state),
    h(
      'div',
      { class: 'help-this-head' },
      h(
        'div',
        null,
        h('p', { class: 'help-eyebrow' }, `Tour · ${scene.chapter} · ${index + 1} of ${TOUR_SCENES.length}${scene.optional ? ' · optional' : ''}`),
        h('h1', null, scene.title),
      ),
      h('button', { type: 'button', 'data-help-action': 'tour-end' }, 'End tour'),
    ),
    h('p', null, inlineText(scene.body)),
    h(
      'div',
      { class: `tour-step${done ? ' is-done' : ''}` },
      h('p', { class: 'help-eyebrow' }, 'Try it'),
      h('label', { class: 'tour-tick' }, h('input', { type: 'checkbox', 'data-tour-tick': scene.id, checked: done }), ' ', h('span', null, inlineText(scene.step))),
      scene.do && h('button', { type: 'button', 'data-help-action': 'tour-do' }, scene.do.label),
    ),
    h(
      'div',
      { class: 'help-actions' },
      h('button', { type: 'button', 'data-help-action': 'tour-again' }, 'Show me again'),
      h('button', { type: 'button', 'data-help-action': 'tour-previous', disabled: index === 0 }, 'Back'),
      h('button', { type: 'button', 'data-help-action': last ? 'tour-end' : 'tour-next' }, forwardLabel(last, done)),
    ),
    h('button', { type: 'button', class: 'help-link', 'data-help-action': 'open-guide', 'data-page': page, 'data-anchor': anchor ?? '' }, 'More in the guide'),
  ];
}

/** Presenting: Present, the option to close Help, and making the sample new again. */
function presenting(state: TourState): HelpViewNode {
  return h(
    'section',
    { class: 'tour-present', 'aria-labelledby': 'tour-present-title' },
    h('h2', { id: 'tour-present-title' }, 'Demonstrating Deckard'),
    h(
      'p',
      null,
      'A status bar item names the scene and holds its talking point; ',
      h('kbd', null, 'Ctrl'),
      '+',
      h('kbd', null, 'Alt'),
      '+',
      h('kbd', null, ']'),
      ' and ',
      h('kbd', null, 'Ctrl'),
      '+',
      h('kbd', null, 'Alt'),
      '+',
      h('kbd', null, '['),
      ' move on and back. Nothing moves on by itself.',
    ),
    h('label', { class: 'setting-check' }, h('input', { type: 'checkbox', 'data-tour-option': 'hide-help', checked: state.hideHelp }), ' Hide Help while presenting'),
    h(
      'div',
      { class: 'help-actions' },
      state.presenting
        ? h('button', { type: 'button', 'data-help-action': 'tour-stop' }, 'End presenting')
        : [
            h('button', { type: 'button', 'data-help-action': 'tour-reset' }, 'Reset the sample to today'),
            h('button', { type: 'button', 'data-help-action': 'tour-present' }, 'Present'),
          ],
    ),
  );
}

/** The Tour's heading, before a scene is shown. */
function tourHead(): HelpViewNode {
  return h('div', { class: 'help-this-head' }, h('div', null, h('p', { class: 'help-eyebrow' }, 'Tour'), h('h1', null, 'Introduction to Deckard')));
}

/** The Tour tab's content. */
export function renderTour(state: TourState): HelpViewNode[] {
  if (!state.inSample) {
    return [
      tourHead(),
      h('p', null, 'The tour walks through Deckard on the work sample: six weeks aboard the Petrel, a small survey and hauling ship. Make the sample, and the tour opens in its window.'),
      h('p', null, h('button', { type: 'button', class: 'primary', 'data-help-action': 'tour-create-sample' }, 'Create a Work Sample')),
    ];
  }
  if (state.started) {
    return [...sceneView(state, TOUR_SCENES[state.progress.scene], state.progress.scene), presenting(state)];
  }
  const resume = state.progress.scene > 0 || state.progress.done.length > 0;
  const optional = TOUR_SCENES.filter((scene) => scene.optional).length;
  return [
    tourHead(),
    h(
      'p',
      null,
      `${TOUR_SCENES.length} short scenes aboard the Petrel, about twelve minutes. Each opens a real page beside Help and gives you one thing to try. The last ${optional} are optional.`,
    ),
    h(
      'div',
      { class: 'help-actions' },
      h('button', { type: 'button', 'data-help-action': 'tour-go', 'data-index': resume ? state.progress.scene : 0 }, resume ? `Continue at scene ${state.progress.scene + 1}` : 'Start the tour'),
      resume && h('button', { type: 'button', 'data-help-action': 'tour-go', 'data-index': 0 }, 'Start over'),
    ),
    presenting(state),
  ];
}
