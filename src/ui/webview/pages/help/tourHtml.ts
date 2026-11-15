/**
 * Help's Tour tab, drawn by the host (plan 48, section 4): the scene shown,
 * its step, and the scenes, with what a presenter picks for a demo.
 */
import { escapeHtml } from '../../../../shared/html';
import { TOUR_CHAPTERS, TOUR_SCENES, type TourScene } from '../../../state/tour';
import type { TourState } from '../../tour';

/** A scene's words, with its **bold** names kept. */
function sceneText(text: string): string {
  return escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
}

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

/** The progress bar: a step per scene, a group per chapter. */
function progressBar(state: TourState): string {
  return `<div class="tour-progress" role="list" aria-label="Scenes">${TOUR_CHAPTERS.map((chapter) => {
    const scenes = TOUR_SCENES.map((scene, index) => ({ scene, index })).filter(({ scene }) => scene.chapter === chapter);
    return `<span class="tour-progress-chapter" style="flex:${scenes.length}">${scenes
      .map(({ scene, index }) => {
        const mark = stepMark(state, scene, index);
        return `<button type="button" role="listitem" class="tour-progress-step${mark}" data-help-action="tour-go" data-index="${index}" aria-label="Scene ${index + 1}: ${escapeHtml(scene.title)}${state.progress.done.includes(scene.id) ? ', done' : ''}"${index === state.progress.scene ? ' aria-current="step"' : ''}></button>`;
      })
      .join('')}</span>`;
  }).join('')}</div>`;
}

/** The scene shown: its words, its step, and the ways on. */
function sceneView(state: TourState, scene: TourScene, index: number): string {
  const done = state.progress.done.includes(scene.id);
  const last = index === TOUR_SCENES.length - 1;
  const [page, anchor] = scene.guide.split('#');
  return `${progressBar(state)}
<div class="help-this-head"><div><p class="help-eyebrow">Tour · ${escapeHtml(scene.chapter)} · ${index + 1} of ${TOUR_SCENES.length}${scene.optional ? ' · optional' : ''}</p><h1>${escapeHtml(scene.title)}</h1></div>
<button type="button" data-help-action="tour-end">End tour</button></div>
<p>${sceneText(scene.body)}</p>
<div class="tour-step${done ? ' is-done' : ''}">
  <p class="help-eyebrow">Try it</p>
  <label class="tour-tick"><input type="checkbox" data-tour-tick="${escapeHtml(scene.id)}"${done ? ' checked' : ''}> <span>${sceneText(scene.step)}</span></label>
  ${scene.do ? `<button type="button" data-help-action="tour-do">${escapeHtml(scene.do.label)}</button>` : ''}
</div>
<div class="help-actions">
  <button type="button" data-help-action="tour-again">Show me again</button>
  <button type="button" data-help-action="tour-previous"${index === 0 ? ' disabled' : ''}>Back</button>
  <button type="button" class="primary" data-help-action="${last ? 'tour-end' : 'tour-next'}">${forwardLabel(last, done)}</button>
</div>
<button type="button" class="help-link" data-help-action="open-guide" data-page="${escapeHtml(page)}" data-anchor="${escapeHtml(anchor ?? '')}">More in the guide</button>
${scenesList(state)}`;
}

/** Every scene by chapter, each with its box for the demo. */
function scenesList(state: TourState): string {
  return `<details class="tour-scenes"${state.started ? '' : ' open'}><summary>All scenes</summary>${TOUR_CHAPTERS.map(
    (chapter) => `<h3>${escapeHtml(chapter)}</h3><ul>${TOUR_SCENES.map((scene, index) => ({ scene, index }))
      .filter(({ scene }) => scene.chapter === chapter)
      .map(
        ({ scene, index }) => `<li><input type="checkbox" data-tour-demo="${escapeHtml(scene.id)}"${state.demo.includes(scene.id) ? ' checked' : ''} aria-label="Include ${escapeHtml(scene.title)} in the demo"> <button type="button" class="help-link" data-help-action="tour-go" data-index="${index}"${index === state.progress.scene && state.started ? ' aria-current="step"' : ''}>${index + 1}. ${escapeHtml(scene.title)}</button>${scene.optional ? ' <span class="help-chip">optional</span>' : ''}${state.progress.done.includes(scene.id) ? ' <span class="tour-done" aria-label="done">✓</span>' : ''}</li>`,
      )
      .join('')}</ul>`,
  ).join('')}<p class="help-note">The boxes pick the scenes Present shows.</p></details>`;
}

/** Presenting: Present, the option to close Help, and making the sample new again. */
function presenting(state: TourState): string {
  return `<section class="tour-present" aria-labelledby="tour-present-title"><h2 id="tour-present-title">Demonstrating Deckard</h2>
<p>Present shows the scenes you picked. A status bar item names the scene and holds its talking point; <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>]</kbd> and <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>[</kbd> move on and back. Nothing moves on by itself.</p>
<label class="setting-check"><input type="checkbox" data-tour-option="hide-help"${state.hideHelp ? ' checked' : ''}> Hide Help while presenting</label>
<div class="help-actions">${state.presenting
    ? '<button type="button" data-help-action="tour-stop">End presenting</button>'
    : `<button type="button" data-help-action="tour-reset">Reset the sample to today</button><button type="button" class="primary" data-help-action="tour-present">Present ${state.demo.length} scenes</button>`}</div></section>`;
}

/** The Tour tab's HTML. */
export function renderTour(state: TourState): string {
  if (!state.inSample) {
    return `<div class="help-this-head"><div><p class="help-eyebrow">Tour</p><h1>Introduction to Deckard</h1></div></div>
<p>The tour walks through Deckard on the work sample: six weeks aboard the Corvid, a small survey and hauling ship. Make the sample, and the tour opens in its window.</p>
<p><button type="button" class="primary" data-help-action="tour-create-sample">Create a Work Sample</button></p>`;
  }
  if (state.started) {
    return sceneView(state, TOUR_SCENES[state.progress.scene], state.progress.scene) + presenting(state);
  }
  const resume = state.progress.scene > 0 || state.progress.done.length > 0;
  return `<div class="help-this-head"><div><p class="help-eyebrow">Tour</p><h1>Introduction to Deckard</h1></div></div>
<p>${TOUR_SCENES.length} short scenes aboard the Corvid, about twelve minutes. Each opens a real page beside Help and gives you one thing to try. The last ${TOUR_SCENES.filter((scene) => scene.optional).length} are optional.</p>
<div class="help-actions"><button type="button" class="primary" data-help-action="tour-go" data-index="${resume ? state.progress.scene : 0}">${resume ? `Continue at scene ${state.progress.scene + 1}` : 'Start the tour'}</button>${resume ? '<button type="button" data-help-action="tour-go" data-index="0">Start over</button>' : ''}</div>
${presenting(state)}
${scenesList(state)}`;
}
