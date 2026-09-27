import * as assert from 'assert';

import { parseMarkdown } from '../core/markdown/parser';
import { decodeParsedFile, encodeParsedFile } from '../core/storage/parsedFileCodec';
import { ParsedFile } from '../core/types';
import {
  developmentNotes,
  edgeCaseNotes,
  parseNotes,
  randomNotes,
  sampleNotes,
} from './indexCorpus';

/** Encoded and decoded through fresh text, so no memo answers for it. */
function roundTrip(file: ParsedFile): ParsedFile {
  return decodeParsedFile(String(encodeParsedFile(file)));
}

suite('Parsed note cache codec', () => {
  test('gives back every note exactly as it was parsed', () => {
    const files = parseNotes([
      ...sampleNotes(),
      ...developmentNotes(),
      ...edgeCaseNotes(),
      ...randomNotes(5, 60),
      ['crlf.md', '# One #a\r\nline\r\n## Two #b\r\n- [ ] Task #c\r\nend'],
      ['no-newline.md', '# Last line has no newline #a'],
      ['trailing.md', '# Trailing newline #a\n\n'],
      ['emoji.md', '# Café 🎉 #tag/é\né combining marks\n- [ ] Due 📅 2026-10-02 ⏫ #x'],
    ]);
    files.forEach((file) => assert.deepStrictEqual(roundTrip(file), file, file.filePath));
  });

  test('stores a section text literally when its lines do not give it back', () => {
    const file = parseMarkdown('odd.md', '# Heading #a\nBody line');
    const odd: ParsedFile = structuredClone(file);
    odd.sections[0].rawContent = 'not the lines';
    odd.sections[0].bodyContent = 'nor these';
    odd.sections[0].filePath = 'elsewhere.md';
    assert.deepStrictEqual(roundTrip(odd), odd);
    assert.ok(encodeParsedFile(odd).includes('not the lines'));
    assert.ok(!encodeParsedFile(file).includes('"rawContent"'), 'a plain section is stored as its lines');
  });

  test('is under five times the size of the notes it holds', () => {
    const notes = [...sampleNotes(), ...developmentNotes(), ...randomNotes(9, 100)];
    const files = parseNotes(notes);
    const markdown = files.reduce((sum, file) => sum + Buffer.byteLength(file.content), 0);
    const encoded = files.reduce((sum, file) => sum + Buffer.byteLength(encodeParsedFile(file)), 0);
    assert.ok(encoded < markdown * 5, `${(encoded / markdown).toFixed(1)}×`);
  });

  test('refuses text it did not write', () => {
    assert.throws(() => decodeParsedFile('{"v":99}'));
    assert.throws(() => decodeParsedFile('not json'));
  });
});
