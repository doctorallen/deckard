// Builds the walkthrough's images from the screenshots in docs/images, which
// `npm run capture:dashboard:all` and `capture:readme-screenshots` record.
// docs/** is not in the VSIX and resources/** is, so the walkthrough takes
// small copies: each box-downscaled to WIDTH, flattened onto its own
// background, and written without alpha, which keeps each under 150 KB.
// themes.png is a 2×2 of four Dashboard themes.
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { PNG } from 'pngjs';

const root = resolve(import.meta.dirname, '..');
const images = join(root, 'docs', 'images');
const out = join(root, 'resources', 'walkthrough');
const WIDTH = 960;

function read(name) {
  return PNG.sync.read(readFileSync(join(images, name)));
}

/** A box-filtered downscale to `width`, keeping the aspect ratio. */
function downscale(source, width, step = 4) {
  const scale = source.width / width;
  const height = Math.round(source.height / scale);
  const target = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * scale);
      const y0 = Math.floor(y * scale);
      const x1 = Math.min(source.width, Math.floor((x + 1) * scale));
      const y1 = Math.min(source.height, Math.floor((y + 1) * scale));
      const sum = [0, 0, 0];
      let count = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const at = (sy * source.width + sx) * 4;
          sum[0] += source.data[at];
          sum[1] += source.data[at + 1];
          sum[2] += source.data[at + 2];
          count++;
        }
      }
      const to = (y * width + x) * 4;
      // Rounded to steps of 4 (8 for a busy shot), which the eye does not
      // see and deflate likes.
      for (let c = 0; c < 3; c++) {
        target.data[to + c] = Math.min(255, Math.round(sum[c] / count / step) * step);
      }
      target.data[to + 3] = 255;
    }
  }
  return target;
}

function write(name, png) {
  const path = join(out, name);
  writeFileSync(path, PNG.sync.write(png, { colorType: 2, deflateLevel: 9 }));
  console.log(`${name}: ${png.width}×${png.height}, ${Math.round(statSync(path).size / 1024)} KB`);
}

write('home-dark.png', downscale(read('dashboard-corpo.png'), WIDTH));
write('home-light.png', downscale(read('dashboard-corpo-light.png'), WIDTH));
write('tasks.png', downscale(read('agenda.png'), WIDTH, 16));
write('search.png', downscale(read('notes-search.png'), WIDTH));

const tiles = ['corpo', 'replicant', 'lcars', 'cooper'].map((theme) =>
  downscale(read(`dashboard-${theme}.png`), WIDTH / 2),
);
const montage = new PNG({ width: WIDTH, height: tiles[0].height * 2 });
tiles.forEach((tile, i) => {
  PNG.bitblt(tile, montage, 0, 0, tile.width, tile.height, (i % 2) * tile.width, Math.floor(i / 2) * tile.height);
});
write('themes.png', montage);
