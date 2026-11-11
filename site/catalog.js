/* Trimlight Studio v2 — catalog of built-in looks + color themes.
   Every look IS a set of WLED segment settings (what Push sends), so the preview (tlfx.js) and the roof run the same thing.
   fx/pal ids follow WLED's effect catalog. col = [color1, color2, color3]. sx/ix/c1–c3 0–255. spc = dark bulbs between lit ones.
   labels: friendly names for that look's sliders (anything not listed falls back to WLED's own fxdata names; '' hides it). */
(function (g) {
  'use strict';
  const AUTUMN = [[190, 10, 0], [255, 55, 0], [255, 120, 0]];
  const TEAM = { navy: [0, 30, 120], green: [100, 255, 0], blue: [0, 90, 255], grey: [70, 90, 120] };
  const XMAS = [[220, 0, 0], [0, 170, 30], [255, 150, 0]];
  const L = (id, name, cats, desc, fx, o) => Object.assign({ id, name, cats, desc, fx, pal: 5, col: AUTUMN, sx: 128, ix: 128, spc: 0, bri: 180 }, o);
  const TW = { sx: 'Twinkle speed', ix: 'How many twinkle' };

  const LOOKS = [
    // ---------- featured presets ----------
    L('autumn-twinkle', 'Autumn Twinkle', ['fall'], 'Slow twinkle & fade in deep red, orange and gold', 80,
      { pal: 5, col: [[190, 10, 0], [255, 85, 0], [255, 185, 0]], sx: 55, ix: 150, labels: { ...TW, c1: '', o1: 'Cooler fades' }, hero: true }),
    L('porch-glow-twinkle', 'Porch Glow · Twinkle', ['ambient'], 'Warm 2000K with gentle fairy-light dips', 51,
      { pal: 2, col: [[255, 130, 30], [60, 25, 4], [0, 0, 0]], sx: 60, ix: 128, labels: { sx: 'Dip speed', ix: 'How many dip' }, hero: true }),

    // ---------- Thanksgiving & fall ----------
    L('falling-leaves', 'Falling Leaves', ['fall'], 'Leaves drifting along the eaves', 70, { pal: 5, col: [[200, 25, 0], [255, 80, 0], [255, 140, 10]], sx: 30, ix: 128, labels: { sx: 'Drift speed', ix: 'Leaf size' }, hero: true }),
    L('harvest-candlelight', 'Harvest Candlelight', ['fall'], 'Every bulb a flickering amber candle', 102, { pal: 0, col: [[255, 100, 10], [40, 8, 0], [0, 0, 0]], sx: 96, ix: 200, labels: { sx: 'Flicker speed', ix: 'Flicker amount' } }),
    L('cranberry-glow', 'Cranberry Glow', ['fall'], 'Deep cranberry breathing into gold', 2, { pal: 0, col: [[160, 0, 30], [40, 18, 0], [0, 0, 0]], sx: 30, labels: { sx: 'Breath speed' } }),
    L('ember-drift', 'Ember Drift', ['fall'], 'Slow embers rolling along the roof', 71, { pal: 5, col: [[255, 30, 0], [120, 5, 0], [255, 90, 0]], sx: 25, ix: 128, labels: { sx: 'Drift speed', ix: 'Ember size' } }),
    L('slow-maple-chase', 'Slow Maple Chase', ['fall'], 'Soft red-to-amber waves gliding past', 15, { pal: 5, col: [[210, 18, 0], [255, 55, 0], [255, 125, 0]], sx: 28, ix: 60, labels: { sx: 'Chase speed', ix: 'Wave width' } }),
    L('thanksgiving-table', 'Thanksgiving Table', ['fall'], 'Candles and amber twinkles, like a set table', 74, { pal: 5, col: [[255, 110, 15], [255, 70, 0], [200, 35, 0]], sx: 60, ix: 150, labels: { sx: 'Fade speed', ix: 'How many glow' }, hero: true }),
    L('harvest-moon-rise', 'Harvest Moon Rise', ['fall'], 'A big amber swell that rises and settles', 67, { pal: 4, col: [[255, 120, 0], [120, 30, 0], [255, 60, 0]], sx: 25, ix: 90, labels: { sx: 'Rise speed', ix: 'Wave size' } }),
    L('pumpkin-spice', 'Pumpkin Spice', ['fall'], 'Pumpkin orange and cinnamon, slowly blending', 117, { pal: 5, col: [[255, 80, 0], [140, 40, 0], [255, 140, 20]], sx: 20, ix: 80, labels: { sx: 'Blend speed', ix: 'Patch size' } }),
    L('hayride', 'Hayride', ['fall'], 'A lazy warm wave rolling down the street side', 65, { pal: 4, col: [[255, 100, 0], [170, 25, 0], [255, 150, 20]], sx: 22, ix: 128, labels: { sx: 'Roll speed', ix: 'Stretch' } }),
    L('cider-glow', 'Cider Glow', ['fall'], 'Mulled cider: amber fading into apple red', 12, { pal: 0, col: [[255, 120, 10], [150, 15, 0], [0, 0, 0]], sx: 35, labels: { sx: 'Fade speed' } }),

    // ---------- ambient ----------
    L('aurora-veil', 'Aurora Veil', ['ambient'], 'Green and violet curtains drifting', 38, { pal: 50, sx: 24, ix: 150, labels: { sx: 'Curtain drift', ix: 'Curtain width' }, hero: true }),
    L('pacifica', 'Pacifica', ['ambient'], 'Layered ocean swells, never repeats', 101, { pal: 51, sx: 70, ix: 128, labels: { sx: 'Swell speed', ix: 'Angle' }, hero: true }),
    L('sunset-drift', 'Sunset Drift', ['ambient'], 'The whole roof sliding through dusk colors', 65, { pal: 13, sx: 18, ix: 128, labels: { sx: 'Drift speed', ix: 'Stretch' } }),
    L('northern-flow', 'Northern Flow', ['ambient'], 'Wide bands of aurora gliding past', 110, { pal: 5, col: [[0, 220, 120], [0, 140, 255], [120, 40, 255]], sx: 30, ix: 90, labels: { sx: 'Flow speed', ix: 'Bands' } }),
    L('candlelit-eaves', 'Candlelit Eaves', ['ambient', 'fall'], 'Every bulb its own flickering candle', 102, { pal: 0, col: [[255, 128, 28], [40, 8, 0], [0, 0, 0]], sx: 96, ix: 200, labels: { sx: 'Flicker speed', ix: 'Flicker amount' }, hero: true }),
    L('hearth', 'Hearth', ['ambient', 'fall'], 'Flames dancing on every bulb', 102, { pal: 5, col: [[255, 40, 0], [255, 100, 0], [150, 10, 0]], sx: 150, ix: 230, labels: { sx: 'Flicker speed', ix: 'Flame height' }, hero: true }),
    L('deep-sea', 'Deep Sea', ['ambient'], 'Glowing plankton wandering through blue', 147, { pal: 51, sx: 40, ix: 110, c1: 128, labels: { sx: 'Drift speed', ix: 'How many glow', c1: 'Fade' } }),
    L('lake-at-dusk', 'Lake at Dusk', ['ambient'], 'Ripples of light on still water', 75, { pal: 5, col: [[0, 60, 160], [0, 140, 200], [40, 40, 170]], sx: 40, labels: { sx: 'Ripple speed' } }),
    L('starfield', 'Starfield', ['ambient'], 'Cool stars fading in and out', 81, { pal: 2, col: [[150, 170, 255], [0, 0, 6], [0, 0, 0]], sx: 50, ix: 150, labels: TW, hero: true }),
    L('fireflies', 'Fireflies', ['ambient'], 'Little yellow-green sparks rising and fading', 106, { pal: 2, col: [[190, 255, 50], [0, 0, 0], [0, 0, 0]], sx: 40, ix: 70, labels: { sx: 'Glow speed', ix: 'How many' } }),
    L('sherbet-waves', 'Sherbet Waves', ['ambient'], 'Soft pastel waves rolling across', 67, { pal: 27, sx: 45, ix: 110, labels: { sx: 'Wave speed', ix: 'Wave size' } }),
    L('moonlight', 'Moonlight', ['ambient'], 'A cool blue glow that slowly breathes', 2, { pal: 0, col: [[100, 125, 255], [6, 6, 30], [0, 0, 0]], sx: 24, labels: { sx: 'Breath speed' } }),
    L('porch-glow', 'Porch Glow', ['ambient'], 'Plain warm white, 2000K. The classy default', 0, { pal: 0, col: [[255, 130, 30], [0, 0, 0], [0, 0, 0]] }),
    L('lavender-dusk', 'Lavender Dusk', ['ambient'], 'Lavender and rose drifting like evening sky', 117, { pal: 5, col: [[140, 60, 255], [255, 70, 170], [80, 30, 200]], sx: 18, ix: 90, labels: { sx: 'Blend speed', ix: 'Patch size' } }),
    L('rainforest-mist', 'Rainforest Mist', ['ambient'], 'Mossy greens shifting like light through leaves', 70, { pal: 5, col: [[0, 150, 40], [90, 200, 0], [0, 90, 50]], sx: 28, ix: 128, labels: { sx: 'Drift speed', ix: 'Patch size' } }),
    L('tide-pool', 'Tide Pool', ['ambient'], 'Teal and coral shimmering in shallow water', 112, { pal: 5, col: [[0, 180, 170], [255, 90, 70], [0, 90, 160]], sx: 30, ix: 100, labels: { sx: 'Shimmer speed', ix: 'Shadow size' } }),
    L('glacier', 'Glacier', ['ambient'], 'Icy blues slowly cracking and shifting', 71, { pal: 5, col: [[0, 120, 255], [60, 200, 255], [0, 40, 160]], sx: 18, ix: 128, labels: { sx: 'Drift speed', ix: 'Patch size' } }),
    L('ember-breath', 'Ember Breath', ['ambient', 'fall'], 'A low ember glow that breathes in and out', 2, { pal: 0, col: [[255, 50, 0], [30, 4, 0], [0, 0, 0]], sx: 18, labels: { sx: 'Breath speed' } }),
    L('blue-hour', 'Blue Hour', ['ambient'], 'The 20 minutes after sunset, all night long', 67, { pal: 5, col: [[20, 40, 200], [90, 40, 220], [255, 90, 40]], sx: 15, ix: 80, labels: { sx: 'Drift speed', ix: 'Wave size' } }),
    L('plasma-dream', 'Plasma Dream', ['ambient'], 'Pastel plasma breathing in slow motion', 97, { pal: 20, sx: 26, ix: 100, labels: { sx: 'Phase', ix: 'Detail' } }),
    L('lava-lamp', 'Lava Lamp', ['ambient'], 'Slow molten blobs of red and orange', 71, { pal: 5, col: [[255, 30, 0], [255, 0, 80], [255, 110, 0]], sx: 28, ix: 128, labels: { sx: 'Blob speed', ix: 'Blob size' } }),
    L('sakura', 'Sakura', ['ambient'], 'Pink blossoms blooming and falling away', 74, { pal: 49, sx: 60, ix: 140, labels: { sx: 'Fade speed', ix: 'How many bloom' } }),
    L('rivendell', 'Rivendell', ['ambient'], 'Elvish greens and golds fading between each other', 117, { pal: 14, sx: 16, ix: 90, labels: { sx: 'Blend speed', ix: 'Patch size' } }),

    // ---------- team colors ----------
    L('team-color-wave', 'Team Color Wave', ['events'], 'A bright green wave rolling over blue tones along the roofline', 15, { pal: 2, col: [TEAM.green, [0, 50, 200], [0, 0, 0]], sx: 90, ix: 60, labels: { sx: 'Wave speed', ix: 'Wave width' }, hero: true }),
    L('touchdown', 'Bright Burst', ['events'], 'Green and blue fireworks every few seconds', 90, { pal: 5, col: [TEAM.green, TEAM.blue, TEAM.navy], sx: 120, ix: 150, labels: { sx: 'Launch speed', ix: 'Burst size' } }),
    L('game-day-glow', 'Game Day Glow', ['events'], 'Steady navy and green with a gentle shimmer', 51, { pal: 5, col: [TEAM.navy, TEAM.green, TEAM.blue], sx: 50, ix: 90, labels: { sx: 'Shimmer speed', ix: 'How many shimmer' } }),
    L('blue-friday-twinkle', 'Blue Twinkle', ['events'], 'Blue twinkle with a cool shimmer', 80, { pal: 5, col: [TEAM.blue, TEAM.navy, [40, 120, 255]], sx: 60, ix: 150, labels: TW }),
    L('victory-chase', 'Victory Chase', ['events'], 'Fast green comets with blue tails', 76, { o3: true, pal: 5, col: [TEAM.green, TEAM.blue, TEAM.green], sx: 190, ix: 200, labels: { sx: 'Speed', ix: 'Tail length' } }),
    L('sea-of-blue', 'Sea of Blue', ['events'], 'Cool blue and green waves across the roofline', 101, { pal: 5, col: [TEAM.navy, TEAM.blue, TEAM.green], sx: 70, ix: 128, labels: { sx: 'Swell speed', ix: 'Angle' } }),

    // ---------- holidays ----------
    L('trimlight-christmas', 'Classic Four-Color Pattern', ['holiday'], 'A repeating red, green, blue, and amber sequence', 0,
      { pal: 0, col: [[255, 0, 0], [0, 255, 0], [0, 0, 255]], pattern: [[255, 0, 0], [0, 255, 0], [0, 0, 255], [220, 100, 20]], hero: true }),
    L('christmas-twinkle', 'Christmas Twinkle', ['holiday'], 'Classic red and green with warm gold twinkles', 80, { pal: 5, col: [[220, 0, 0], [0, 170, 40], [255, 150, 0]], sx: 60, ix: 160, labels: TW }),
    L('candy-cane-chase', 'Candy Cane Chase', ['holiday'], 'Red and soft pink stripes marching along', 15, { pal: 5, col: [[220, 0, 20], [255, 90, 120], [220, 0, 20]], sx: 60, ix: 180, labels: { sx: 'March speed', ix: 'Stripe width' } }),
    L('halloween-flicker', 'Halloween Flicker', ['holiday'], 'Pumpkin orange and violet, spooky flicker', 102, { pal: 5, col: [[255, 70, 0], [120, 0, 200], [255, 110, 0]], sx: 110, ix: 210, labels: { sx: 'Flicker speed', ix: 'Flicker amount' } }),
    L('hanukkah-shimmer', 'Hanukkah Shimmer', ['holiday'], 'Blue and gold shimmering like candlelight', 51, { pal: 5, col: [[0, 60, 255], [255, 190, 40], [40, 140, 255]], sx: 50, ix: 120, labels: { sx: 'Shimmer speed', ix: 'How many shimmer' } }),
    L('fourth-of-july', 'Fourth of July Bursts', ['holiday'], 'Red and blue fireworks with amber sparks', 90, { pal: 5, col: [[230, 0, 20], [20, 40, 255], [255, 120, 0]], sx: 120, ix: 160, labels: { sx: 'Launch speed', ix: 'Burst size' } }),
    L('valentine-glow', 'Valentine Glow', ['holiday'], 'Rose and red slowly breathing', 115, { pal: 5, col: [[255, 0, 60], [255, 60, 140], [200, 0, 120]], sx: 30, ix: 100, labels: { sx: 'Blend speed', ix: 'Blend size' } }),

    // ---------- party ----------
    L('fireworks', 'Fireworks', ['party'], 'Bursts launching all along the roof', 90, { pal: 6, sx: 128, ix: 160, labels: { sx: 'Launch speed', ix: 'Burst size' } }),
    L('meteor-shower', 'Meteor Shower', ['party'], 'Fire-and-ice comets with long tails', 76, { o3: true, pal: 5, col: [[0, 160, 255], [120, 60, 255], [0, 220, 200]], sx: 170, ix: 200, labels: { sx: 'Speed', ix: 'Tail length' } }),
    L('juggle', 'Juggle', ['party'], 'Eight dots weaving through each other', 64, { pal: 6, sx: 140, ix: 140, labels: { sx: 'Speed', ix: 'Trail' } }),
    L('popcorn', 'Popcorn', ['party'], 'Kernels popping up and falling back', 95, { pal: 56, sx: 150, ix: 128, labels: { sx: 'Pop speed', ix: 'How many' } }),
    L('thunderstorm', 'Thunderstorm', ['party'], 'Violet lightning across a dark sky', 57, { pal: 0, col: [[150, 120, 255], [4, 6, 30], [0, 0, 0]], sx: 200, ix: 180, labels: { sx: 'Flash speed', ix: 'How often' } }),
    L('rainbow-runner', 'Rainbow Runner', ['party'], 'A rainbow sprinting around the house', 33, { pal: 11, sx: 160, ix: 128, labels: { sx: 'Speed', ix: 'Size' } }),

    // ---------- mic-reactive ----------
    L('gravity-meter', 'Gravity Meter', ['mic'], 'Bars jump from the center with every beat', 156, { pal: 6, sx: 128, ix: 160, labels: { sx: 'Fall rate', ix: 'Sensitivity' } }),
    L('dj-light', 'DJ Light', ['mic'], 'Whole roof shifts color with the music', 159, { pal: 0, sx: 128 }),
    L('noise-fire', 'Noise Fire', ['mic'], 'Fire that flares up when it gets loud', 143, { pal: 35, sx: 128, ix: 128 }),
    L('waterfall', 'Waterfall', ['mic'], 'The song’s spectrum pouring down the roof', 140, { pal: 0, sx: 128, ix: 128 }),

    // ---------- 🌀 wild ----------
    L('digital-rain', 'Digital Rain', ['wild'], 'Green code dripping down the gables and eaves', 43, { pal: 0, col: [[0, 255, 40], [0, 6, 0], [0, 0, 0]], sx: 120, ix: 110, labels: { sx: 'Fall speed', ix: 'How many drops' }, hero: true }),
    L('rainier-storm', 'Rainier Storm', ['wild'], 'Rolling dark clouds with lightning cracking across', 57, { pal: 0, col: [[170, 150, 255], [10, 12, 45], [0, 0, 0]], sx: 230, ix: 220, labels: { sx: 'Flash speed', ix: 'How often' }, hero: true }),
    L('lava-flow', 'Lava Flow', ['wild'], 'Molten orange pouring along the roofline', 110, { pal: 5, col: [[255, 40, 0], [255, 110, 0], [160, 10, 0]], sx: 60, ix: 60, labels: { sx: 'Flow speed', ix: 'Bands' }, hero: true }),
    L('warp-speed', 'Warp Speed', ['wild'], 'Stars streaking past like jumping to lightspeed', 76, { o3: true, pal: 5, col: [[120, 170, 255], [60, 80, 255], [170, 110, 255]], sx: 250, ix: 230, labels: { sx: 'Speed', ix: 'Streak length' }, hero: true }),
    L('bioluminescence', 'Bioluminescence', ['wild'], 'Dark blue house with glowing plankton ripples', 79, { pal: 51, col: [[0, 220, 200], [0, 4, 24], [0, 0, 0]], sx: 60, ix: 110, labels: { sx: 'Ripple speed', ix: 'How many' }, hero: true }),
    L('heartbeat', 'Heartbeat', ['wild'], 'A slow red double-pulse through the whole house', 100, { pal: 0, col: [[220, 0, 20], [10, 0, 2], [0, 0, 0]], sx: 60, ix: 128, labels: { sx: 'Beats per minute', ix: 'Fade' }, hero: true }),

    // ---------- WLED 1D effect catalog ----------
    // Chases & wipes
    L('candy-wipe', 'Candy Wipe', ['chase', 'xmas'], 'Red, green and gold wiping across the roof in turn', 55, { pal: 0, col: XMAS, sx: 60 }),
    L('amber-wipe', 'Amber Wipe', ['chase', 'fall'], 'Amber fills the roofline, then deep red follows', 3, { pal: 0, col: [[255, 110, 0], [150, 15, 0], [0, 0, 0]], sx: 70, ix: 128 }),
    L('harvest-sweep', 'Harvest Sweep', ['chase', 'fall'], 'Orange sweeps out and back like a tide', 6, { pal: 0, col: [[255, 80, 0], [90, 10, 0], [0, 0, 0]], sx: 60, ix: 128 }),
    L('confetti-wipe', 'Confetti Wipe', ['chase', 'party'], 'A new bright color wipes over the last one', 4, { pal: 0, sx: 90 }),
    L('confetti-sweep', 'Confetti Sweep', ['chase', 'party'], 'Random colors sweeping back and forth', 36, { pal: 0, sx: 90 }),
    L('theater-marquee', 'Theater Marquee', ['chase', 'holiday'], 'Gold bulbs marching in threes, like an old cinema sign', 13, { pal: 0, col: [[255, 150, 20], [40, 8, 0], [0, 0, 0]], sx: 70, ix: 40 }),
    L('rainbow-marquee', 'Rainbow Marquee', ['chase', 'party'], 'Theater chase in rolling rainbow', 14, { pal: 0, sx: 80, ix: 40 }),
    L('ember-chase', 'Ember Chase', ['chase', 'fall'], 'Glowing embers chasing along a dark red line', 28, { pal: 3, col: [[255, 90, 0], [80, 6, 0], [0, 0, 0]], sx: 70, ix: 60 }),
    L('confetti-chase', 'Confetti Chase', ['chase', 'party'], 'A chase that picks a new color each lap', 29, { pal: 0, col: [[255, 80, 0], [0, 0, 0], [0, 0, 0]], sx: 90, ix: 60 }),
    L('rainbow-chase', 'Rainbow Chase', ['chase', 'party'], 'Dark gaps racing through a rainbow', 30, { pal: 0, col: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], sx: 90, ix: 60 }),
    L('team-chase', 'Team Chase', ['chase', 'events'], 'Action green chasing over navy', 37, { pal: 0, col: [[100, 255, 0], [0, 30, 120], [0, 0, 0]], sx: 110, ix: 80 }),
    L('tri-color-chase', 'Tri-Color Chase', ['chase', 'xmas'], 'Red, green and gold blocks marching around the house', 54, { pal: 0, col: XMAS, sx: 50, ix: 70 }),
    L('team-tri-chase', 'Team Tri-Chase', ['chase', 'events'], 'Navy, green and blue blocks on the move', 54, { pal: 0, col: [[0, 30, 120], [100, 255, 0], [0, 90, 255]], sx: 70, ix: 70 }),
    L('running-dual', 'Twin Rivers', ['chase', 'ambient'], 'Two colors flowing past each other in opposite directions', 52, { pal: 0, col: [[0, 90, 255], [0, 0, 0], [0, 200, 140]], sx: 50, ix: 60 }),
    L('autumn-stream', 'Autumn Stream', ['chase', 'fall'], 'Bands of fall color streaming along', 39, { pal: 39, sx: 40, ix: 128 }),
    L('rainbow-stream', 'Rainbow Stream', ['chase', 'party'], 'Random color zones gliding along the eaves', 61, { pal: 0, sx: 50 }),
    L('loading-bar', 'Loading…', ['chase', 'wild'], 'A glowing bar that keeps loading, forever', 47, { pal: 2, col: [[0, 200, 120], [0, 0, 0], [0, 0, 0]], sx: 70, ix: 16 }),
    L('tetrix', 'Stacking Blocks', ['chase', 'wild'], 'Blocks drop and stack up, like a falling-block game', 44, { pal: 11, sx: 0, ix: 0 }),
    L('railway', 'Railway Crossing', ['chase', 'wild'], 'Alternating red crossing lights', 78, { pal: 3, col: [[255, 20, 0], [120, 0, 0], [0, 0, 0]], sx: 120, ix: 100 }),
    L('chunchun', 'Birds on a Wire', ['chase', 'ambient'], 'Little groups of lights hopping along like birds', 111, { pal: 39, sx: 60, ix: 100 }),
    // Scanners & comets
    L('cylon-amber', 'Amber Scanner', ['chase', 'wild'], 'One amber eye sweeping the roofline', 40, { pal: 2, col: [[255, 90, 0], [0, 0, 0], [0, 0, 0]], sx: 90, ix: 180 }),
    L('scanner-dual', 'Twin Scanners', ['chase', 'wild'], 'Two scanners passing each other', 60, { pal: 2, col: [[255, 40, 0], [0, 0, 0], [0, 0, 0]], sx: 90, ix: 180 }),
    L('scan-dots', 'Lanterns', ['chase', 'ambient'], 'A few warm dots gliding the length of the house', 10, { pal: 0, col: [[255, 120, 20], [10, 2, 0], [0, 0, 0]], sx: 40, ix: 40 }),
    L('scan-dual', 'Meet in the Middle', ['chase', 'ambient'], 'Dots that glide in from both ends', 11, { pal: 0, col: [[255, 90, 0], [10, 2, 0], [0, 0, 0]], sx: 40, ix: 40 }),
    L('lighthouse', 'Lighthouse Beam', ['chase', 'ambient'], 'An amber beam sweeping the eaves, fading behind', 41, { pal: 2, col: [[255, 140, 30], [6, 2, 0], [0, 0, 0]], sx: 70, ix: 100 }),
    L('multi-comet', 'Comet Shower', ['chase', 'wild'], 'Comets shooting along the roof with long tails', 59, { pal: 0, col: [[255, 100, 0], [0, 0, 0], [0, 0, 0]], sx: 120, ix: 128 }),
    L('two-dots', 'Two Dots', ['chase', 'events'], 'A green dot and a blue dot chasing each other', 50, { pal: 0, col: [[100, 255, 0], [0, 90, 255], [0, 4, 20]], sx: 80, ix: 60 }),
    L('sinelon-dual', 'Pendulums', ['chase', 'ambient'], 'Two lights swinging back and forth, leaving trails', 93, { pal: 5, col: [[255, 80, 0], [180, 20, 0], [255, 150, 0]], sx: 40, ix: 128 }),
    L('android', 'Stretch', ['chase', 'wild'], 'A band that grows and shrinks as it crawls', 27, { pal: 0, col: [[255, 120, 0], [30, 4, 0], [0, 0, 0]], sx: 90, ix: 80 }),
    L('icu', 'Watching You', ['wild'], 'Two "eyes" that blink and dart around the house', 58, { pal: 0, col: [[255, 0, 0], [0, 0, 0], [0, 0, 0]], sx: 128, ix: 128 }),
    L('rolling-balls', 'Rolling Balls', ['wild', 'party'], 'Colored balls rolling and bouncing off each other', 48, { pal: 11, sx: 128, ix: 80, o1: true }),
    L('oscillate', 'Oscillate', ['wild'], 'Overlapping red, green and blue bands that swing', 62, { pal: 0, col: XMAS, sx: 128 }),
    // Glow, fades & ambient
    L('fire-flicker', 'Fire Flicker', ['fall', 'ambient'], 'Every bulb a coal, flickering on its own', 45, { pal: 2, col: [[255, 70, 0], [0, 0, 0], [0, 0, 0]], sx: 128, ix: 128 }),
    L('tri-fade', 'Tri Fade', ['fall'], 'The whole house slowly fades through red, orange and gold', 56, { pal: 0, col: AUTUMN, sx: 40 }),
    L('team-fade', 'Team Fade', ['events'], 'Slow fade through navy, green and blue', 56, { pal: 0, col: [[0, 30, 120], [100, 255, 0], [0, 90, 255]], sx: 40 }),
    L('colorloop', 'Color Loop', ['party'], 'The whole roof drifts through every color', 8, { pal: 0, sx: 30, ix: 255 }),
    L('rainbow', 'Rainbow', ['party'], 'A full rainbow rolling around the house', 9, { pal: 0, sx: 60, ix: 128 }),
    L('random-colors', 'Mood Shift', ['ambient', 'party'], 'The whole house picks a new color every so often', 5, { pal: 0, sx: 30, ix: 128 }),
    L('dynamic', 'Patchwork', ['party'], 'Every bulb a different color, reshuffled now and then', 7, { pal: 0, sx: 40, ix: 128, o1: true }),
    L('fairy', 'Fairy Lights', ['ambient', 'xmas'], 'Classic fairy lights with a few bulbs flashing', 49, { pal: 0, col: [[255, 140, 30], [0, 0, 0], [0, 0, 0]], sx: 128, ix: 128 }),
    L('fairy-multi', 'Fairy Lights · Multicolor', ['xmas'], 'Old-fashioned multicolor fairy lights, a few flashing', 49, { pal: 5, col: XMAS, sx: 128, ix: 128 }),
    L('spots', 'Spotlights', ['ambient'], 'Evenly spaced pools of warm light', 85, { pal: 2, col: [[255, 120, 20], [0, 0, 0], [0, 0, 0]], sx: 128, ix: 40 }),
    L('spots-fade', 'Breathing Spotlights', ['ambient'], 'Pools of light that drift closer and further apart', 86, { pal: 2, col: [[255, 100, 0], [0, 0, 0], [0, 0, 0]], sx: 100, ix: 40 }),
    L('fill-noise', 'Smoulder', ['fall', 'ambient'], 'Slow-moving clouds of ember color', 69, { pal: 35, sx: 40 }),
    L('noise-4', 'Northern Glow', ['ambient'], 'Soft drifting color, like aurora on the eaves', 73, { pal: 50, sx: 30 }),
    L('phased', 'Phased', ['ambient'], 'Interference waves rolling through amber', 105, { pal: 2, col: [[255, 90, 0], [0, 0, 0], [0, 0, 0]], sx: 60, ix: 128 }),
    L('phased-noise', 'Phased Noise', ['ambient'], 'Waves with a little shimmer in them', 109, { pal: 2, col: [[255, 90, 0], [0, 0, 0], [0, 0, 0]], sx: 60, ix: 128 }),
    L('sine', 'Sine Swell', ['ambient'], 'Long smooth swells of ocean color', 108, { pal: 9, sx: 40, ix: 128 }),
    L('wavesins', 'Wavesins', ['ambient'], 'Layered waves washing through blue and teal', 184, { pal: 9, sx: 60, ix: 128 }),
    L('flow-stripe', 'Flow Stripe', ['party'], 'Bold color shifting slowly over the whole house', 179, { pal: 0, sx: 60, ix: 128 }),
    L('saw', 'Sawtooth', ['party'], 'Sharp-edged color teeth sliding along', 16, { pal: 5, col: [[255, 60, 0], [140, 0, 160], [0, 0, 0]], sx: 60, ix: 128 }),
    L('washing-machine', 'Washing Machine', ['wild'], 'Color sloshing back and forth', 113, { pal: 9, sx: 80, ix: 128 }),
    L('tv-sim', 'Cozy TV Glow', ['wild', 'ambient'], 'Flickers like someone is watching the game inside', 116, { pal: 0, sx: 128, ix: 128 }),
    L('percent', 'Halfway There', ['wild'], 'Fills the roof to a set percentage', 98, { pal: 2, col: [[0, 200, 120], [0, 20, 10], [0, 0, 0]], sx: 128, ix: 128 }),
    L('traffic-light', 'Traffic Light', ['wild'], 'Red, amber and green, taking turns', 35, { pal: 0, sx: 120 }),
    // Sparkle & glitter
    L('dissolve', 'Dissolve', ['ambient', 'fall'], 'Bulbs switch to amber one by one, then back', 18, { pal: 0, col: [[255, 100, 0], [60, 4, 0], [0, 0, 0]], sx: 128, ix: 128 }),
    L('dissolve-random', 'Confetti Dissolve', ['party'], 'Random colors dissolving in and out', 19, { pal: 0, col: [[0, 0, 0], [10, 2, 0], [0, 0, 0]], sx: 128, ix: 128 }),
    L('sparkle-dark', 'Dark Sparkle', ['ambient'], 'An amber roof with little dark winks running through it', 21, { pal: 0, col: [[255, 110, 0], [0, 0, 0], [0, 0, 0]], sx: 128, ix: 128 }),
    L('solid-glitter', 'Gold Glitter', ['xmas', 'ambient'], 'Deep red with gold glitter popping on', 103, { pal: 0, col: [[150, 0, 0], [0, 0, 0], [255, 170, 30]], sx: 128, ix: 80 }),
    // Strobe & flash (fast flashing)
    L('blink', 'Slow Blink', ['strobe'], 'The whole house blinking amber, slow and steady', 1, { pal: 0, col: [[255, 100, 0], [0, 0, 0], [0, 0, 0]], sx: 40, ix: 128, flash: true }),
    L('blink-rainbow', 'Rainbow Blink', ['strobe'], 'Blinks through every color', 26, { pal: 0, col: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], sx: 60, ix: 128, flash: true }),
    L('strobe', 'Strobe', ['strobe'], 'Fast amber strobe (party only)', 23, { pal: 0, col: [[255, 100, 0], [0, 0, 0], [0, 0, 0]], sx: 128, flash: true }),
    L('strobe-rainbow', 'Rainbow Strobe', ['strobe'], 'Fast strobe through the rainbow (party only)', 24, { pal: 0, col: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], sx: 128, flash: true }),
    L('halloween-strobe', 'Halloween Strobe', ['strobe', 'holiday'], 'Purple and orange strobing bursts (party only)', 25, { pal: 0, col: [[255, 70, 0], [90, 0, 160], [0, 0, 0]], sx: 128, ix: 128, flash: true }),
    L('chase-flash', 'Flash Chase', ['strobe', 'chase'], 'A flashing chase over amber', 31, { pal: 0, col: [[255, 90, 0], [0, 0, 0], [0, 0, 0]], sx: 128, flash: true }),
    L('chase-flash-rnd', 'Confetti Flash Chase', ['strobe', 'party'], 'Flashing chase that leaves new colors behind', 32, { pal: 0, sx: 128, flash: true }),
    // Mic-reactive (needs music near the controller)
    L('pixels', 'Beat Pixels', ['mic'], 'Random pixels light up with the music', 128, { pal: 11, sx: 128, ix: 128 }),
    L('pixelwave', 'Pixel Wave', ['mic'], 'Waves of light pushed out from the middle on every beat', 129, { pal: 11, sx: 128, ix: 64 }),
    L('juggles', 'Juggles', ['mic'], 'Juggling dots that dance to the volume', 130, { pal: 11, sx: 128, ix: 128 }),
    L('matripix', 'Matripix', ['mic'], 'Music scrolls along the roof like a ticker', 131, { pal: 11, sx: 128, ix: 64 }),
    L('gravimeter', 'Gravimeter', ['mic'], 'A volume meter with a falling peak dot', 132, { pal: 11, sx: 128, ix: 128 }),
    L('gravcentric', 'Gravcentric', ['mic'], 'Volume meter growing out from the middle', 157, { pal: 11, sx: 128, ix: 128 }),
    L('gravfreq', 'Gravfreq', ['mic'], 'Volume meter colored by the pitch', 158, { pal: 11, sx: 128, ix: 128 }),
    L('plasmoid', 'Plasmoid', ['mic'], 'Plasma waves that brighten with the music', 133, { pal: 11, sx: 128, ix: 128 }),
    L('puddles', 'Puddles', ['mic'], 'Splashes of color on every beat', 134, { pal: 11, sx: 128, ix: 128 }),
    L('puddlepeak', 'Puddle Peak', ['mic'], 'Bigger splashes only on the loud beats', 144, { pal: 11, sx: 128, ix: 128 }),
    L('midnoise', 'Midnoise', ['mic'], 'A noise band from the middle that grows with volume', 135, { pal: 11, sx: 128, ix: 128 }),
    L('noisemeter', 'Noisemeter', ['mic'], 'A shimmering volume bar', 136, { pal: 11, sx: 128, ix: 128 }),
    L('noisemove', 'Noisemove', ['mic'], 'Dots drifting to the beat', 145, { pal: 11, sx: 128, ix: 128 }),
    L('freqmatrix', 'Freqmatrix', ['mic'], 'Pitch turned into scrolling color', 138, { pal: 0, sx: 128, ix: 128 }),
    L('freqpixels', 'Freqpixels', ['mic'], 'Pixels colored by the pitch they hear', 141, { pal: 0, sx: 128, ix: 128 }),
    L('freqmap', 'Freqmap', ['mic'], 'Where the light lands depends on the pitch', 155, { pal: 0, sx: 128, ix: 128 }),
    L('ripple-peak', 'Ripple Peak', ['mic'], 'Ripples that start on the loud beats', 148, { pal: 11, sx: 128, ix: 128 }),
    L('blurz', 'Blurz', ['mic'], 'Soft blurred color from the music', 163, { pal: 11, sx: 128, ix: 128 }),
    L('rocktaves', 'Rocktaves', ['mic'], 'Color follows the note being played', 185, { pal: 0, sx: 128, ix: 128 }),
    // effects that were in the engine but had no look yet
    L('classic-twinkle', 'Classic Twinkle', ['xmas', 'ambient'], 'Bulbs twinkling on at random over a dim amber base', 17, { pal: 0, col: [[255, 140, 20], [20, 4, 0], [0, 0, 0]], sx: 100, ix: 100 }),
    L('sparkle', 'Sparkle', ['ambient'], 'A single amber sparkle racing around a dark roof', 20, { pal: 0, col: [[255, 120, 0], [0, 0, 0], [0, 0, 0]], sx: 128, ix: 128 }),
    L('sparkle-plus', 'Sparkle Storm', ['party'], 'Lots of gold sparkles over deep red', 22, { pal: 0, col: [[255, 160, 30], [80, 0, 0], [0, 0, 0]], sx: 150, ix: 150 }),
    L('colorful', 'Colorful', ['xmas'], 'Classic C9 colors shifting along', 34, { pal: 0, col: XMAS, sx: 60, ix: 128 }),
    L('firework-pops', 'Firework Pops', ['party', 'holiday'], 'Bursts of color popping all over the roof', 42, { pal: 11, sx: 128, ix: 192 }),
    L('ember-gradient', 'Ember Gradient', ['fall'], 'A soft gradient band of amber sliding along', 46, { pal: 0, col: [[255, 90, 0], [60, 4, 0], [0, 0, 0]], sx: 60, ix: 60 }),
    L('pride', 'Pride Waves', ['party'], 'Rich rolling rainbow waves', 63, { pal: 0, sx: 60 }),
    L('roof-fire', 'Roof on Fire', ['fall', 'wild'], 'Real fire simulation, flames climbing from the garage end', 66, { pal: 35, sx: 64, ix: 160 }),
    L('bpm', 'BPM', ['party'], 'Pulsing color bands on a steady beat', 68, { pal: 11, sx: 64 }),
    L('noise-3', 'Lava Drift', ['fall'], 'Slow molten noise in reds and ambers', 72, { pal: 8, sx: 40 }),
    L('meteor-smooth', 'Smooth Meteor', ['wild'], 'A single meteor with a long smooth tail', 77, { pal: 5, col: [[255, 120, 0], [255, 60, 0], [120, 0, 0]], sx: 100, ix: 128 }),
    L('solid-pattern', 'Two-Tone Pattern', ['xmas'], 'Fixed blocks of red and green', 83, { pal: 0, col: [[220, 0, 0], [0, 140, 20], [0, 0, 0]], sx: 2, ix: 2 }),
    L('tri-pattern', 'Three-Tone Pattern', ['events'], 'Fixed navy, green and blue blocks', 84, { pal: 0, col: [[0, 30, 120], [100, 255, 0], [0, 90, 255]], ix: 64 }),
    L('glitter', 'Glitter', ['party'], 'Rolling rainbow with glitter on top', 87, { pal: 11, sx: 60, ix: 100 }),
    L('candle', 'Candle', ['ambient', 'fall'], 'The whole house flickering together like one big candle', 88, { pal: 0, col: [[255, 90, 0], [0, 0, 0], [0, 0, 0]], sx: 96, ix: 224 }),
    L('starburst', 'Starburst', ['party', 'holiday'], 'Fireworks that burst into sparks', 89, { pal: 11, sx: 128, ix: 128 }),
    L('bouncing-balls', 'Bouncing Balls', ['wild'], 'Balls bouncing up from the garage end', 91, { pal: 5, col: [[255, 80, 0], [0, 200, 120], [120, 0, 200]], sx: 128, ix: 80 }),
    L('sinelon', 'Pendulum', ['ambient'], 'One amber light swinging along the roof with a trail', 92, { pal: 2, col: [[255, 100, 0], [0, 0, 0], [0, 0, 0]], sx: 40, ix: 128 }),
    L('sinelon-rainbow', 'Rainbow Pendulum', ['party'], 'A swinging light that changes color', 94, { pal: 0, sx: 50, ix: 128 }),
    L('drip', 'Icicle Drip', ['xmas', 'ambient'], 'Drops forming and falling along the eaves', 96, { pal: 0, col: [[0, 120, 255], [0, 4, 20], [0, 0, 0]], sx: 128, ix: 64 }),
    L('ripple-rainbow', 'Rainbow Ripples', ['party'], 'Ripples of color spreading across a dim background', 99, { pal: 0, sx: 128, ix: 128 }),
    L('sunrise', 'Sunrise', ['ambient'], 'A slow sunrise over the roof (set the minutes with speed)', 104, { pal: 0, sx: 60, ix: 128 }),
    L('noise-pal', 'Painted Noise', ['ambient'], 'Ever-changing painted noise', 107, { pal: 0, sx: 40, ix: 128 }),
    L('freqwave', 'Freqwave', ['mic'], 'A wave whose color follows the pitch', 137, { pal: 0, sx: 128, ix: 128 }),
  ];

  const THEMES = [
    ['Fall & Thanksgiving', [
      ['Autumn Twinkle', AUTUMN], ['Harvest Moon', [[255, 90, 0], [200, 40, 0], [255, 160, 20]]], ['Cranberry & Gold', [[160, 0, 30], [255, 140, 0], [220, 30, 10]]],
      ['Pumpkin Patch', [[255, 70, 0], [255, 120, 0], [120, 40, 0]]], ['Maple Leaf', [[200, 20, 0], [255, 80, 0], [255, 170, 0]]], ['Ember', [[140, 10, 0], [255, 40, 0], [255, 90, 0]]],
      ['Thanksgiving Table', [[255, 110, 15], [180, 30, 0], [255, 160, 40]]], ['Indian Summer', [[255, 150, 30], [255, 80, 20], [200, 110, 0]]], ['Cider', [[255, 120, 10], [150, 15, 0], [255, 70, 0]]]]],
    ['Holidays', [
      ['Halloween', [[255, 70, 0], [120, 0, 200], [60, 255, 0]]], ['Halloween · Witching Hour', [[110, 0, 200], [255, 50, 0], [20, 120, 30]]],
      ['Classic Christmas', [[220, 0, 0], [0, 170, 40], [255, 150, 0]]], ['Candy Cane (no white)', [[220, 0, 20], [255, 90, 120], [255, 0, 60]]],
      ['Hanukkah', [[0, 60, 255], [40, 140, 255], [255, 190, 40]]], ['New Year’s', [[255, 170, 0], [180, 0, 255], [0, 120, 255]]],
      ['Valentine', [[255, 0, 60], [255, 60, 140], [200, 0, 120]]], ['St. Patrick’s', [[0, 200, 40], [120, 255, 0], [255, 170, 0]]],
      ['Easter', [[255, 110, 180], [120, 255, 120], [160, 120, 255]]], ['Fourth of July', [[230, 0, 20], [20, 40, 255], [255, 120, 0]]],
      ['Diwali', [[255, 140, 0], [255, 0, 120], [255, 210, 0]]], ['Lunar New Year', [[230, 0, 0], [255, 170, 0], [255, 60, 0]]], ['Mardi Gras', [[140, 0, 220], [0, 200, 60], [255, 190, 0]]]]],
    ['Team Colors', [
      ['Navy & Green', [TEAM.navy, TEAM.green, TEAM.blue]], ['Blue & Gold', [[0, 70, 255], [255, 170, 0], [0, 140, 255]]],
      ['Red & Black', [[220, 0, 20], [25, 25, 30], [255, 80, 40]]], ['Purple & Gold', [[110, 0, 200], [255, 170, 0], [170, 90, 255]]]]],
    ['Nature', [
      ['Sunset', [[255, 60, 0], [255, 0, 90], [255, 150, 0]]], ['Ocean', [[0, 80, 255], [0, 200, 220], [0, 40, 140]]], ['Aurora', [[0, 255, 120], [120, 0, 255], [0, 180, 255]]],
      ['Forest', [[0, 140, 30], [120, 200, 0], [0, 90, 60]]], ['Lavender Dusk', [[140, 60, 255], [255, 80, 200], [80, 40, 200]]], ['Desert', [[255, 110, 30], [200, 60, 20], [255, 170, 60]]],
      ['Glacier', [[0, 120, 255], [60, 200, 255], [0, 40, 160]]]]],
    ['Moods', [
      ['Cozy', [[255, 110, 20], [255, 60, 0], [255, 150, 40]]], ['Romance', [[255, 0, 80], [180, 0, 140], [255, 60, 40]]], ['Chill', [[0, 140, 255], [100, 60, 255], [0, 220, 200]]],
      ['Party', [[255, 0, 160], [0, 255, 200], [255, 200, 0]]], ['Neon', [[255, 0, 255], [0, 255, 120], [0, 160, 255]]], ['Spooky Calm', [[90, 0, 180], [255, 60, 0], [20, 120, 40]]],
      ['Matrix', [[0, 255, 40], [0, 120, 20], [120, 255, 120]]]]],
  ];

  const CATS = [
    ['mine', 'Saved looks', '★'], ['house', 'Current WLED output', '●'], ['fall', 'Thanksgiving & Fall', '❦'], ['ambient', 'Ambient', '◐'],
    ['events', 'Team & event colors', '✦'], ['holiday', 'Holidays', '✷'], ['party', 'Party', '✦'], ['mic', 'Mic-reactive', '♪'], ['chase', 'Chases & Wipes', '➠'], ['xmas', 'Classic Christmas', '🎄'], ['wild', 'Wild', '🌀'], ['strobe', 'Strobe & Flash', '⚡'], ['all', 'All looks', '▦'],
  ];
  g.TLCatalog = { LOOKS, THEMES, CATS };
})(window);
