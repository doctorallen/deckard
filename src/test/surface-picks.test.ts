import * as assert from 'assert';

import { pickSurfaces } from '../../test/harness/surfacePicks';

/** Two surfaces of one page, as the Task Board has, and a page with one. */
const SURFACES = [
  { page: 'taskBoard', name: 'taskBoard' },
  { page: 'taskBoard', name: 'taskBoardByTag' },
  { page: 'dashboard' },
];

suite('Picking the surfaces a harness draws', () => {
  test('names each surface by its own name, so no two share a file', () => {
    const names = pickSurfaces(SURFACES, undefined, 'corpo').map(({ name }) => name);
    assert.deepStrictEqual(names, ['taskBoard', 'taskBoardByTag', 'dashboard']);
    assert.strictEqual(new Set(names).size, names.length);
  });

  test('picks one surface of a page alone, or the whole page', () => {
    const picked = (only: string) => pickSurfaces(SURFACES, only, 'fellowship+zen').map(({ name }) => name);
    assert.deepStrictEqual(picked('taskBoardByTag'), ['taskBoardByTag']);
    assert.deepStrictEqual(picked('fellowship+zen:taskBoardByTag'), ['taskBoardByTag']);
    assert.deepStrictEqual(picked('taskBoard'), ['taskBoard', 'taskBoardByTag'], 'a page picks every surface of it');
    assert.deepStrictEqual(picked('fellowship+zen'), ['taskBoard', 'taskBoardByTag', 'dashboard']);
    assert.deepStrictEqual(picked('corpo'), []);
  });
});
