import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '..', '..');

/** The largest icon the Marketplace takes, on either side, in pixels. */
const MARKETPLACE_ICON_LIMIT = 1024;

/** A PNG's width and height, read from its IHDR chunk, which every PNG writes first. */
function readPngSize(file: string): { width: number; height: number } {
  const bytes = fs.readFileSync(file);
  assert.strictEqual(bytes.toString('ascii', 12, 16), 'IHDR', `${file} is a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

suite('Marketplace icon', () => {
  test('the manifest’s icon is a PNG no larger than the Marketplace takes, so publishing it is not refused', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { icon: string };
    const { width, height } = readPngSize(path.join(root, manifest.icon));
    assert.ok(
      width <= MARKETPLACE_ICON_LIMIT && height <= MARKETPLACE_ICON_LIMIT,
      `${manifest.icon} is ${width}×${height}; the Marketplace refuses an icon over ${MARKETPLACE_ICON_LIMIT}×${MARKETPLACE_ICON_LIMIT}`,
    );
  });
});
