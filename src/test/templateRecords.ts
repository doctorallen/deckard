import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

/** Where the recordings are kept, one file per suite. */
const FOLDER = path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'template');

/**
 * What the template page scripts drew and returned, as the suites that held
 * the Preact pages to them recorded it before Phase 6 step 7 deleted the
 * scripts (getComponentScript and getQueryEditorScript in
 * src/ui/webview/components.ts). Each suite compared a shared component with
 * the template helper it replaced; the helper's side is now this recording,
 * so a component that stops drawing what the template drew still fails.
 *
 * A recording is HTML as the helper wrote it, a body as test:dom normalizes
 * it, or a value, under the name the suite gives the case. Asking for a name
 * that was never recorded fails, so a case cannot pass by having nothing to
 * compare with. The recordings are never rewritten: they are the template's,
 * and the template is gone.
 * @param suite The suite's file name without `.test.ts`, which names its recording.
 * @returns The recording of a case, by name.
 */
export function templateRecords(suite: string): <T = string>(name: string) => T {
  const records = JSON.parse(fs.readFileSync(path.join(FOLDER, `${suite}.json`), 'utf8')) as Record<string, unknown>;
  return <T>(name: string): T => {
    assert.ok(Object.prototype.hasOwnProperty.call(records, name), `the template never recorded ${JSON.stringify(name)}`);
    return records[name] as T;
  };
}
