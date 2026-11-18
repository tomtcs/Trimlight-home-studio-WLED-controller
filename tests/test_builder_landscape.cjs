const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('Look Builder can resolve each mapped landscape button to its own WLED range', () => {
  const trace = (name, first, last) => ({
    id: 'line-1',
    kind: 'landscape',
    name,
    output: 4,
    first,
    last,
    points: [[20, 75], [80, 90]],
  });
  const settings = {
    channelCount: 4,
    outputs: [326, 271, 127, 14].map((leds, index) => ({
      leds,
      use: index === 3 ? 'landscape' : 'roof',
    })),
    previewSide: 'front',
    houseViews: {
      front: { lines: [trace('Front Landscape', 8, 14)] },
      left: { lines: [trace('Left Side Landscape Lighting', 1, 7)] },
    },
  };
  const window = { TL_SERVER_STATE: { has_settings: true, settings } };
  const context = vm.createContext({
    window,
    document: { readyState: 'loading', addEventListener() {} },
  });
  for (const name of ['demo-data.js', 'wled-settings.js', 'builder.js']) {
    vm.runInContext(readFileSync(join(__dirname, '..', 'site', name), 'utf8'), context, { filename: name });
  }

  const layout = window.TLSettings.layout();
  const runs = layout.runs.map(run => ({ ...run, stop: run.start + run.leds }));
  const roof = { id: 'roof-1', name: 'Left Side Roof', start: 0, stop: 82 };
  window.TLBuilder.init({
    N: 738,
    runs: () => runs,
    sections: () => [roof, ...layout.landscape],
  });

  const groups = window.TLBuilder.zoneGroups().filter(([, , range]) => range);
  const buttons = new Map(groups.map(([name, , range]) => [name, String(range.id)]));
  assert.equal(new Set(buttons.values()).size, 3);
  const resolve = name => groups.find(([, , range]) => range.id === buttons.get(name))[2];
  assert.equal(resolve('Left Side Roof').start, 0);
  assert.equal(resolve('Front Landscape').start, 731);
  assert.equal(resolve('Left Side Landscape Lighting').start, 724);
  assert.equal(resolve('Front Landscape').len, 7);
  assert.equal(resolve('Left Side Landscape Lighting').len, 7);
});
