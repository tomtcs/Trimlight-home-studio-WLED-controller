/*!
 * tlfx.js — faithful JavaScript port of WLED 1D effects (FX.cpp / FX_fcn.cpp / colors.cpp / wled_math.cpp / util.cpp)
 * plus the FastLED 3.6.0 helpers they use (lib8tion, noise.cpp, hsv2rgb_rainbow, colorutils palettes).
 *
 * Built for Trimlight Studio to preview WLED effects in the browser.
 * gamma 2.8 on colors, palette blend mode 0, harmonic random palette every ~6 s) renders.
 *
 * API: see ENGINE_CONTRACT.md — window.TLFX.{create, supported, names, paletteCss, approx, meta, palNames, config}
 * No dependencies, no modules. Each instance keeps its own PRNG + segment runtime (call/step/aux0/aux1/data).
 *
 * Timing model: WLED's service loop is simulated. Each instance advances a simulated clock in ticks of
 * 1000/config.simFps ms (with a browser-side simulation rate), runs the effect
 * whenever now >= next_time (effects return FRAMETIME=2 in unlimited mode, FRAMETIME_FIXED=23 for a few), and the
 * returned frame is the time-average of all ticks since the previous render (what the eye integrates on the real roof).
 * Effects whose output is a pure function of strip.now are only evaluated once per render (flag tb).
 */
(function (root) {
'use strict';

// ---- WLED effect and palette metadata ----
const PAL_RAW = [[0,85,0,171,16,132,0,124,32,181,0,75,48,229,0,27,64,232,23,0,80,184,71,0,96,171,119,0,112,171,171,0,128,171,85,0,144,221,34,0,160,242,0,14,176,194,0,62,192,143,0,113,208,95,0,161,224,47,0,208,240,0,7,249],null,null,null,null,null,[0,85,0,171,16,132,0,124,32,181,0,75,48,229,0,27,64,232,23,0,80,184,71,0,96,171,119,0,112,171,171,0,128,171,85,0,144,221,34,0,160,242,0,14,176,194,0,62,192,143,0,113,208,95,0,161,224,47,0,208,240,0,7,249],[0,0,0,255,16,0,0,139,32,0,0,139,48,0,0,139,64,0,0,139,80,0,0,139,96,0,0,139,112,0,0,139,128,0,0,255,144,0,0,139,160,135,206,235,176,135,206,235,192,173,216,230,208,255,255,255,224,173,216,230,240,135,206,235],[0,0,0,0,16,128,0,0,32,0,0,0,48,128,0,0,64,139,0,0,80,139,0,0,96,128,0,0,112,139,0,0,128,139,0,0,144,139,0,0,160,255,0,0,176,255,165,0,192,255,255,255,208,255,165,0,224,255,0,0,240,139,0,0],[0,25,25,112,16,0,0,139,32,25,25,112,48,0,0,128,64,0,0,139,80,0,0,205,96,46,139,87,112,0,128,128,128,95,158,160,144,0,0,255,160,0,139,139,176,100,149,237,192,127,255,212,208,46,139,87,224,0,255,255,240,135,206,250],[0,0,100,0,16,0,100,0,32,85,107,47,48,0,100,0,64,0,128,0,80,34,139,34,96,107,142,35,112,0,128,0,128,46,139,87,144,102,205,170,160,50,205,50,176,154,205,50,192,144,238,144,208,124,252,0,224,102,205,170,240,34,139,34],[0,255,0,0,16,213,42,0,32,171,85,0,48,171,127,0,64,171,171,0,80,86,213,0,96,0,255,0,112,0,213,42,128,0,171,85,144,0,86,170,160,0,0,255,176,42,0,213,192,85,0,171,208,127,0,129,224,171,0,85,240,213,0,43],[0,255,0,0,16,0,0,0,32,171,85,0,48,0,0,0,64,171,171,0,80,0,0,0,96,0,255,0,112,0,0,0,128,0,171,85,144,0,0,0,160,0,0,255,176,0,0,0,192,85,0,171,208,0,0,0,224,171,0,85,240,0,0,0],[0,120,0,0,22,179,22,0,51,255,104,0,85,167,22,18,135,100,0,103,198,16,0,130,255,0,0,160],[0,1,14,5,101,16,36,14,165,56,68,30,242,150,156,99,255,150,156,99],[0,1,6,7,89,1,99,111,153,144,209,255,255,0,73,82],[0,4,1,70,31,55,1,30,63,255,4,7,95,59,2,29,127,11,3,50,159,39,8,60,191,112,19,40,223,78,11,39,255,29,8,59],[0,188,135,1,255,46,7,1],[0,3,0,255,63,23,0,255,127,67,0,255,191,142,0,45,255,255,0,0],[0,126,11,255,127,197,1,22,175,210,157,172,221,157,3,112,255,157,3,112],[0,10,62,123,36,56,130,103,87,153,225,85,100,199,217,68,107,255,207,54,115,247,152,57,120,239,107,61,128,247,152,57,180,255,207,54,223,255,227,48,255,255,248,42],[0,110,49,11,29,55,34,10,68,22,22,9,68,239,124,8,97,220,156,27,124,203,193,61,178,33,53,56,255,0,1,52],[0,255,252,214,12,255,252,214,22,255,252,214,26,190,191,115,28,137,141,52,28,112,255,205,50,51,246,214,71,17,235,226,93,2,193,199,120,0,156,174,133,1,101,115,136,1,59,71,136,7,131,170,208,1,90,151,255,0,56,133],[0,4,1,1,51,16,0,1,76,97,104,3,101,255,131,19,127,67,9,4,153,16,0,1,229,4,1,1,255,4,1,1],[0,8,3,0,42,23,7,0,63,75,38,6,84,169,99,38,106,213,169,119,116,255,255,255,138,135,255,138,148,22,255,24,170,0,255,0,191,0,136,0,212,0,55,0,255,0,55,0],[0,0,0,0,37,2,25,1,76,15,115,5,127,79,213,1,128,126,211,47,130,188,209,247,153,144,182,205,204,59,117,250,255,1,37,192],[0,1,5,0,19,32,23,1,38,161,55,1,63,229,144,1,66,39,142,74,255,1,4,1],[0,255,33,4,43,255,68,25,86,255,7,25,127,255,82,103,170,255,255,242,209,42,255,22,255,87,255,65],[0,247,176,247,48,255,136,255,89,220,29,226,160,7,82,178,216,1,124,109,255,1,124,109],[0,1,124,109,66,1,93,79,104,52,65,1,130,115,127,1,150,52,65,1,201,1,86,72,239,0,55,45,255,0,55,45],[0,47,30,2,42,213,147,24,84,103,219,52,127,3,219,207,170,1,48,214,212,1,1,111,255,1,7,33],[0,194,1,1,94,1,29,18,132,57,131,28,255,113,1,1],[0,2,1,1,53,18,1,0,104,69,29,1,153,167,135,10,255,46,56,4],[0,113,91,147,72,157,88,78,89,208,85,33,107,255,29,11,141,137,31,39,255,59,33,89],[0,0,1,255,63,3,68,45,127,23,255,0,191,100,68,1,255,255,1,4],[0,0,0,0,46,18,0,0,96,113,0,0,108,142,3,1,119,175,17,1,146,213,44,2,174,255,82,4,188,255,115,4,202,255,156,4,218,255,203,4,234,255,255,4,244,255,255,71,255,255,255,255],[0,0,0,0,59,0,9,45,119,0,38,255,149,3,100,255,180,23,199,255,217,100,235,255,255,255,255,255],[0,10,85,5,25,29,109,18,60,59,138,42,93,83,99,52,106,110,66,64,109,123,49,65,113,139,35,66,116,192,117,98,124,255,255,137,168,100,180,155,255,22,121,174],[0,19,2,39,25,26,4,45,51,33,6,52,76,68,62,125,102,118,187,240,109,163,215,247,114,217,244,255,122,159,149,221,149,113,78,188,183,128,57,155,255,146,40,123],[0,26,1,1,51,67,4,1,84,118,14,1,104,137,152,52,112,113,65,1,122,133,149,59,124,137,152,52,135,113,65,1,142,139,154,46,163,113,13,1,204,55,3,1,249,17,1,1,255,17,1,1],[0,0,0,0,42,0,0,45,84,0,0,255,127,42,0,255,170,255,0,255,212,255,55,255,255,255,255,255],[0,0,0,0,63,42,0,45,127,255,0,255,191,255,0,45,255,255,0,0],[0,0,0,0,42,42,0,0,84,255,0,0,127,255,0,45,170,255,0,255,212,255,55,45,255,255,255,0],[0,0,0,255,63,0,55,255,127,0,255,255,191,42,255,45,255,255,255,0],[0,0,150,92,55,0,150,92,200,255,72,0,255,255,72,0],[0,1,2,14,33,2,5,35,100,13,135,92,120,43,255,193,140,247,7,249,160,193,17,208,180,39,255,154,200,4,213,236,220,39,252,135,240,193,213,253,255,255,249,255],[0,1,5,45,10,1,5,45,25,5,169,175,40,1,5,45,61,1,5,45,76,45,175,31,91,1,5,45,112,1,5,45,127,249,150,5,143,1,5,45,162,1,5,45,178,255,92,0,193,1,5,45,214,1,5,45,229,223,45,72,244,1,5,45,255,1,5,45],[0,255,95,23,30,255,82,0,60,223,13,8,90,144,44,2,120,255,110,17,150,255,69,0,180,158,13,11,210,241,82,17,255,213,37,4],[0,184,4,0,60,184,4,0,65,144,44,2,125,144,44,2,130,4,96,2,190,4,96,2,195,7,7,88,255,7,7,88],[0,196,19,10,65,255,69,45,130,223,45,72,195,255,82,103,255,223,13,17],[0,1,5,45,64,0,200,23,128,0,255,0,170,0,243,45,200,0,135,7,255,1,5,45],[0,0,28,112,50,32,96,255,100,0,243,45,150,12,95,82,200,25,190,95,255,40,170,80],[0,6,126,2,45,6,126,2,45,4,30,114,90,4,30,114,90,255,5,0,135,255,5,0,135,196,57,2,180,196,57,2,180,137,85,2,255,137,85,2],[0,255,5,0,60,255,5,0,60,196,57,2,120,196,57,2,120,6,126,2,180,6,126,2,180,4,30,114,255,4,30,114],[0,1,27,105,14,1,40,127,28,1,70,168,42,1,92,197,56,1,119,221,70,3,130,151,84,23,156,149,99,67,182,112,113,121,201,52,127,142,203,11,141,224,223,1,155,252,187,2,170,247,147,1,184,237,87,1,198,229,43,1,226,171,2,2,240,80,3,3,255,80,3,3],[0,17,177,13,64,121,242,5,128,25,173,121,192,250,77,127,255,171,101,221],[0,227,101,3,117,194,18,19,255,92,8,192],[0,229,227,1,15,227,101,3,142,40,1,80,198,17,1,79,255,0,0,45],[0,1,221,53,255,73,3,178],[0,184,1,128,160,1,193,182,219,153,227,190,255,255,255,255],[0,0,0,0,12,1,1,3,53,8,1,22,80,4,6,89,119,2,25,216,145,7,10,99,186,15,2,31,233,2,1,5,255,0,0,0],[0,255,255,255,45,7,12,255,112,227,1,127,112,227,1,127,140,255,255,255,155,227,1,127,196,45,1,99,255,255,255,255],[0,3,13,43,104,78,141,240,188,255,0,0,255,28,1,1],[0,0,0,0,66,57,227,233,96,255,255,8,124,255,255,255,153,255,255,8,188,57,227,233,255,0,0,0],[0,4,2,9,58,16,0,47,122,24,0,16,158,144,9,1,183,179,45,1,219,220,114,2,255,234,237,1],[0,0,0,0,9,1,1,1,40,5,5,6,66,5,5,6,101,10,1,12,255,0,0,0],[0,0,0,0,99,227,1,1,130,249,199,95,155,227,1,1,255,0,0,0],[0,1,1,1,43,4,1,11,76,10,1,3,109,161,4,29,127,255,86,123,165,125,16,160,204,35,13,223,255,18,2,18],[0,31,1,27,45,34,1,16,99,137,5,9,132,213,128,10,175,199,22,1,201,199,9,6,255,1,0,1],[0,247,5,0,28,255,67,1,43,234,88,11,58,234,176,51,84,229,28,1,114,113,12,1,140,255,225,44,168,113,12,1,196,244,209,88,216,255,28,1,255,53,1,1],[0,39,33,34,25,4,6,15,48,49,29,22,73,224,173,1,89,177,35,5,130,4,6,15,163,255,114,6,186,224,173,1,211,39,33,34,255,1,1,1]];
const PAL_NAMES = ["Default","* Random Cycle","* Color 1","* Colors 1&2","* Color Gradient","* Colors Only","Party","Cloud","Lava","Ocean","Forest","Rainbow","Rainbow Bands","Sunset","Rivendell","Breeze","Red & Blue","Yellowout","Analogous","Splash","Pastel","Sunset 2","Beach","Vintage","Departure","Landscape","Beech","Sherbet","Hult","Hult 64","Drywet","Jul","Grintage","Rewhi","Tertiary","Fire","Icefire","Cyane","Light Pink","Autumn","Magenta","Magred","Yelmag","Yelblu","Orange & Teal","Tiamat","April Night","Orangery","C9","Sakura","Aurora","Atlantica","C9 2","C9 New","Temperature","Aurora 2","Retro Clown","Candy","Toxy Reaf","Fairy Reaf","Semi Blue","Pink Candy","Red Reaf","Aqua Flash","Yelblu Hot","Lite Light","Red Flash","Blink Red","Red Shift","Red Tide","Candy2"];
const FX_NAMES = {"0":"Solid","2":"Breathe","12":"Fade","15":"Running","17":"Twinkle","20":"Sparkle","22":"Sparkle+","33":"Rainbow Runner","34":"Colorful","38":"Aurora","42":"Fireworks","43":"Rain","46":"Gradient","51":"Fairytwinkle","57":"Lightning","63":"Pride 2015","64":"Juggle","65":"Palette","66":"Fire 2012","67":"Colorwaves","68":"Bpm","70":"Noise 1","71":"Noise 2","72":"Noise 3","74":"Colortwinkles","75":"Lake","76":"Meteor","77":"Meteor Smooth","79":"Ripple","80":"Twinklefox","81":"Twinklecat","83":"Solid Pattern","84":"Solid Pattern Tri","87":"Glitter","88":"Candle","89":"Fireworks Starburst","90":"Fireworks 1D","91":"Bouncing Balls","92":"Sinelon","94":"Sinelon Rainbow","95":"Popcorn","96":"Drip","97":"Plasma","99":"Ripple Rainbow","100":"Heartbeat","101":"Pacifica","102":"Candle Multi","104":"Sunrise","106":"Twinkleup","107":"Noise Pal","110":"Flow","112":"Dancing Shadows","115":"Blends","117":"Dynamic Smooth","147":"Perlin Move","156":"Gravcenter","159":"DJ Light","143":"Noisefire","140":"Waterfall","137":"Freqwave","1":"Blink","3":"Wipe","4":"Wipe Random","5":"Random Colors","6":"Sweep","7":"Dynamic","8":"Colorloop","9":"Rainbow","10":"Scan","11":"Scan Dual","13":"Theater","14":"Theater Rainbow","16":"Saw","18":"Dissolve","19":"Dissolve Rnd","21":"Sparkle Dark","23":"Strobe","24":"Strobe Rainbow","25":"Strobe Mega","26":"Blink Rainbow","27":"Android","28":"Chase","29":"Chase Random","30":"Chase Rainbow","31":"Chase Flash","32":"Chase Flash Rnd","35":"Traffic Light","36":"Sweep Random","37":"Chase 2","39":"Stream","40":"Scanner","41":"Lighthouse","44":"Tetrix","45":"Fire Flicker","47":"Loading","48":"Rolling Balls","49":"Fairy","50":"Two Dots","52":"Running Dual","54":"Chase 3","55":"Tri Wipe","56":"Tri Fade","58":"ICU","59":"Multi Comet","60":"Scanner Dual","61":"Stream 2","62":"Oscillate","69":"Fill Noise","73":"Noise 4","78":"Railway","85":"Spots","86":"Spots Fade","93":"Sinelon Dual","98":"Percent","103":"Solid Glitter","105":"Phased","108":"Sine","109":"Phased Noise","111":"Chunchun","113":"Washing Machine","116":"TV Simulator","128":"Pixels","129":"Pixelwave","130":"Juggles","131":"Matripix","132":"Gravimeter","133":"Plasmoid","134":"Puddles","135":"Midnoise","136":"Noisemeter","138":"Freqmatrix","141":"Freqpixels","144":"Puddlepeak","145":"Noisemove","148":"Ripple Peak","155":"Freqmap","157":"Gravcentric","158":"Gravfreq","163":"Blurz","179":"Flow Stripe","184":"Wavesins","185":"Rocktaves"};
const FX_META = {"0":"","2":"!;!,!;!;01","12":"!;!,!;!;01","15":"!,Wave width;!,!;!","17":"!,!;!,!;!;;m12=0","20":"!,,,,,,Overlay;!,!;!;;m12=0","22":"!,!,,,,,Overlay;Bg,Fx;!;;m12=0","33":"!,Size;Bg;!","34":"!,Saturation;1,2,3;!","38":"!,!;1,2,3;!;;sx=24,pal=50","42":",Frequency;!,!;!;12;ix=192,pal=11","43":"!,Spawning rate;!,!;!;12;ix=128,pal=0","46":"!,Spread;!,!;!;;ix=16","51":"!,!;!,!;!;;m12=0","57":"!,!,,,,,Overlay;!,!;!","63":"!;;","64":"!,Trail;;!;;sx=64,ix=128","65":"Shift,Size,Rotation,,,Animate Shift,Animate Rotation,Anamorphic;;!;12;ix=112,c1=0,o1=1,o2=0,o3=1","66":"Cooling,Spark rate,,2D Blur,Boost;;!;1;sx=64,ix=160,m12=1,c2=128","67":"!,Hue;!;!","68":"!;!;!;;sx=64","70":"!;!;!","71":"!;!;!","72":"!;!;!","74":"Fade speed,Spawn speed;;!;;m12=0","75":"!;Fx;!","76":"!,Trail,,,,Gradient;!;!;1","77":"!,Trail,,,,Gradient;;!;1","79":"!,Wave #,,,,,Overlay;,!;!;12","80":"!,Twinkle rate,,,,Cool;!,!;!","81":"!,Twinkle rate,,,,Cool;!,!;!","83":"Fg size,Bg size;Fg,!;!;;pal=0","84":",Size;1,2,3;;;pal=0","87":"!,!,,,,,Overlay;,,Glitter color;!;;pal=0,m12=0","88":"!,!;!,!;!;01;sx=96,ix=224,pal=0","89":"Chance,Fragments,,,,,Overlay;,!;!;;pal=11,m12=0","90":"Gravity,Firing side,,,,,,Blur;!,!;!;12;pal=11,ix=128","91":"Gravity,# of balls,,,,,Overlay;!,!,!;!;1;m12=1","92":"!,Trail;!,!,!;!","94":"!,Trail;,,!;!","95":"!,!,,,,,Overlay;!,!,!;!;;m12=1","96":"Gravity,# of drips,,,,,Overlay;!,!;!;;m12=1","97":"Phase,!;!;!","99":"!,Wave #;;!;12","100":"!,!;!,!;!;01;m12=1","101":"!,Angle;;!;;pal=51","102":"!,!;!,!;!;;sx=96,ix=224,pal=0","104":"Time [min],Width;;!;;sx=60","106":"!,Intensity;!,!;!;;m12=0","107":"!,Scale;;!","110":"!,Zones;;!;;m12=1","112":"!,# of shadows;!;!","115":"Shift speed,Blend speed;;!","117":"!,!;;!","147":"!,# of pixels,Fade rate;!,!;!","156":"Rate of fall,Sensitivity;!,!;!;1v;ix=128,m12=2,si=0","159":"Speed;;;01f;m12=2,si=0","143":"!,!;;;01v;m12=2,si=0","140":"!,Adjust color,Select bin,Volume (min);!,!;!;01f;c2=0,m12=2,si=0","137":"Speed,Sound effect,Low bin,High bin,Pre-amp;;;01f;m12=2,si=0","1":"!,Duty cycle;!,!;!;01","3":"!,!;!,!;!","4":"!;;!","5":"!,Fade time;;!;01","6":"!,!;!,!;!","7":"!,!,,,,Smooth;;!","8":"!,Saturation;;!;01","9":"!,Size;;!","10":"!,# of dots,,,,,Overlay;!,!,!;!","11":"!,# of dots,,,,,Overlay;!,!,!;!","13":"!,Gap size;!,!;!","14":"!,Gap size;,!;!","16":"!,Width;!,!;!","18":"Repeat speed,Dissolve speed,,,,Random;!,!;!","19":"Repeat speed,Dissolve speed;,!;!","21":"!,!,,,,,Overlay;Bg,Fx;!;;m12=0","23":"!;!,!;!;01","24":"!;,!;!;01","25":"!,!;!,!;!;01","26":"Frequency,Blink duration;!,!;!;01","27":"!,Width;!,!;!;;m12=1","28":"!,Width;!,!,!;!","29":"!,Width;!,,!;!","30":"!,Width;!,!;!","31":"!;Bg,Fx;!","32":"!;!,!;!","35":"!,US style;,!;!","36":"!;;!","37":"!,Width;!,!;!","39":"!,Zone size;;!","40":"!,Trail,Delay,,,Dual,Bi-delay;!,!,!;!;;m12=0,c1=0","41":"!,Fade rate;!,!;!","44":"!,Width,,,,One color;!,!;!;;sx=0,ix=0,pal=11,m12=1","45":"!,!;!;!;01","47":"!,Fade;!,!;!;;ix=16","48":"!,# of balls,,,,Collisions,Overlay,Trails;!,!,!;!;1;m12=1","49":"!,# of flashers;!,!;!","50":"!,Dot size,,,,,Overlay;1,2,Bg;!","52":"!,Wave width;L,!,R;!","54":"!,Size;1,2,3;!","55":"!;1,2,3;!","56":"!;1,2,3;!","58":"!,!,,,,,Overlay;!,!;!","59":"!,Fade;!,!;!;1","60":"!,Trail,Delay,,,Dual,Bi-delay;!,!,!;!;;m12=0,c1=0","61":"!;;","62":"","69":"!;!;!","73":"!;!;!","78":"!,Smoothness;1,2;!","85":"Spread,Width,,,,,Overlay;!,!;!","86":"Spread,Width,,,,,Overlay;!,!;!","93":"!,Trail;!,!,!;!","98":"!,% of fill,,,,One color;!,!;!","103":",!;Bg,,Glitter color;;;m12=0","105":"!,!;!,!;!","108":"!,Scale;;!","109":"!,!;!,!;!","111":"!,Gap size;!,!;!","113":"!,!;;!","116":"!,!;;!;01","128":"Fade rate,# of pixels;!,!;!;1v;m12=0,si=0","129":"!,Sensitivity;!,!;!;1v;ix=64,m12=2,si=0","130":"!,# of balls;!,!;!;01v;m12=0,si=0","131":"!,Brightness;!,!;!;1v;ix=64,m12=2,si=1","132":"Rate of fall,Sensitivity;!,!;!;1v;ix=128,m12=2,si=0","133":"Phase,# of pixels;!,!;!;01v;sx=128,ix=128,m12=0,si=0","134":"Fade rate,Puddle size;!,!;!;1v;m12=0,si=0","135":"Fade rate,Max. length;!,!;!;1v;ix=128,m12=1,si=0","136":"Fade rate,Width;!,!;!;1v;ix=128,m12=2,si=0","138":"Speed,Sound effect,Low bin,High bin,Sensitivity;;;01f;m12=3,si=0","141":"Fade rate,Starting color and # of pixels;!,!,;!;1f;m12=0,si=0","144":"Fade rate,Puddle size,Select bin,Volume (min);!,!;!;1v;c2=0,m12=0,si=0","145":"Speed of perlin movement,Fade rate;!,!;!;01f;m12=0,si=0","148":"Fade rate,Max # of ripples,Select bin,Volume (min);!,!;!;1v;c2=0,m12=0,si=0","155":"Fade rate,Starting color;!,!;!;1f;m12=0,si=0","157":"Rate of fall,Sensitivity;!,!;!;1v;ix=128,m12=3,si=0","158":"Rate of fall,Sensitivity;!,!;!;1f;ix=128,m12=0,si=0","163":"Fade rate,Blur;!,Color mix;!;1f;m12=0,si=0","179":"Hue speed,Effect speed;;","184":"!,Brightness variation,Starting color,Range of colors,Color variation;!;!","185":";!,!;!;01f;m12=1,si=0"};


// =====================================================================================================================
// configuration (mirrors the real controller; app may change)
// =====================================================================================================================
const CFG = {
  simFps: 290,          // service() rate being simulated (controller reports ~291 fps with target fps 0 = unlimited)
  frameTime: 2,         // FRAMETIME as seen by effects: MIN_FRAME_DELAY (2) when target fps is 0/unlimited, else 1000/fps
  paletteBlend: 0,      // strip.paletteBlend (cfg light.pal-mode)
  gamma: 2.8,           // cfg light.gc.val
  gammaCorrectCol: true,// cfg light.gc.col
  globalBri: 128,       // strip.getBrightness() — only Colortwinkles reads it
  randomPaletteChangeTime: 5, // cfg light.tr.rpc (seconds); WLED changes when elapsed > rpc
  maxCatchupMs: 300,    // never simulate more than this per render() (tab was hidden etc.)
  integrate: true       // average all simulated frames between renders (persistence of vision)
};
const FRAMETIME_FIXED = 23;  // 1000 / WLED_FPS(42)

// =====================================================================================================================
// current-segment globals (WLED's SEGMENT / SEGENV / SEGLEN / strip.now) — set by the scheduler before each effect call
// =====================================================================================================================
let SEG = null, SEGLEN = 0, NOW = 0, MILLIS = 0, MICROS = 0, SEED = 1337, FRAMETIME = 2;
let AUD = null;

// =====================================================================================================================
// integer helpers
// =====================================================================================================================
const toI16 = x => (x << 16) >> 16;
const toI8 = x => (x << 24) >> 24;
const mul32 = (a, b) => Math.imul(a, b) >>> 0;              // uint32 multiply with wrap
function map(x, a, b, c, d) { return Math.trunc((x - a) * (d - c) / (b - a)) + c; } // Arduino map (long math)
function mapf(x, a, b, c, d) { return (x - a) * (d - c) / (b - a) + c; }
function constrain(x, a, b) { return x < a ? a : (x > b ? b : x); }

// ---- lib8tion (FASTLED_SCALE8_FIXED == 1)
function scale8(i, s) { return (i * (s + 1)) >> 8; }
function scale8v(i, s) { return ((i * s) >> 8) + ((i && s) ? 1 : 0); }
function qadd8(a, b) { const t = a + b; return t > 255 ? 255 : t; }
function qsub8(a, b) { const t = a - b; return t < 0 ? 0 : t; }
function scale16(i, s) { return Math.floor(i * (s + 1) / 65536); }
function triwave8(x) { x &= 255; if (x & 0x80) x = 255 - x; return (x << 1) & 255; }
function ease8InOutQuad(i) { let j = i; if (j & 0x80) j = 255 - j; let jj2 = (scale8(j, j) << 1) & 255; if (i & 0x80) jj2 = 255 - jj2; return jj2; }
function ease8InOutCubic(i) { const ii = scale8(i, i), iii = scale8(ii, i); const r1 = (3 * ii - 2 * iii) & 0xFFFF; return (r1 & 0x100) ? 255 : (r1 & 255); }
function quadwave8(x) { return ease8InOutQuad(triwave8(x)); }
function cubicwave8(x) { return ease8InOutCubic(triwave8(x)); }
function ease16InOutQuad(i) { let j = i; if (j & 0x8000) j = 65535 - j; let jj2 = (scale16(j, j) << 1) & 0xFFFF; if (i & 0x8000) jj2 = 65535 - jj2; return jj2; }
function triwave16(x) { x &= 0xFFFF; return x < 0x8000 ? x * 2 : (0xFFFF - (x - 0x8000) * 2) & 0xFFFF; } // FX.cpp version

// ---- WLED integer trig (wled_math.cpp) — tabulated, bit-exact
const SIN16 = new Int16Array(65536);
(function () {
  for (let t = 0; t < 65536; t++) {
    let th = t, sc = 1;
    if (th > 0x7FFF) { th = 0xFFFF - th; sc = -1; }
    const pre = th * (0x7FFF - th);
    SIN16[t] = Math.floor(pre * (4 * 0x7FFF) / (1342095361 - pre)) * sc;
  }
})();
const SIN8 = new Uint8Array(256);
for (let t = 0; t < 256; t++) { const s = SIN16[t * 257] + 0x7FFF + 128; SIN8[t] = Math.min(s, 0xFFFF) >> 8; }
function sin16_t(t) { return SIN16[t & 0xFFFF]; }
function cos16_t(t) { return SIN16[(t + 0x4000) & 0xFFFF]; }
function sin8_t(t) { return SIN8[t & 255]; }
function cos8_t(t) { return SIN8[(t + 64) & 255]; }
const F_0xFFFF_2PI = Math.fround(0xFFFF / (2 * Math.PI));
function sin_approx(th) { const s = Math.trunc(Math.fround(th * F_0xFFFF_2PI)) & 0xFFFF; return SIN16[s] / 0x7FFF; }
function cos_approx(th) { const s = Math.trunc(Math.fround(th * F_0xFFFF_2PI)) & 0xFFFF; return SIN16[(s + 0x4000) & 0xFFFF] / 0x7FFF; }

// ---- beat functions (FastLED GET_MILLIS = millis(), NOT strip.now)
function beat88(bpm88, tb) { return (Math.imul(Math.imul((MILLIS - (tb || 0)) | 0, bpm88 & 0xFFFF), 280) >>> 16) & 0xFFFF; }
function beat16(bpm, tb) { bpm &= 0xFFFF; if (bpm < 256) bpm <<= 8; return beat88(bpm, tb); }
function beat8(bpm, tb) { return beat16(bpm, tb) >> 8; }
function beatsin88_t(bpm88, lo, hi, tb, ph) {
  lo = (lo === undefined ? 0 : lo) & 0xFFFF; hi = (hi === undefined ? 65535 : hi) & 0xFFFF;
  const beat = beat88(bpm88, tb); const bs = (SIN16[(beat + (ph || 0)) & 0xFFFF] + 32768) & 0xFFFF;
  return (lo + scale16(bs, (hi - lo) & 0xFFFF)) & 0xFFFF;
}
function beatsin16_t(bpm, lo, hi, tb, ph) {
  lo = (lo === undefined ? 0 : lo) & 0xFFFF; hi = (hi === undefined ? 65535 : hi) & 0xFFFF;
  const beat = beat16(bpm, tb); const bs = (SIN16[(beat + (ph || 0)) & 0xFFFF] + 32768) & 0xFFFF;
  return (lo + scale16(bs, (hi - lo) & 0xFFFF)) & 0xFFFF;
}
function beatsin8_t(bpm, lo, hi, tb, ph) {
  lo = (lo === undefined ? 0 : lo) & 255; hi = (hi === undefined ? 255 : hi) & 255;
  const beat = beat8(bpm, tb); const bs = SIN8[(beat + (ph || 0)) & 255];
  return (lo + scale8(bs, (hi - lo) & 255)) & 255;
}

// ---- FastLED random (per-instance seed swapped in by the scheduler)
function random16() { SEED = (Math.imul(SEED, 2053) + 13849) & 0xFFFF; return SEED; }
function random8() { SEED = (Math.imul(SEED, 2053) + 13849) & 0xFFFF; return ((SEED & 0xFF) + (SEED >> 8)) & 0xFF; }
function random8l(lim) { return (random8() * (lim & 255)) >> 8; }
function random8r(min, lim) { return (random8l((lim - min) & 255) + min) & 255; }
function random16l(lim) { return (((lim & 0xFFFF) * random16()) / 65536) | 0; }
function random16r(min, lim) { return (random16l((lim - min) & 0xFFFF) + min) & 0xFFFF; }

// ---- FastLED Perlin noise (noise.cpp, FASTLED_NOISE_FIXED=1)
const PERM = new Uint8Array([151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,
247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,
77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,
200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,
182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,
218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,
127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180,151]);
function avg15(i, j) { return toI16((i >> 1) + (j >> 1) + (i & 1)); }
function avg7(i, j) { return toI8((i >> 1) + (j >> 1) + (i & 1)); }
function grad16_3(h, x, y, z) {
  h &= 15; let u = h < 8 ? x : y; let v = h < 4 ? y : (h === 12 || h === 14) ? x : z;
  if (h & 1) u = toI16(-u); if (h & 2) v = toI16(-v); return avg15(u, v);
}
function grad16_2(h, x, y) {
  h &= 7; let u, v; if (h < 4) { u = x; v = y; } else { u = y; v = x; }
  if (h & 1) u = toI16(-u); if (h & 2) v = toI16(-v); return avg15(u, v);
}
function grad8_2(h, x, y) {
  let u, v; if (h & 4) { u = y; v = x; } else { u = x; v = y; }
  if (h & 1) u = toI8(-u); if (h & 2) v = toI8(-v); return avg7(u, v);
}
function lerp15by16(a, b, f) {
  if (b > a) return toI16(a + scale16((b - a) & 0xFFFF, f));
  return toI16(a - scale16((a - b) & 0xFFFF, f));
}
function lerp7by8(a, b, f) {
  if (b > a) return toI8(a + scale8((b - a) & 255, f));
  return toI8(a - scale8((a - b) & 255, f));
}
function inoise16_3(x, y, z) {
  x >>>= 0; y >>>= 0; z >>>= 0;
  const P = PERM;
  const X = (x >>> 16) & 0xFF, Y = (y >>> 16) & 0xFF, Z = (z >>> 16) & 0xFF;
  const A = (P[X] + Y) & 255, AA = (P[A] + Z) & 255, AB = (P[A + 1] + Z) & 255;
  const B = (P[X + 1] + Y) & 255, BA = (P[B] + Z) & 255, BB = (P[B + 1] + Z) & 255;
  let u = x & 0xFFFF, v = y & 0xFFFF, w = z & 0xFFFF;
  const xx = (u >> 1) & 0x7FFF, yy = (v >> 1) & 0x7FFF, zz = (w >> 1) & 0x7FFF, N = 0x8000;
  u = ease16InOutQuad(u); v = ease16InOutQuad(v); w = ease16InOutQuad(w);
  const X1 = lerp15by16(grad16_3(P[AA], xx, yy, zz), grad16_3(P[BA], xx - N, yy, zz), u);
  const X2 = lerp15by16(grad16_3(P[AB], xx, yy - N, zz), grad16_3(P[BB], xx - N, yy - N, zz), u);
  const X3 = lerp15by16(grad16_3(P[AA + 1], xx, yy, zz - N), grad16_3(P[BA + 1], xx - N, yy, zz - N), u);
  const X4 = lerp15by16(grad16_3(P[AB + 1], xx, yy - N, zz - N), grad16_3(P[BB + 1], xx - N, yy - N, zz - N), u);
  const Y1 = lerp15by16(X1, X2, v), Y2 = lerp15by16(X3, X4, v);
  const ans = lerp15by16(Y1, Y2, w);
  return (Math.imul(ans + 19052, 440) >>> 8) & 0xFFFF;
}
function inoise16_2(x, y) {
  x >>>= 0; y >>>= 0;
  const P = PERM;
  const X = (x >>> 16) & 0xFF, Y = (y >>> 16) & 0xFF;
  const A = (P[X] + Y) & 255, AA = P[A], AB = P[A + 1];
  const B = (P[X + 1] + Y) & 255, BA = P[B], BB = P[B + 1];
  let u = x & 0xFFFF, v = y & 0xFFFF;
  const xx = (u >> 1) & 0x7FFF, yy = (v >> 1) & 0x7FFF, N = 0x8000;
  u = ease16InOutQuad(u); v = ease16InOutQuad(v);
  const X1 = lerp15by16(grad16_2(P[AA], xx, yy), grad16_2(P[BA], xx - N, yy), u);
  const X2 = lerp15by16(grad16_2(P[AB], xx, yy - N), grad16_2(P[BB], xx - N, yy - N), u);
  const ans = lerp15by16(X1, X2, v);
  return (Math.imul(ans + 17308, 484) >>> 8) & 0xFFFF;
}
function inoise8_2(x, y) {
  x &= 0xFFFF; y &= 0xFFFF;
  const P = PERM;
  const X = x >> 8, Y = y >> 8;
  const A = (P[X] + Y) & 255, AA = P[A], AB = P[A + 1];
  const B = (P[X + 1] + Y) & 255, BA = P[B], BB = P[B + 1];
  let u = x & 255, v = y & 255;
  const xx = (u >> 1) & 0x7F, yy = (v >> 1) & 0x7F, N = 0x80;
  u = ease8InOutQuad(u); v = ease8InOutQuad(v);
  const X1 = lerp7by8(grad8_2(P[AA], xx, yy), grad8_2(P[BA], xx - N, yy), u);
  const X2 = lerp7by8(grad8_2(P[AB], xx, yy - N), grad8_2(P[BB], xx - N, yy - N), u);
  const n = (lerp7by8(X1, X2, v) + 64) & 255;
  return qadd8(n, n);
}

// =====================================================================================================================
// colours (packed 0xRRGGBB ints; RGB-only strip so W is ignored)
// =====================================================================================================================
const GAMMA = new Uint8Array(256);
function calcGamma(g) { for (let i = 0; i < 256; i++) GAMMA[i] = Math.trunc(Math.pow(i / 255, g) * 255 + 0.5); }
calcGamma(CFG.gamma);
function gamma32(c) { if (!CFG.gammaCorrectCol) return c; return (GAMMA[(c >> 16) & 255] << 16) | (GAMMA[(c >> 8) & 255] << 8) | GAMMA[c & 255]; }
const RGB = (r, g, b) => ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
const R_ = c => (c >> 16) & 255, G_ = c => (c >> 8) & 255, B_ = c => c & 255;
const WHITE = 0xFFFFFF, BLACK = 0;

function color_blend(c1, c2, b) {
  if (b === 0) return c1;
  if (b === 255) return c2;
  const r1 = (c1 >> 16) & 255, g1 = (c1 >> 8) & 255, b1 = c1 & 255, r2 = (c2 >> 16) & 255, g2 = (c2 >> 8) & 255, b2 = c2 & 255;
  if (b > 0 && b < 255) {
    const a = 255 - b;
    return (((r2 * b + r1 * a) >> 8) << 16) | (((g2 * b + g1 * a) >> 8) << 8) | ((b2 * b + b1 * a) >> 8);
  }
  // out-of-range uint16 blend (C: unsigned wrap then byte() in RGBW32)
  b &= 0xFFFF; const a = (255 - b) >>> 0;
  const f = (x2, x1) => (((Math.imul(x2, b) + Math.imul(x1, a)) >>> 0) >>> 8) & 255;
  return (f(r2, r1) << 16) | (f(g2, g1) << 8) | f(b2, b1);
}
function color_add(c1, c2, fast) {
  if (c1 === 0) return c2; if (c2 === 0) return c1;
  const r = ((c1 >> 16) & 255) + ((c2 >> 16) & 255), g = ((c1 >> 8) & 255) + ((c2 >> 8) & 255), b = (c1 & 255) + (c2 & 255);
  if (fast) return ((r > 255 ? 255 : r) << 16) | ((g > 255 ? 255 : g) << 8) | (b > 255 ? 255 : b);
  let mx = r; if (g > mx) mx = g; if (b > mx) mx = b;
  if (mx < 256) return (r << 16) | (g << 8) | b;
  return (((r * 255 / mx) | 0) << 16) | (((g * 255 / mx) | 0) << 8) | ((b * 255 / mx) | 0);
}
function color_fade(c, a, video) {
  if (c === 0 || a + (video ? 1 : 0) === 0) return 0;
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  if (video) return ((((r * a) >> 8) + ((r && a) ? 1 : 0)) << 16) | ((((g * a) >> 8) + ((g && a) ? 1 : 0)) << 8) | (((b * a) >> 8) + ((b && a) ? 1 : 0));
  return (((r * a) >> 8) << 16) | (((g * a) >> 8) << 8) | ((b * a) >> 8);
}
// CRGB ops
function nscale8(c, s) { s += 1; return ((((c >> 16) & 255) * s >> 8) << 16) | ((((c >> 8) & 255) * s >> 8) << 8) | ((c & 255) * s >> 8); }
function nscale8v(c, s) { return (scale8v((c >> 16) & 255, s) << 16) | (scale8v((c >> 8) & 255, s) << 8) | scale8v(c & 255, s); }
function avgLight(c) { return ((((c >> 16) & 255) * 86) >> 8) + ((((c >> 8) & 255) * 86) >> 8) + (((c & 255) * 86) >> 8); }
function qaddC(a, b) { return (qadd8((a >> 16) & 255, (b >> 16) & 255) << 16) | (qadd8((a >> 8) & 255, (b >> 8) & 255) << 8) | qadd8(a & 255, b & 255); }
function maxC(a, b) { const r1 = (a >> 16) & 255, r2 = (b >> 16) & 255, g1 = (a >> 8) & 255, g2 = (b >> 8) & 255, b1 = a & 255, b2 = b & 255;
  return ((r1 > r2 ? r1 : r2) << 16) | ((g1 > g2 ? g1 : g2) << 8) | (b1 > b2 ? b1 : b2); }

// FastLED hsv2rgb_rainbow (3.6.0, Y1=1, FASTLED_SCALE8_FIXED=1)
function hsv2rgb(hue, sat, val) {
  hue &= 255; sat &= 255; val &= 255;
  const offset8 = (hue & 0x1F) << 3;
  const third = scale8(offset8, 85);
  let r, g, b;
  if (!(hue & 0x80)) {
    if (!(hue & 0x40)) {
      if (!(hue & 0x20)) { r = 255 - third; g = third; b = 0; }
      else { r = 171; g = 85 + third; b = 0; }
    } else {
      if (!(hue & 0x20)) { const tt = scale8(offset8, 170); r = 171 - tt; g = 170 + third; b = 0; }
      else { r = 0; g = 255 - third; b = third; }
    }
  } else {
    if (!(hue & 0x40)) {
      if (!(hue & 0x20)) { r = 0; const tt = scale8(offset8, 170); g = 171 - tt; b = 85 + tt; }
      else { r = third; g = 0; b = 255 - third; }
    } else {
      if (!(hue & 0x20)) { r = 85 + third; g = 0; b = 171 - third; }
      else { r = 170 + third; g = 0; b = 85 - third; }
    }
  }
  if (sat !== 255) {
    if (sat === 0) { r = 255; g = 255; b = 255; }
    else {
      let desat = 255 - sat; desat = scale8v(desat, desat);
      const satscale = 255 - desat;
      r = (scale8(r, satscale) + desat) & 255; g = (scale8(g, satscale) + desat) & 255; b = (scale8(b, satscale) + desat) & 255;
    }
  }
  if (val !== 255) {
    val = scale8v(val, val);
    if (val === 0) { r = 0; g = 0; b = 0; }
    else { r = scale8(r, val); g = scale8(g, val); b = scale8(b, val); }
  }
  return (r << 16) | (g << 8) | b;
}

// =====================================================================================================================
// palettes (CRGBPalette16 as Uint8Array(48))
// =====================================================================================================================
function fillGradRGB(e, sp, sc, ep, ec) {
  if (ep < sp) { let t = ep; ep = sp; sp = t; t = ec; ec = sc; sc = t; }
  const div = (ep - sp) || 1;
  const rd = toI16(Math.trunc((((ec >> 16) & 255) - ((sc >> 16) & 255)) * 128 / div) * 2);
  const gd = toI16(Math.trunc((((ec >> 8) & 255) - ((sc >> 8) & 255)) * 128 / div) * 2);
  const bd = toI16(Math.trunc(((ec & 255) - (sc & 255)) * 128 / div) * 2);
  let r88 = ((sc >> 16) & 255) << 8, g88 = ((sc >> 8) & 255) << 8, b88 = (sc & 255) << 8;
  for (let i = sp; i <= ep; i++) {
    e[i * 3] = r88 >> 8; e[i * 3 + 1] = g88 >> 8; e[i * 3 + 2] = b88 >> 8;
    r88 = (r88 + rd) & 0xFFFF; g88 = (g88 + gd) & 0xFFFF; b88 = (b88 + bd) & 0xFFFF;
  }
}
function palFromColors(e, cs) {   // CRGBPalette16(c1[,c2[,c3[,c4]]]) or 16 colours
  const n = cs.length;
  if (n === 16) { for (let i = 0; i < 16; i++) { e[i * 3] = R_(cs[i]); e[i * 3 + 1] = G_(cs[i]); e[i * 3 + 2] = B_(cs[i]); } }
  else if (n === 1) { for (let i = 0; i < 16; i++) { e[i * 3] = R_(cs[0]); e[i * 3 + 1] = G_(cs[0]); e[i * 3 + 2] = B_(cs[0]); } }
  else if (n === 2) fillGradRGB(e, 0, cs[0], 15, cs[1]);
  else if (n === 3) { fillGradRGB(e, 0, cs[0], 8, cs[1]); fillGradRGB(e, 8, cs[1], 15, cs[2]); }
  else { fillGradRGB(e, 0, cs[0], 5, cs[1]); fillGradRGB(e, 5, cs[1], 10, cs[2]); fillGradRGB(e, 10, cs[2], 15, cs[3]); }
  return e;
}
// fill_gradient with CHSV endpoints (SHORTEST_HUES) then hsv2rgb_rainbow — used by CRGBPalette16(CHSV x4)
function fillGradHSV(e, sp, h1, s1, v1, ep, h2, s2, v2) {
  if (ep < sp) { let t = ep; ep = sp; sp = t; t = h1; h1 = h2; h2 = t; t = s1; s1 = s2; s2 = t; t = v1; v1 = v2; v2 = t; }
  if (v2 === 0 || s2 === 0) h2 = h1;
  if (v1 === 0 || s1 === 0) h1 = h2;
  const sd = (s2 - s1) * 128, vd = (v2 - v1) * 128;
  const hd8 = (h2 - h1) & 255;
  let hdist = hd8 > 127 ? -(((256 - hd8) & 255) * 128) : hd8 * 128;
  hdist = toI16(hdist);
  const div = (ep - sp) || 1;
  const hdel = toI16(Math.trunc(hdist / div) * 2), sdel = toI16(Math.trunc(sd / div) * 2), vdel = toI16(Math.trunc(vd / div) * 2);
  let h88 = h1 << 8, s88 = s1 << 8, v88 = v1 << 8;
  for (let i = sp; i <= ep; i++) {
    const c = hsv2rgb(h88 >> 8, s88 >> 8, v88 >> 8);
    e[i * 3] = R_(c); e[i * 3 + 1] = G_(c); e[i * 3 + 2] = B_(c);
    h88 = (h88 + hdel) & 0xFFFF; s88 = (s88 + sdel) & 0xFFFF; v88 = (v88 + vdel) & 0xFFFF;
  }
}
function palFromHSV4(e, hsv) { // hsv = [h,s,v, h,s,v, h,s,v, h,s,v]
  fillGradHSV(e, 0, hsv[0], hsv[1], hsv[2], 5, hsv[3], hsv[4], hsv[5]);
  fillGradHSV(e, 5, hsv[3], hsv[4], hsv[5], 10, hsv[6], hsv[7], hsv[8]);
  fillGradHSV(e, 10, hsv[6], hsv[7], hsv[8], 15, hsv[9], hsv[10], hsv[11]);
  return e;
}
function loadGradient(st, e) {  // CRGBPalette16::loadDynamicGradientPalette
  let count = 0; do { count++; } while (st[(count - 1) * 4] !== 255);
  let lastSlotUsed = -1, k = 0, indexstart = 0;
  let rgbstart = RGB(st[1], st[2], st[3]);
  while (indexstart < 255) {
    k++;
    const indexend = st[k * 4], rgbend = RGB(st[k * 4 + 1], st[k * 4 + 2], st[k * 4 + 3]);
    let istart8 = indexstart >> 4, iend8 = indexend >> 4;
    if (count < 16) {
      if (istart8 <= lastSlotUsed && lastSlotUsed < 15) { istart8 = lastSlotUsed + 1; if (iend8 < istart8) iend8 = istart8; }
      lastSlotUsed = iend8;
    }
    fillGradRGB(e, istart8, rgbstart, iend8, rgbend);
    indexstart = indexend; rgbstart = rgbend;
  }
  return e;
}
// FastLED ColorFromPalette(CRGBPalette16, index, brightness, LINEARBLEND|NOBLEND)
function CFP(pal, index, bri, blend) {
  index &= 255;
  const hi4 = index >> 4, lo4 = index & 15, o = hi4 * 3;
  let r = pal[o], g = pal[o + 1], b = pal[o + 2];
  if (lo4 && blend) {
    const o2 = hi4 === 15 ? 0 : o + 3, f2 = lo4 << 4, f1 = 255 - f2;
    r = (scale8(r, f1) + scale8(pal[o2], f2)) & 255;
    g = (scale8(g, f1) + scale8(pal[o2 + 1], f2)) & 255;
    b = (scale8(b, f1) + scale8(pal[o2 + 2], f2)) & 255;
  }
  if (bri !== 255) {
    if (bri) { const s = bri + 1; if (r) r = scale8(r, s); if (g) g = scale8(g, s); if (b) b = scale8(b, s); }
    else { r = 0; g = 0; b = 0; }
  }
  return (r << 16) | (g << 8) | b;
}
function nblendPaletteTowardPalette(cur, tgt, maxChanges) {
  let changes = 0;
  for (let i = 0; i < 48; i++) {
    if (cur[i] === tgt[i]) continue;
    if (cur[i] < tgt[i]) { cur[i]++; changes++; }
    if (cur[i] > tgt[i]) { cur[i]--; changes++; if (cur[i] > tgt[i]) cur[i]--; }
    if (changes >= maxChanges) break;
  }
}

// fixed palettes 6..70 → CRGBPalette16
const FIXED = [];
for (let id = 0; id < PAL_RAW.length; id++) {
  const raw = PAL_RAW[id];
  if (!raw) { FIXED[id] = null; continue; }
  const e = new Uint8Array(48);
  if (id <= 12) { for (let i = 0; i < 16; i++) { e[i * 3] = raw[i * 4 + 1]; e[i * 3 + 1] = raw[i * 4 + 2]; e[i * 3 + 2] = raw[i * 4 + 3]; } }
  else loadGradient(raw, e);
  FIXED[id] = e;
}

// ---- '* Random Cycle' (palette 1): WLED keeps one global random palette, regenerated when (now_s - last) > rpc
//      using generateHarmonicRandomPalette(), blended in within a few frames. We regenerate deterministically per epoch.
const RP = { epoch: NaN, pal: new Uint8Array(48), hsv: null };
function harmonicFrom(prevHsv, seed) {
  let sd = seed & 0xFFFF;
  const r8 = () => { sd = (Math.imul(sd, 2053) + 13849) & 0xFFFF; return ((sd & 0xFF) + (sd >> 8)) & 0xFF; };
  const r8l = l => (r8() * l) >> 8, r8r = (a, b) => (r8l((b - a) & 255) + a) & 255;
  const H = [0, 0, 0, 0], S = [0, 0, 0, 0], V = [0, 0, 0, 0];
  const keep = r8l(4);
  H[keep] = (prevHsv[keep * 3] + r8l(10) - 5) & 255;
  for (let i = 0; i < 3; i++) { S[i] = r8r(200, 255); V[i] = r8r(220, 255); }
  S[3] = r8r(20, 255); V[3] = r8r(80, 255);
  for (let i = 3; i > 0; i--) { let j = r8l(i + 1), t = S[i]; S[i] = S[j]; S[j] = t; j = r8l(i + 1); t = V[i]; V[i] = V[j]; V[j] = t; }
  const bh = H[keep]; const hm = [0, 0, 0];
  switch (r8l(5)) {
    case 0: hm[0] = bh + r8r(30, 50); hm[1] = bh + r8r(10, 30); hm[2] = bh - r8r(10, 30); break;
    case 1: hm[0] = bh + 113 + r8l(15); hm[1] = bh + 233 + r8l(15); hm[2] = bh - 7 + r8l(15); break;
    case 2: hm[0] = bh + 145 + r8l(10); hm[1] = bh + 205 + r8l(10); hm[2] = bh - 5 + r8l(10); break;
    case 3: hm[0] = bh + 85 + r8l(10); hm[1] = bh + 175 + r8l(10); hm[2] = bh + 265 + r8l(10); break;
    default: hm[0] = bh + 80 + r8l(20); hm[1] = bh + 170 + r8l(20); hm[2] = bh - 15 + r8l(30); break;
  }
  if (r8() < 128) for (let i = 2; i > 0; i--) { const j = r8l(i + 1), t = hm[i]; hm[i] = hm[j]; hm[j] = t; }
  for (let i = 0, j = 0; i < 4; i++) { if (i === keep) continue; H[i] = hm[j++] & 255; }
  const pastel = r8() < 25;
  const cols = [], hsv = [];
  for (let i = 0; i < 4; i++) {
    if (pastel && S[i] > 180) S[i] -= 160;
    cols.push(gamma32(hsv2rgb(H[i], S[i], V[i])));
    hsv.push(H[i], S[i], V[i]);
  }
  return { cols, hsv };
}
function randomPalette(ms) {
  const period = (CFG.randomPaletteChangeTime + 1) * 1000;
  const ep = Math.floor(ms / period);
  if (ep !== RP.epoch) {
    let hsv = [0, 255, 255, 64, 255, 255, 128, 255, 255, 192, 255, 255];
    let res = null;
    for (let k = ep - 3; k <= ep; k++) { res = harmonicFrom(hsv, (k * 40503 + 12345) & 0xFFFF); hsv = res.hsv; }
    palFromColors(RP.pal, res.cols);
    RP.epoch = ep;
  }
  return RP.pal;
}

// default palette per effect when palette 0 is selected (Segment::loadPalette)
const DEFPAL = { 66: 35, 67: 26, 69: 9, 70: 20, 71: 43, 72: 35, 73: 26, 87: 11, 104: 35, 78: 3, 125: 11 };
// custom palettes (WLED /paletteN.json → palette id 255-N): colors gamma-corrected, then loaded as a gradient (WS2812FX::loadCustomPalettes)
const CUSTOM = []; let CUSTOM_VER = 0;
function setCustomPalette(slot, stops) {   // stops: [[pos 0-255, [r,g,b]], ...]; positions ascending, last one 255
  if (!stops || stops.length < 2) { CUSTOM[slot] = null; return; }
  const st = stops.slice(0, 18), raw = new Uint8Array(st.length * 4);
  st.forEach(([pos, c], k) => { raw[k * 4] = k === st.length - 1 ? 255 : Math.max(0, Math.min(254, pos | 0)); raw[k * 4 + 1] = GAMMA[c[0] & 255]; raw[k * 4 + 2] = GAMMA[c[1] & 255]; raw[k * 4 + 3] = GAMMA[c[2] & 255]; });
  CUSTOM[slot] = loadGradient(raw, new Uint8Array(48)); CUSTOM_VER++;
}
function buildPalette(e, pal, mode, col, ms) {
  if (pal >= 246 && pal <= 255) { const cp = CUSTOM[255 - pal]; if (cp) { e.set(cp); return e; } pal = 0; }
  if (pal >= 1000) { const cp = CUSTOM[pal]; if (cp) { e.set(cp); return e; } pal = 0; }   // app-side preview palettes (any number)
  if (pal > 70 || pal < 0) pal = 0;
  if (pal === 0 && DEFPAL[mode] !== undefined) pal = DEFPAL[mode];
  switch (pal) {
    case 0: e.set(FIXED[6]); break;
    case 1: e.set(randomPalette(ms)); break;
    case 2: palFromColors(e, [gamma32(col[0])]); break;
    case 3: { const p = gamma32(col[0]), s = gamma32(col[1]); palFromColors(e, [p, p, s, s]); break; }
    case 4: { palFromColors(e, [gamma32(col[2]), gamma32(col[1]), gamma32(col[0])]); break; }
    case 5: {
      const p = gamma32(col[0]), s = gamma32(col[1]);
      if (col[2]) { const t = gamma32(col[2]); palFromColors(e, [p, p, p, p, p, s, s, s, s, s, t, t, t, t, t, p]); }
      else palFromColors(e, [p, p, p, p, p, p, p, p, s, s, s, s, s, s, s, s]);
      break;
    }
    default: e.set(FIXED[pal]);
  }
  return e;
}

// =====================================================================================================================
// Segment pixel access (Segment::setPixelColor / getPixelColor / fill / fade_out / fadeToBlackBy / blur / color_from_palette)
// =====================================================================================================================
function setPixelColor(i, col) {
  i = (i | 0) & 0xFFFF;
  if (i >= SEGLEN) return;
  const s = SEG, len = s.len, phys = s.phys;
  if (s.opacity < 255) col = color_fade(col, s.opacity, false);
  let p = i * (s.grouping + s.spacing);
  if (s.reverse) p = s.mirror ? (((len - 1) / 2) | 0) - p : (len - 1) - p;
  const off = s.offset;
  for (let j = 0, g = s.grouping; j < g; j++) {
    let idx = s.reverse ? p - j : p + j;
    if (idx >= 0 && idx < len) {
      if (s.mirror) { let m = len - idx - 1 + off; if (m >= len) m -= len; phys[m] = col; }
      idx += off; if (idx >= len) idx -= len;
      phys[idx] = col;
    }
  }
}
function getPixelColor(i) {
  i = (i | 0) & 0xFFFF;
  const s = SEG;
  if (s.reverse) i = SEGLEN - i - 1;
  let p = i * (s.grouping + s.spacing) + s.offset;
  if (p >= s.len) p -= s.len;
  return (p >= 0 && p < s.len) ? s.phys[p] : 0;
}
function fill(c) { for (let i = 0; i < SEGLEN; i++) setPixelColor(i, c); }
function blendPixelColor(i, c, b) { setPixelColor(i, color_blend(getPixelColor(i), c, b)); }
function fade_out(rate) {
  rate = (256 - (rate & 255)) >> 1;
  const mr = (256 / (rate + 1)) | 0;
  const bg = SEG.col[1];
  const br = (bg >> 16) & 255, bgg = (bg >> 8) & 255, bb = bg & 255;
  for (let x = 0; x < SEGLEN; x++) {
    const c = getPixelColor(x);
    if (c === bg) continue;
    let r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255, d;
    d = Math.trunc((br - r) * mr / 256); if (d === 0) d = br === r ? 0 : (br > r ? 1 : -1); r = (r + d) & 255;
    d = Math.trunc((bgg - g) * mr / 256); if (d === 0) d = bgg === g ? 0 : (bgg > g ? 1 : -1); g = (g + d) & 255;
    d = Math.trunc((bb - b) * mr / 256); if (d === 0) d = bb === b ? 0 : (bb > b ? 1 : -1); b = (b + d) & 255;
    setPixelColor(x, (r << 16) | (g << 8) | b);
  }
}
function fadeToBlackBy(f) {
  f &= 255; if (!f) return;
  for (let x = 0; x < SEGLEN; x++) setPixelColor(x, color_fade(getPixelColor(x), 255 - f, false));
}
function blur(amt, smear) {
  amt &= 255; if (!amt) return;
  const keep = smear ? 255 : 255 - amt, seep = amt >> (smear ? 2 : 1);
  let carry = 0, lastnew = 0, last = 0, curnew = 0;
  for (let i = 0; i < SEGLEN; i++) {
    const cur = getPixelColor(i);
    const part = color_fade(cur, seep, false);
    curnew = color_fade(cur, keep, false);
    if (i > 0) {
      if (carry) curnew = color_add(curnew, carry, true);
      const prev = color_add(lastnew, part, true);
      if (last !== prev) setPixelColor(i - 1, prev);
    } else setPixelColor(i, curnew);
    lastnew = curnew; last = cur; carry = part;
  }
  setPixelColor(SEGLEN - 1, curnew);
}
function SEGCOLOR(x) { return SEG.colT[x]; }
function PSW() { return CFG.paletteBlend === 1 || CFG.paletteBlend === 3; }  // PALETTE_SOLID_WRAP
function color_from_palette(i, mapping, wrap, mcol, pbri) {
  if (pbri === undefined) pbri = 255; else pbri &= 255;
  const s = SEG;
  if (s.palette === 0 && mcol < 3) { const c = s.colT[mcol]; return pbri === 255 ? c : color_fade(c, pbri, true); }
  let idx = i & 0xFFFF;
  if (mapping && SEGLEN > 1) idx = ((idx * 255) / (SEGLEN - 1)) | 0;
  if (!wrap && CFG.paletteBlend !== 3) idx = scale8(idx & 255, 240);
  return CFP(s.pal, idx, pbri, CFG.paletteBlend === 3 ? 0 : 1);
}
const cfp = color_from_palette;
function color_wheel(pos) {
  pos &= 255;
  if (SEG.palette) return color_from_palette(pos, false, true, 0);
  pos = 255 - pos;
  if (pos < 85) return ((255 - pos * 3) << 16) | (pos * 3);
  if (pos < 170) { pos -= 85; return ((pos * 3) << 8) | (255 - pos * 3); }
  pos -= 170; return ((pos * 3) << 16) | ((255 - pos * 3) << 8);
}
// SEGENV.allocateData(): data survives if large enough, zeroed when call == 0
function data(key, Ctor, n) {
  const st = SEG.st;
  let a = st[key];
  if (!a || a.length < n) { a = st[key] = new Ctor(n); }
  else if (SEG.call === 0) a.fill(0);
  return a;
}

// =====================================================================================================================
// EFFECTS (ids = WLED FX_MODE_*); each returns the frame delay like WLED mode functions
// =====================================================================================================================
function mode_static() { fill(SEGCOLOR(0)); return 350; }

function mode_breath() {
  const S = SEG; let v = 0;
  let counter = mul32(NOW, (S.speed >> 3) + 10) & 0xFFFF;
  counter = (counter >> 2) + (counter >> 4);
  if (counter < 16384) { if (counter > 8192) counter = 8192 - (counter - 8192); v = Math.trunc(sin16_t(counter) / 103); }
  const lum = 30 + v, bg = SEGCOLOR(1);
  for (let i = 0; i < SEGLEN; i++) setPixelColor(i, color_blend(bg, cfp(i, true, PSW(), 0), lum));
  return FRAMETIME;
}
function mode_fade() {
  const S = SEG;
  const lum = triwave16(mul32(NOW, (S.speed >> 3) + 10)) >> 8, bg = SEGCOLOR(1);
  for (let i = 0; i < SEGLEN; i++) setPixelColor(i, color_blend(bg, cfp(i, true, PSW(), 0), lum));
  return FRAMETIME;
}
function mode_running_lights() {
  const S = SEG, xs = S.intensity >> 2, counter = mul32(NOW, S.speed) >>> 9, bg = SEGCOLOR(1);
  for (let i = 0; i < SEGLEN; i++) {
    const a = (i * xs - counter) & 255;
    setPixelColor(i, color_blend(bg, cfp(i, true, PSW(), 0), sin8_t(a)));
  }
  return FRAMETIME;
}
function mode_twinkle() {
  const S = SEG;
  fade_out(224);
  const cycle = 20 + (255 - S.speed) * 5, it = Math.floor(NOW / cycle);
  if (it !== S.step) {
    const maxOn = map(S.intensity, 0, 255, 1, SEGLEN);
    if (S.aux0 >= maxOn) { S.aux0 = 0; S.aux1 = random16(); }
    S.aux0 = (S.aux0 + 1) & 0xFFFF; S.step = it;
  }
  let prng = S.aux1;
  for (let i = 0; i < S.aux0; i++) {
    prng = (Math.imul(prng, 2053) + 13849) & 0xFFFF;
    const j = (SEGLEN * prng) >>> 16;
    setPixelColor(j, cfp(j, true, PSW(), 0));
  }
  return FRAMETIME;
}
function mode_sparkle() {
  const S = SEG;
  if (!S.check2) for (let i = 0; i < SEGLEN; i++) setPixelColor(i, cfp(i, true, PSW(), 1));
  const cycle = 10 + (255 - S.speed) * 2, it = Math.floor(NOW / cycle);
  if (it !== S.step) { S.aux0 = random16l(SEGLEN); S.step = it; }
  setPixelColor(S.aux0, SEGCOLOR(0));
  return FRAMETIME;
}
function mode_hyper_sparkle() {
  const S = SEG;
  if (!S.check2) for (let i = 0; i < SEGLEN; i++) setPixelColor(i, cfp(i, true, PSW(), 0));
  if (((NOW - S.aux0) >>> 0) > S.step) {
    if (random8l((255 - S.intensity) >> 4) === 0) {
      const n = Math.max(1, (SEGLEN / 3) | 0);
      for (let i = 0; i < n; i++) setPixelColor(random16l(SEGLEN), SEGCOLOR(1));
    }
    S.step = NOW; S.aux0 = 255 - S.speed;
  }
  return FRAMETIME;
}
function chase(color1, color2, color3) {
  const S = SEG;
  const counter = mul32(NOW, (S.speed >> 2) + 1) & 0xFFFF;
  const a = ((counter * SEGLEN) >>> 16) & 0xFFFF;
  S.step = a;
  const size = 1 + ((S.intensity * SEGLEN) >> 10);
  let b = (a + size) & 0xFFFF; if (b > SEGLEN) b -= SEGLEN;
  let c = (b + size) & 0xFFFF; if (c > SEGLEN) c -= SEGLEN;
  fill(color1);
  if (a < b) { for (let i = a; i < b; i++) setPixelColor(i, color2); }
  else { for (let i = a; i < SEGLEN; i++) setPixelColor(i, color2); for (let i = 0; i < b; i++) setPixelColor(i, color2); }
  if (b < c) { for (let i = b; i < c; i++) setPixelColor(i, color3); }
  else { for (let i = b; i < SEGLEN; i++) setPixelColor(i, color3); for (let i = 0; i < c; i++) setPixelColor(i, color3); }
  return FRAMETIME;
}
function mode_chase_rainbow_white() {
  const S = SEG;
  const n = S.step & 0xFFFF, m = (n + 1) % SEGLEN;
  const c2 = color_wheel((((n * 256 / SEGLEN) | 0) + (S.call & 0xFF)) & 0xFF);
  const c3 = color_wheel((((m * 256 / SEGLEN) | 0) + (S.call & 0xFF)) & 0xFF);
  return chase(SEGCOLOR(0), c2, c3);
}
const COLS9 = new Int32Array(9);
function mode_colorful() {
  const S = SEG, cols = COLS9;
  let num = 4;
  cols.fill(0); cols[0] = 0xFF0000; cols[1] = 0xEEBB00; cols[2] = 0x00EE00; cols[3] = 0x0077CC;
  if (S.intensity > 160 || S.palette) {
    if (!S.palette) { num = 3; for (let i = 0; i < 3; i++) cols[i] = SEGCOLOR(i); }
    else { let fac = 80; if (S.palette === 52) { num = 5; fac = 61; } for (let i = 0; i < num; i++) cols[i] = cfp(i * fac, false, true, 255); }
  } else if (S.intensity < 80) { cols[0] = 0xFF8040; cols[1] = 0xE5D241; cols[2] = 0x77FF77; cols[3] = 0x77F0F0; }
  for (let i = num; i < num * 2 - 1; i++) cols[i] = cols[i - num];
  const cycle = 50 + 8 * (255 - S.speed), it = Math.floor(NOW / cycle);
  if (it !== S.step) { if (S.speed > 0) S.aux0++; if (S.aux0 >= num) S.aux0 = 0; S.step = it; }
  for (let i = 0; i < SEGLEN; i += num) for (let j = 0; j < num; j++) setPixelColor(i + j, cols[S.aux0 + j]);
  return FRAMETIME;
}
// ---- Aurora
const W_MAX_COUNT = 20, W_MAX_SPEED = 6, W_WIDTH_FACTOR = 6;
function auroraInit(w, k, len, color) {
  w.ttl[k] = random16r(500, 1501);
  w.base[k] = color;
  w.alpha[k] = Math.fround(random8r(60, 101) / 100);
  w.age[k] = 0;
  let wd = random16r(((len / 20) | 0) & 0xFFFF, ((len / W_WIDTH_FACTOR) | 0) & 0xFFFF); if (!wd) wd = 1;
  w.width[k] = wd;
  w.center[k] = Math.fround(random8l(101) / 100 * len);
  w.left[k] = random8r(0, 2) === 0 ? 1 : 0;
  w.sf[k] = Math.fround(random8r(10, 31) / 100 * W_MAX_SPEED / 255);
  w.alive[k] = 1;
}
function mode_aurora() {
  const S = SEG; let w = S.st.waves;
  if (!w) w = S.st.waves = { ttl: new Uint16Array(W_MAX_COUNT), base: new Int32Array(W_MAX_COUNT), alpha: new Float32Array(W_MAX_COUNT),
    age: new Uint16Array(W_MAX_COUNT), width: new Uint16Array(W_MAX_COUNT), center: new Float32Array(W_MAX_COUNT),
    left: new Uint8Array(W_MAX_COUNT), sf: new Float32Array(W_MAX_COUNT), alive: new Uint8Array(W_MAX_COUNT) };
  if (S.aux0 !== S.intensity || S.call === 0) {
    S.aux1 = map(S.intensity, 0, 255, 2, W_MAX_COUNT); S.aux0 = S.intensity;
    for (let i = 0; i < S.aux1; i++) { const m = random8r(0, 3); auroraInit(w, i, SEGLEN, cfp(random8(), false, false, m)); }
  }
  for (let i = 0; i < S.aux1; i++) {
    // update
    if (w.left[i]) w.center[i] -= w.sf[i] * S.speed; else w.center[i] += w.sf[i] * S.speed;
    w.age[i]++;
    if (w.age[i] > w.ttl[i]) w.alive[i] = 0;
    else if (w.left[i]) { if (w.center[i] + w.width[i] < 0) w.alive[i] = 0; }
    else if (w.center[i] - w.width[i] > SEGLEN) w.alive[i] = 0;
    if (!w.alive[i]) { const m = random8r(0, 3); auroraInit(w, i, SEGLEN, cfp(random8(), false, false, m)); }
  }
  let bl = 1; if (SEGCOLOR(0)) bl++; if (SEGCOLOR(1)) bl++; if (SEGCOLOR(2)) bl++;
  // per-pixel saturating sum of all waves (qadd8 of non-negative values is order independent → iterate wave spans)
  const n = S.aux1;
  let A = S.st.auroraAcc; if (!A || A.length < SEGLEN * 3) A = S.st.auroraAcc = new Uint16Array(SEGLEN * 3);
  A.fill(bl, 0, SEGLEN * 3);
  for (let j = 0; j < n; j++) {
    const c = w.center[j], wd = w.width[j], ttl = w.ttl[j], age = w.age[j];
    const af = (age / ttl < 0.5) ? age / ((ttl / 2) | 0) : (ttl - age) / (ttl * 0.5);
    const bc = w.base[j], br = (bc >> 16) & 255, bgc = (bc >> 8) & 255, bb = bc & 255, al = w.alpha[j];
    let i0 = Math.ceil(c - wd), i1 = Math.floor(c + wd);
    if (i0 < 0) i0 = 0; if (i1 > SEGLEN - 1) i1 = SEGLEN - 1;
    for (let i = i0; i <= i1; i++) {
      let off = i - c; if (off < 0) off = -off;
      const f = Math.fround(Math.fround((1 - off / wd) * af) * al);
      const o = i * 3;
      A[o] += Math.trunc(br * f) & 255; A[o + 1] += Math.trunc(bgc * f) & 255; A[o + 2] += Math.trunc(bb * f) & 255;
    }
  }
  for (let i = 0, o = 0; i < SEGLEN; i++, o += 3) {
    const r = A[o] > 255 ? 255 : A[o], g = A[o + 1] > 255 ? 255 : A[o + 1], b = A[o + 2] > 255 ? 255 : A[o + 2];
    setPixelColor(i, (r << 16) | (g << 8) | b);
  }
  return FRAMETIME;
}
// ---- Fireworks / Rain
function mode_fireworks() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const width = SEGLEN;
  if (S.call === 0) { S.aux0 = 0xFFFF; S.aux1 = 0xFFFF; }
  fade_out(128);
  if (!S.step) {
    const v1 = S.aux0 < width, v2 = S.aux1 < width;
    let sv1 = 0, sv2 = 0;
    if (v1) sv1 = getPixelColor(S.aux0);
    if (v2) sv2 = getPixelColor(S.aux1);
    blur(16);
    if (v1) setPixelColor(S.aux0, sv1);
    if (v2) setPixelColor(S.aux1, sv2);
  }
  const n = Math.max(1, (width / 20) | 0);
  for (let i = 0; i < n; i++) {
    if (random8l(129 - (S.intensity >> 1)) === 0) {
      const index = random16l(width);
      setPixelColor(index, cfp(random8(), false, false, 0));
      S.aux1 = S.aux0; S.aux0 = index;
    }
  }
  return FRAMETIME;
}
function mode_rain() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const width = SEGLEN;
  S.step = (S.step + FRAMETIME) >>> 0;
  if (S.call && S.step > (5 + ((50 * (255 - S.speed)) / SEGLEN | 0))) {
    S.step = 1;
    const ct = getPixelColor(0);
    for (let i = 0; i < SEGLEN - 1; i++) setPixelColor(i, getPixelColor(i + 1));
    setPixelColor(SEGLEN - 1, ct);
    S.aux0 = (S.aux0 + 1) & 0xFFFF; S.aux1 = (S.aux1 + 1) & 0xFFFF;
    if (S.aux0 === 0) S.aux0 = 0xFFFF;
    if (S.aux1 === 0) S.aux0 = 0xFFFF;   // sic (WLED bug kept)
    if (S.aux0 >= width) S.aux0 = 0;
    if (S.aux1 >= width) S.aux1 = 0;
  }
  return mode_fireworks();
}
function mode_gradient() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const counter = mul32(NOW, (S.speed >> 2) + 1) & 0xFFFF;
  let pp = ((counter * SEGLEN) >>> 16) & 0xFFFF;
  if (S.call === 0) pp = 0;
  const brd = S.intensity >> 1;   // sic: "1 + loading ? ix/2 : ix/4" always picks ix/2
  const p1 = pp - SEGLEN, p2 = pp + SEGLEN, c0 = SEGCOLOR(0);
  for (let i = 0; i < SEGLEN; i++) {
    let val = Math.min(Math.abs(pp - i), Math.abs(p1 - i), Math.abs(p2 - i));
    val = brd > val ? ((val * 255 / brd) | 0) : 255;
    setPixelColor(i, color_blend(c0, cfp(i, true, PSW(), 1), val));
  }
  return FRAMETIME;
}
function mode_fairytwinkle() {
  const S = SEG;
  const fs = data('fs', Uint16Array, SEGLEN), fd = data('fd', Uint8Array, SEGLEN), fo = data('fo', Uint8Array, SEGLEN);
  const now16 = NOW & 0xFFFF;
  let prng = 5100;   // + segment id 0
  const rft = 400 + (255 - S.speed) * 3;
  const maxDur = ((rft / 100) | 0) + ((255 - S.intensity) >> 2) + 13 + ((255 - S.intensity) >> 1);
  const bg = SEGCOLOR(1);
  for (let f = 0; f < SEGLEN; f++) {
    let stateTime = (now16 - fs[f]) & 0xFFFF;
    if (stateTime > fd[f] * 100) {
      fo[f] = fo[f] ? 0 : 1;
      const init = !fd[f];
      if (fo[f]) fd[f] = (((rft / 100) | 0) + ((255 - S.intensity) >> 2) + random8l(12 + ((255 - S.intensity) >> 1)) + 1) & 255;
      else fd[f] = (((rft / 100) | 0) + random8l(3 + ((255 - S.speed) >> 6)) + 1) & 255;
      fs[f] = now16; stateTime = 0;
      if (init) { fs[f] = (fs[f] - rft) & 0xFFFF; fd[f] = (((rft / 100) | 0) + random8l(12 + ((255 - S.intensity) >> 1)) + 5) & 255; stateTime = rft; }
    }
    if (fo[f] && fd[f] > maxDur) fd[f] = maxDur & 255;
    if (stateTime > rft) stateTime = rft;
    const fadeprog = 255 - ((stateTime * 255 / rft) | 0);
    const fb = fo[f] ? 255 - GAMMA_RAW[fadeprog] : GAMMA_RAW[fadeprog];
    const lastR = prng; let diff = 0;
    while (diff < 0x4000) { prng = (Math.imul(prng, 2053) + 1384) & 0xFFFF; diff = prng > lastR ? prng - lastR : lastR - prng; }
    setPixelColor(f, color_blend(bg, cfp(prng >> 8, false, false, 0), fb));
  }
  return FRAMETIME;
}
function mode_lightning() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const ledstart = random16l(SEGLEN);
  const ledlen = 1 + random16l(SEGLEN - ledstart);
  let bri = (255 / random8r(1, 3)) | 0;
  if (S.aux1 === 0) { S.aux1 = random8r(4, 4 + ((S.intensity / 20) | 0)); S.aux1 *= 2; bri = 52; S.aux0 = 200; }
  if (!S.check2) fill(SEGCOLOR(1));
  if (S.aux1 > 3 && !(S.aux1 & 1)) {
    for (let i = ledstart; i < ledstart + ledlen; i++) setPixelColor(i, cfp(i, true, PSW(), 0, bri));
    S.aux1--; S.step = NOW;
  } else if (((NOW - S.step) >>> 0) > S.aux0) {
    S.aux1--; if (S.aux1 < 2) S.aux1 = 0;
    S.aux0 = 50 + random8l(100);
    if (S.aux1 === 2) S.aux0 = random8l(255 - S.speed) * 100;
    S.step = NOW;
  }
  return FRAMETIME;
}
function mode_pride_2015() {
  const S = SEG;
  const duration = 10 + S.speed;
  let sPseudotime = S.step >>> 0, sHue16 = S.aux0;
  const sat8 = beatsin88_t(87, 220, 250) & 255;
  const brightdepth = beatsin88_t(341, 96, 224) & 255;
  const btinc = beatsin88_t(203, 25 * 256, 40 * 256);
  const msm = beatsin88_t(147, 23, 60);
  let hue16 = sHue16;
  const hueinc16 = beatsin88_t(113, 1, 3000);
  sPseudotime = (sPseudotime + duration * msm) >>> 0;
  sHue16 = (sHue16 + duration * beatsin88_t(400, 5, 9)) >>> 0;
  let bt = sPseudotime;
  for (let i = 0; i < SEGLEN; i++) {
    hue16 += hueinc16;
    const hue8 = (hue16 >> 8) & 255;
    bt = (bt + btinc) >>> 0;
    const b16 = sin16_t(bt) + 32768;
    const bri16 = Math.floor(b16 * b16 / 65536);
    let bri8 = Math.floor(bri16 * brightdepth / 65536) & 255;
    bri8 = (bri8 + 255 - brightdepth) & 255;
    blendPixelColor(i, hsv2rgb(hue8, sat8, bri8), 64);
  }
  S.step = sPseudotime; S.aux0 = sHue16 & 0xFFFF;
  return FRAMETIME;
}
function mode_juggle() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  fadeToBlackBy(192 - ((3 * S.intensity / 4) | 0));
  let dothue = 0;
  for (let i = 0; i < 8; i++) {
    const index = beatsin88_t((16 + S.speed) * (i + 7), 0, SEGLEN - 1);
    let c = getPixelColor(index);
    c = maxC(c, S.palette === 0 ? hsv2rgb(dothue, 220, 255) : CFP(S.pal, dothue, 255, 1));
    setPixelColor(index, c);
    dothue = (dothue + 32) & 255;
  }
  return FRAMETIME;
}
function mode_palette() {
  const S = SEG;
  const cols = SEGLEN;
  const inputShift = S.speed, inputSize = S.intensity, inputRotation = S.custom1;
  const animShift = S.check1, animRot = S.check2, square = S.check3;
  const theta = !animRot ? Math.fround((inputRotation + 128) * Math.fround(Math.PI / 256))
                         : Math.fround((mul32(NOW, (inputRotation >> 4) + 1) & 0xFFFF) * Math.fround(2 * Math.PI / 0xFFFF));
  const sinT = sin_approx(theta), cosT = cos_approx(theta);
  const maxX = Math.max(1, cols - 1), maxY = 1;
  const maxXIn = square ? maxX : 1, maxYIn = square ? maxY : 1;
  const maxXOut = !square ? maxX : 1, maxYOut = !square ? maxY : 1;
  const cX = maxXOut / 2, cY = maxYOut / 2;
  const scale = Math.abs(sinT) + (Math.abs(cosT) * maxYOut / maxXOut);
  const ytc = (cosT * (0 - cY * maxYIn)) / (maxYIn * scale);
  const off = !animShift ? inputShift : ((mul32(NOW, (inputShift >> 3) + 1) & 0xFFFF) >> 8);
  for (let x = 0; x < cols; x++) {
    const xts = (sinT * (x - cX * maxXIn)) / (maxXIn * scale);
    const sx = xts + ytc + cX;
    let ci = Math.trunc((Math.min(Math.max(sx, 0), maxXOut) * 255) / maxXOut);
    if (inputSize <= 128) ci = Math.trunc(ci * inputSize / 128); else ci = Math.trunc((inputSize - 112) * ci / 16);
    ci -= off;
    setPixelColor(x, color_wheel(ci & 255));
  }
  return FRAMETIME;
}
function mode_fire_2012() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const heat = data('heat', Uint8Array, SEGLEN);
  const it = NOW >>> 5;
  const ign = Math.max(3, (SEGLEN / 10) | 0);
  const newIt = it !== S.step;
  const coolLim = ((((20 + ((S.speed / 3) | 0)) * 16) / SEGLEN) | 0) + 2;
  for (let i = 0; i < SEGLEN; i++) {
    const cool = newIt ? random8l(coolLim) : random8l(4);
    const minT = i < ign ? (((ign - i) / 4) | 0) + 16 : 0;
    const t = qsub8(heat[i], cool);
    heat[i] = t < minT ? minT : t;
  }
  if (newIt) {
    for (let k = SEGLEN - 1; k > 1; k--) heat[k] = ((heat[k - 1] + (heat[k - 2] << 1)) / 3) | 0;
    if (random8() <= S.intensity) {
      const y = random8l(ign);
      const boost = (((17 + S.custom3) * (ign - (y >> 1))) / ign) | 0;
      heat[y] = qadd8(heat[y], random8r(96 + 2 * boost, 207 + boost));
    }
  }
  for (let j = 0; j < SEGLEN; j++) setPixelColor(j, CFP(S.pal, Math.min(heat[j], 240), 255, 0));
  if (newIt) S.step = it;
  return FRAMETIME;
}
function mode_colorwaves() {
  const S = SEG;
  const duration = 10 + S.speed;
  let sPseudotime = S.step >>> 0, sHue16 = S.aux0;
  const brightdepth = beatsin88_t(341, 96, 224);
  const btinc = beatsin88_t(203, 25 * 256, 40 * 256);
  const msm = beatsin88_t(147, 23, 60);
  let hue16 = sHue16;
  const hueinc16 = (beatsin88_t(113, 60, 300) * S.intensity * 10 / 255) | 0;
  sPseudotime = (sPseudotime + duration * msm) >>> 0;
  sHue16 = (sHue16 + duration * beatsin88_t(400, 5, 9)) >>> 0;
  let bt = sPseudotime;
  for (let i = 0; i < SEGLEN; i++) {
    hue16 += hueinc16;
    const h = hue16 >>> 7;
    const hue8 = (h & 0x100) ? (255 - (h >> 1)) & 255 : (h >> 1) & 255;
    bt = (bt + btinc) >>> 0;
    const b16 = sin16_t(bt) + 32768;
    const bri16 = Math.floor(b16 * b16 / 65536);
    let bri8 = Math.floor(bri16 * brightdepth / 65536) & 255;
    bri8 = (bri8 + 255 - brightdepth) & 255;
    blendPixelColor(i, cfp(hue8, false, PSW(), 0, bri8), 128);
  }
  S.step = sPseudotime; S.aux0 = sHue16 & 0xFFFF;
  return FRAMETIME;
}
function mode_bpm() {
  const S = SEG;
  const stp = Math.floor(NOW / 20) & 0xFF;
  const beat = beatsin8_t(S.speed, 64, 255);
  for (let i = 0; i < SEGLEN; i++) setPixelColor(i, cfp(stp + i * 2, false, PSW(), 0, (beat - stp + i * 10) & 255));
  return FRAMETIME;
}
function mode_noise16_1() {
  const S = SEG;
  S.step = (S.step + 1 + (S.speed >> 4)) >>> 0;
  const shx = beatsin8_t(11), shy = Math.floor(S.step / 42);
  for (let i = 0; i < SEGLEN; i++) {
    const n = inoise16_3((i + shx) * 320, (i + shy) * 320, S.step) >> 8;
    setPixelColor(i, cfp(sin8_t(n * 3), false, PSW(), 0));
  }
  return FRAMETIME;
}
function mode_noise16_2() {
  const S = SEG;
  S.step = (S.step + 1 + (S.speed >> 1)) >>> 0;
  const shx = S.step >>> 6;
  for (let i = 0; i < SEGLEN; i++) {
    const n = inoise16_3(mul32(i + shx, 1000), 0, 4223) >> 8;
    setPixelColor(i, cfp(sin8_t(n * 3), false, PSW(), 0, n));
  }
  return FRAMETIME;
}
function mode_noise16_3() {
  const S = SEG;
  S.step = (S.step + 1 + S.speed) >>> 0;
  const z = mul32(S.step, 8);
  for (let i = 0; i < SEGLEN; i++) {
    const n = inoise16_3((i + 4223) * 800, (i + 1234) * 800, z) >> 8;
    setPixelColor(i, cfp(sin8_t(n * 3), false, PSW(), 0, n));
  }
  return FRAMETIME;
}
function mode_colortwinkle() {
  const S = SEG;
  const bits = data('bits', Uint8Array, (SEGLEN + 7) >> 3);
  const gb = CFG.globalBri;
  const up = gb > 28 ? 8 + (S.speed >> 2) : 68 - gb;
  const down = gb > 28 ? 8 + (S.speed >> 3) : 68 - gb;
  for (let i = 0; i < SEGLEN; i++) {
    let c = getPixelColor(i);
    const prev = c, bi = i >> 3, bn = i & 7;
    if (bits[bi] & (1 << bn)) {
      c = qaddC(c, nscale8v(c, up));
      if (R_(c) === 255 || G_(c) === 255 || B_(c) === 255) bits[bi] &= ~(1 << bn);
      setPixelColor(i, c);
      if (getPixelColor(i) === prev) { c = qaddC(c, c); setPixelColor(i, c); }
    } else {
      setPixelColor(i, nscale8(c, 255 - down));
    }
  }
  for (let j = 0; j <= ((SEGLEN / 50) | 0); j++) {
    if (random8() <= S.intensity) {
      for (let t = 0; t < 5; t++) {
        const i = random16l(SEGLEN);
        if (getPixelColor(i) === 0) {
          const c = CFP(S.pal, random8(), 64, 0);
          bits[i >> 3] |= 1 << (i & 7);
          setPixelColor(i, c);
          break;
        }
      }
    }
  }
  return FRAMETIME_FIXED;
}
function mode_lake() {
  const S = SEG;
  const sp = (S.speed / 10) | 0;
  const w1 = beatsin8_t(sp + 2, -64, 64), w2 = beatsin8_t(sp + 1, -64, 64), w3 = beatsin8_t(sp + 2, 0, 80);
  for (let i = 0; i < SEGLEN; i++) {
    const index = (cos8_t(i * 15 + w1) >> 1) + (cubicwave8((i * 23 + w2) & 255) >> 1);
    const lum = index > w3 ? index - w3 : 0;
    setPixelColor(i, cfp(index, false, false, 0, lum));
  }
  return FRAMETIME;
}
function mode_meteor() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const trail = data('trail', Uint8Array, SEGLEN);
  const msize = 1 + ((SEGLEN / 20) | 0);
  const counter = mul32(NOW, (S.speed >> 2) + 8);
  const inn = (mul32(counter, SEGLEN) >>> 16) & 0xFFFF;
  const max = S.palette === 5 ? 239 : 255;
  for (let i = 0; i < SEGLEN; i++) {
    if (random8() <= 255 - S.intensity) {
      const decay = 128 + random8l(127);
      trail[i] = scale8(trail[i], decay);
      let index = trail[i], idx = 255, bri = (S.palette === 35 || S.palette === 36) ? 255 : trail[i];
      if (!S.check1) { idx = 0; index = map(i, 0, SEGLEN, 0, max); bri = trail[i]; }
      setPixelColor(i, cfp(index, false, false, idx, bri));
    }
  }
  for (let j = 0; j < msize; j++) {
    const index = (inn + j) % SEGLEN;
    let idx = 255;
    let i = trail[index] = max;
    if (!S.check1) { i = map(index, 0, SEGLEN, 0, max); idx = 0; }
    setPixelColor(index, cfp(i, false, false, idx, 255));
  }
  return FRAMETIME;
}
function mode_meteor_smooth() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const trail = data('trail', Uint8Array, SEGLEN);
  const msize = 1 + ((SEGLEN / 20) | 0);
  const inn = map((S.step >>> 6) & 0xFF, 0, 255, 0, SEGLEN - 1) & 0xFFFF;
  const max = (S.palette === 5 || !S.check1) ? 240 : 255;
  for (let i = 0; i < SEGLEN; i++) {
    if (random8() <= 255 - S.intensity) {
      const ch = trail[i] + 4 - random8l(24);
      trail[i] = constrain(ch, 0, max);
      setPixelColor(i, S.check1 ? cfp(i, true, false, 0, trail[i]) : cfp(trail[i], false, true, 255));
    }
  }
  for (let j = 0; j < msize; j++) {
    let index = inn + j; if (index >= SEGLEN) index -= SEGLEN;
    trail[index] = max;
    setPixelColor(index, S.check1 ? cfp(index, true, false, 0, trail[index]) : cfp(trail[index], false, true, 255));
  }
  S.step = (S.step + S.speed + 1) >>> 0;
  return FRAMETIME;
}
// ---- Ripple
function ripple_base() {
  const S = SEG;
  const maxR = Math.min(1 + (SEGLEN >> 2), 100);
  const rs = data('rs', Uint8Array, maxR), rc = data('rc', Uint8Array, maxR), rp = data('rp', Uint16Array, maxR);
  for (let i = 0; i < maxR; i++) {
    let state = rs[i];
    if (state) {
      const decay = (S.speed >> 4) + 1, origin = rp[i];
      const col = cfp(rc[i], false, false, 255);
      const prop = Math.imul(((state / decay) | 0) - 1, S.speed + 1) >>> 0;
      const propI = prop >>> 8, propF = prop & 0xFF;
      const amp = state < 17 ? triwave8((state - 1) * 8) : map(state, 17, 255, 255, 2);
      const left = origin - propI - 1, right = origin + propI + 2;
      for (let v = 0; v < 4; v++) {
        const mag = scale8(cubicwave8(((propF >> 2) + v * 64) & 255), amp);
        setPixelColor(left + v, color_blend(getPixelColor(left + v), col, mag));
        setPixelColor(right - v, color_blend(getPixelColor(right - v), col, mag));
      }
      state += decay;
      rs[i] = state > 254 ? 0 : state;
    } else if (random16l(5100 + 10000) <= S.intensity) {
      rs[i] = 1; rp[i] = random16l(SEGLEN); rc[i] = random8();
    }
  }
  return FRAMETIME;
}
function mode_ripple() {
  if (SEGLEN === 1) return mode_static();
  if (!SEG.check2) fill(SEGCOLOR(1)); else fade_out(250);
  return ripple_base();
}
function mode_ripple_rainbow() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  if (S.call === 0) { S.aux0 = random8(); S.aux1 = random8(); }
  if (S.aux0 === S.aux1) S.aux1 = random8();
  else if (S.aux1 > S.aux0) S.aux0 = (S.aux0 + 1) & 0xFFFF;
  else S.aux0 = (S.aux0 - 1) & 0xFFFF;
  fill(color_blend(color_wheel(S.aux0), BLACK, 235));
  return ripple_base();
}
// ---- Twinklefox / Twinklecat
function twinklefox_one(ms, salt, cat) {
  const S = SEG;
  const ticks = Math.floor(ms / S.aux0);
  const fast8 = ticks & 255;
  let slow16 = ((ticks >>> 8) + salt) & 0xFFFF;
  slow16 = (slow16 + sin8_t(slow16)) & 0xFFFF;
  slow16 = (Math.imul(slow16, 2053) + 1384) & 0xFFFF;
  const slow8 = ((slow16 & 0xFF) + (slow16 >> 8)) & 0xFF;
  const dens = (S.intensity >> 5) + 1;
  let bright = 0;
  if (((slow8 & 0x0E) >> 1) < dens) {
    let ph = fast8;
    if (cat) bright = 255 - ph;
    else if (ph < 86) bright = ph * 3;
    else { ph -= 86; bright = 255 - (ph + (ph >> 1)); }
  }
  if (bright > 0) {
    let c = CFP(S.pal, (slow8 - salt) & 255, bright, 0);
    if (!S.check1 && fast8 >= 128) {
      const cool = (fast8 - 128) >> 4;
      c = (c & 0xFF0000) | (qsub8((c >> 8) & 255, cool) << 8) | qsub8(c & 255, cool * 2);
    }
    return c;
  }
  return 0;
}
function twinklefox_base(cat) {
  const S = SEG;
  let prng = 11337;
  S.aux0 = S.speed > 100 ? 3 + ((255 - S.speed) >> 3) : 22 + ((100 - S.speed) >> 1);
  let bg = SEGCOLOR(1);
  const bgl = avgLight(bg);
  bg = nscale8v(bg, bgl > 64 ? 16 : (bgl > 16 ? 64 : 86));
  const bgb = avgLight(bg);
  for (let i = 0; i < SEGLEN; i++) {
    prng = (Math.imul(prng, 2053) + 1384) & 0xFFFF;
    const off16 = prng;
    prng = (Math.imul(prng, 2053) + 1384) & 0xFFFF;
    const mult = ((((prng & 0xFF) >> 4) + (prng & 0x0F)) & 0x0F) + 0x08;
    const clk = ((mul32(NOW, mult) >>> 3) + off16) >>> 0;
    const c = twinklefox_one(clk, prng >> 8, cat);
    const d = avgLight(c) - bgb;
    if (d >= 32 || !bg) setPixelColor(i, c);
    else if (d > 0) setPixelColor(i, color_blend(bg, c, d * 8));
    else setPixelColor(i, bg);
  }
  return FRAMETIME;
}
function mode_static_pattern() {
  const S = SEG;
  const lit = 1 + S.speed, unlit = 1 + S.intensity, c1 = SEGCOLOR(1);
  let on = true, cnt = 0;
  for (let i = 0; i < SEGLEN; i++) {
    setPixelColor(i, on ? cfp(i, true, PSW(), 0) : c1);
    if (++cnt >= (on ? lit : unlit)) { cnt = 0; on = !on; }
  }
  return FRAMETIME;
}
function mode_tri_static_pattern() {
  const S = SEG;
  const size = (S.intensity >> 5) + 1;
  let seg = 0, cnt = 0;
  for (let i = 0; i < SEGLEN; i++) {
    setPixelColor(i, SEGCOLOR(seg % 3));
    if (++cnt >= size) { seg++; cnt = 0; }
  }
  return FRAMETIME;
}
function mode_glitter() {
  const S = SEG;
  if (!S.check2) {
    let counter = 0;
    if (S.speed !== 0) counter = (mul32(NOW, (S.speed >> 3) + 1) & 0xFFFF) >> 8;
    const noWrap = CFG.paletteBlend === 2 || (CFG.paletteBlend === 0 && S.speed === 0);
    for (let i = 0; i < SEGLEN; i++) {
      let ci = (((i * 255 / SEGLEN) | 0) - counter) | 0;
      if (noWrap) ci = map(ci, 0, 255, 0, 240);
      setPixelColor(i, cfp(ci, false, true, 255));
    }
  }
  if (S.intensity > random8()) setPixelColor(random16l(SEGLEN), SEGCOLOR(2) ? SEGCOLOR(2) : WHITE);
  return FRAMETIME;
}
function candle(multi) {
  const S = SEG;
  let d3 = null;
  if (multi && SEGLEN > 1) d3 = data('cd', Uint8Array, Math.max(1, SEGLEN - 1) * 3);
  else multi = false;
  const vr = S.intensity, rnd = vr >> 1;
  let sf = 4;
  if (S.speed > 252) sf = 1; else if (S.speed > 99) sf = 2; else if (S.speed > 49) sf = 3;
  const num = multi ? SEGLEN : 1;
  const bg = SEGCOLOR(1);
  for (let i = 0; i < num; i++) {
    let d = 0, s = S.aux0, st = S.aux1, fstep = S.step;
    if (i > 0) { d = (i - 1) * 3; s = d3[d]; st = d3[d + 1]; fstep = d3[d + 2]; }
    if (fstep === 0) { s = 128; st = 130 + random8l(4); fstep = 1; }
    let nt = false;
    if (st > s) { s = qadd8(s, fstep); if (s >= st) nt = true; }
    else { s = qsub8(s, fstep); if (s <= st) nt = true; }
    if (nt) {
      st = (random8l(rnd) + random8l(rnd));
      if (st < (rnd >> 1)) st = (rnd >> 1) + random8l(rnd);
      st += 255 - vr;
      const dif = st > s ? st - s : s - st;
      fstep = dif >> sf; if (fstep === 0) fstep = 1;
    }
    if (i > 0) {
      setPixelColor(i, color_blend(bg, cfp(i, true, PSW(), 0), s));
      d3[d] = s; d3[d + 1] = st; d3[d + 2] = fstep;
    } else {
      for (let j = 0; j < SEGLEN; j++) setPixelColor(j, color_blend(bg, cfp(j, true, PSW(), 0), s));
      S.aux0 = s & 0xFFFF; S.aux1 = st & 0xFFFF; S.step = fstep;
    }
  }
  return FRAMETIME_FIXED;
}
// ---- Fireworks Starburst
const STAR_FRAG = 10;
function mode_starburst() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const numStars = Math.min(1 + (SEGLEN >> 3), (5120 / 60) | 0);
  const sCol = data('sc', Int32Array, numStars), sBirth = data('sb', Uint32Array, numStars), sLast = data('sl', Uint32Array, numStars);
  const sVel = data('sv', Float32Array, numStars), sPos = data('sp', Uint16Array, numStars), frag = data('sf', Float32Array, numStars * STAR_FRAG);
  const it = NOW;
  for (let j = 0; j < numStars; j++) {
    if (random8l(144 - (S.speed >> 1)) === 0 && sBirth[j] === 0) {
      const startPos = random16l(SEGLEN - 1);
      const mult = random8() / 255;
      sCol[j] = color_wheel(random8());
      sPos[j] = startPos;
      sVel[j] = 375 * random8() / 255 * mult;
      sBirth[j] = it; sLast[j] = it;
      const num = random8r(3, 6 + (S.intensity >> 5));
      for (let i = 0; i < STAR_FRAG; i++) frag[j * STAR_FRAG + i] = i < num ? startPos : -1;
    }
  }
  if (!S.check2) fill(SEGCOLOR(1));
  for (let j = 0; j < numStars; j++) {
    const fb = j * STAR_FRAG;
    if (sBirth[j] !== 0) {
      const dt = ((it - sLast[j]) >>> 0) / 1000;
      for (let i = 0; i < STAR_FRAG; i++) { const v = i >> 1; if (frag[fb + i] > 0) frag[fb + i] += sVel[j] * dt * v / 3; }
      sLast[j] = it;
      sVel[j] -= 3 * sVel[j] * dt;
    }
    let c = sCol[j], fade = 0;
    let age = (it - sBirth[j]) >>> 0;
    if (age < 250) c = color_blend(WHITE, c, Math.trunc(254.5 * (age / 250)));
    else if (age > 1750) { fade = 1; sBirth[j] = 0; c = SEGCOLOR(1); }
    else { age -= 250; fade = Math.fround(age / 1500); c = color_blend(c, SEGCOLOR(1), Math.trunc(254.5 * fade) & 255); }
    const ps = (1 - fade) * 2;
    for (let index = 0; index < STAR_FRAG * 2; index++) {
      const i = index >> 1;
      if (frag[fb + i] > 0) {
        let loc = frag[fb + i];
        if (index & 1) loc -= (loc - sPos[j]) * 2;
        let start = Math.trunc(loc - ps), end = Math.trunc(loc + ps);
        if (start < 0) start = 0;
        if (start === end) end++;
        if (end > SEGLEN) end = SEGLEN;
        for (let p = start; p < end; p++) setPixelColor(p, c);
      }
    }
  }
  return FRAMETIME;
}
// ---- Fireworks 1D (exploding fireworks)
function mode_exploding_fireworks() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const rows = SEGLEN;
  const numSparks = Math.min(5 + (rows >> 1), (5120 / 20) | 0);
  const dataSize = 20 * numSparks;
  const pos = data('pos', Float32Array, numSparks), posX = data('px', Float32Array, numSparks), vel = data('vel', Float32Array, numSparks);
  const col = data('col', Uint16Array, numSparks), ci = data('ci', Uint8Array, numSparks), dg = data('dg', Float32Array, 1);
  if (dataSize !== S.aux1) { dg[0] = 0; S.aux0 = 0; S.aux1 = dataSize; }
  fade_out(252);
  let gravity = Math.fround(-0.0004 - S.speed / 800000); gravity = Math.fround(gravity * rows);
  if (S.aux0 < 2) {
    if (S.aux0 === 0) {
      pos[0] = 0;
      posX[0] = S.intensity > random8() ? 1 : 0;
      let peak = 75 + random8l(180); peak = (peak * (rows - 1)) >> 8;
      vel[0] = Math.sqrt(-2 * gravity * peak);
      col[0] = 255;
      S.aux0 = 1;
    }
    if (vel[0] > 12 * gravity) {
      const c = col[0] & 255;
      setPixelColor(posX[0] > 0 ? rows - Math.trunc(pos[0]) - 1 : Math.trunc(pos[0]), (c << 16) | (c << 8) | c);
      pos[0] += vel[0];
      pos[0] = constrain(pos[0], 0, rows - 1);
      vel[0] += gravity;
      col[0] -= 2;
    } else S.aux0 = 2;
  } else if (S.aux0 < 4) {
    let nS = Math.trunc(pos[0] + random8l(4));
    nS = Math.max(nS, 4); nS = Math.min(nS, numSparks);
    if (S.aux0 === 2) {
      for (let i = 1; i < nS; i++) {
        pos[i] = pos[0]; posX[i] = posX[0];
        vel[i] = random16l(20001) / 10000 - 0.9;
        vel[i] *= rows < 32 ? 0.5 : 1;
        col[i] = 345;
        ci[i] = random8();
        vel[i] *= pos[0] / rows;
        vel[i] *= -gravity * 50;
      }
      dg[0] = gravity / 2;
      S.aux0 = 3;
    }
    if (col[1] > 4) {
      for (let i = 1; i < nS; i++) {
        pos[i] += vel[i];
        vel[i] += dg[0];
        if (col[i] > 3) col[i] -= 4;
        if (pos[i] > 0 && pos[i] < rows) {
          const prog = col[i];
          const spc = S.palette ? color_wheel(ci[i]) : SEGCOLOR(0);
          let c = 0;
          if (prog > 300) c = color_blend(spc, WHITE, (prog - 300) * 5);
          else if (prog > 45) {
            c = color_blend(BLACK, spc, prog - 45);
            const cool = (300 - prog) >> 5;
            c = (c & 0xFF0000) | (qsub8((c >> 8) & 255, cool) << 8) | qsub8(c & 255, cool * 2);
          }
          setPixelColor(Math.trunc(posX[i]) ? rows - Math.trunc(pos[i]) - 1 : Math.trunc(pos[i]), c);
        }
      }
      if (S.check3) blur(16);
      dg[0] *= 0.8;
    } else S.aux0 = 6 + random8l(10);
  } else {
    S.aux0--;
    if (S.aux0 < 4) S.aux0 = 0;
  }
  return FRAMETIME;
}
function mode_bouncing_balls() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const lbt = data('lbt', Uint32Array, 16), iv = data('iv', Float32Array, 16), ht = data('ht', Float32Array, 16);
  if (!S.check2) fill(SEGCOLOR(2) ? BLACK : SEGCOLOR(1));
  const numBalls = ((S.intensity * 15) / 255 | 0) + 1;
  const g = -9.81, hasCol2 = SEGCOLOR(2) !== 0, time = NOW;
  if (S.call === 0) for (let i = 0; i < 16; i++) lbt[i] = time;
  for (let i = 0; i < numBalls; i++) {
    const tslb = Math.floor(((time - lbt[i]) >>> 0) / (((255 - S.speed) >> 6) + 1));
    const ts = Math.fround(tslb / 1000);
    ht[i] = (0.5 * g * ts + iv[i]) * ts;
    if (ht[i] <= 0) {
      ht[i] = 0;
      const damp = 0.9 - i / (numBalls * numBalls);
      iv[i] = damp * iv[i];
      lbt[i] = time;
      if (iv[i] < 0.015) iv[i] = Math.fround(Math.sqrt(-2 * g)) * random8r(5, 11) / 10;
    } else if (ht[i] > 1) continue;
    let color = SEGCOLOR(0);
    if (S.palette) color = color_wheel(i * ((256 / Math.max(numBalls, 8)) | 0));
    else if (hasCol2) color = SEGCOLOR(i % 3);
    setPixelColor(Math.round(ht[i] * (SEGLEN - 1)), color);
  }
  return FRAMETIME;
}
function sinelon_base(rainbow) {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  fade_out(S.intensity);
  const pos = beatsin16_t((S.speed / 10) | 0, 0, SEGLEN - 1);
  if (S.call === 0) S.aux0 = pos;
  let c1 = cfp(pos, true, false, 0);
  if (rainbow) c1 = color_wheel((pos & 7) * 32);
  setPixelColor(pos, c1);
  if (S.aux0 !== pos) {
    if (S.aux0 < pos) { for (let i = S.aux0; i < pos; i++) setPixelColor(i, c1); }
    else { for (let i = S.aux0; i > pos; i--) setPixelColor(i, c1); }
    S.aux0 = pos;
  }
  return FRAMETIME;
}
function mode_popcorn() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const usable = 21;
  const pos = data('pos', Float32Array, usable), vel = data('vel', Float32Array, usable), ci = data('ci', Uint8Array, usable);
  const hasCol2 = SEGCOLOR(2) !== 0;
  if (!S.check2) fill(hasCol2 ? BLACK : SEGCOLOR(1));
  let g = Math.fround(-0.0001 - S.speed / 200000); g = Math.fround(g * SEGLEN);
  let num = (S.intensity * usable / 255) | 0; if (num === 0) num = 1;
  for (let i = 0; i < num; i++) {
    if (pos[i] >= 0) { pos[i] += vel[i]; vel[i] += g; }
    else if (random8() < 2) {
      pos[i] = 0.01;
      let peak = 128 + random8l(128); peak = (peak * (SEGLEN - 1)) >> 8;
      vel[i] = Math.sqrt(-2 * g * peak);
      if (S.palette) ci[i] = random8();
      else { let c = random8r(0, 3); if (!SEGCOLOR(2) || !SEGCOLOR(c)) c = 0; ci[i] = c; }
    }
    if (pos[i] >= 0) {
      let c = color_wheel(ci[i]);
      if (!S.palette && ci[i] < 3) c = SEGCOLOR(ci[i]);
      const li = Math.trunc(pos[i]);
      if (li < SEGLEN) setPixelColor(li, c);
    }
  }
  return FRAMETIME;
}
function mode_drip() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const pos = data('pos', Float32Array, 4), vel = data('vel', Float32Array, 4), col = data('col', Uint16Array, 4), st = data('ci', Uint8Array, 4);
  if (!S.check2) fill(SEGCOLOR(1));
  const num = 1 + (S.intensity >> 6);
  let g = Math.fround(-0.0005 - S.speed / 50000); g = Math.fround(g * Math.max(1, SEGLEN - 1));
  const src = 12, c0 = SEGCOLOR(0);
  for (let j = 0; j < num; j++) {
    if (st[j] === 0) { pos[j] = SEGLEN - 1; vel[j] = 0; col[j] = src; st[j] = 1; }
    setPixelColor(SEGLEN - 1, color_blend(BLACK, c0, src));
    if (st[j] === 1) {
      if (col[j] > 255) col[j] = 255;
      setPixelColor(Math.trunc(pos[j]) & 0xFFFF, color_blend(BLACK, c0, col[j]));
      col[j] += map(S.speed, 0, 255, 1, 6);
      if (random8() < ((col[j] / 10) | 0)) { st[j] = 2; col[j] = 255; }
    }
    if (st[j] > 1) {
      if (pos[j] > 0) {
        pos[j] += vel[j];
        if (pos[j] < 0) pos[j] = 0;
        vel[j] += g;
        for (let i = 1; i < 7 - st[j]; i++) {
          const p = constrain((Math.trunc(pos[j]) & 0xFFFF) + i, 0, SEGLEN - 1);
          setPixelColor(p, color_blend(BLACK, c0, (col[j] / i) | 0));
        }
        if (st[j] > 2) setPixelColor(0, color_blend(c0, BLACK, col[j]));
      } else if (st[j] > 2) { st[j] = 0; col[j] = src; }
      else {
        if (st[j] === 2) { vel[j] = -vel[j] / 4; pos[j] += vel[j]; }
        col[j] = src * 2; st[j] = 5;
      }
    }
  }
  return FRAMETIME;
}
function mode_plasma() {
  const S = SEG;
  if (S.call === 0) S.aux0 = random8r(0, 2);
  const thisPhase = beatsin8_t(6 + S.aux0, -64, 64), thatPhase = beatsin8_t(7 + S.aux0, -64, 64);
  const k1 = 2 + 3 * (S.speed >> 5), k2 = 1 + 2 * (S.speed >> 5);
  const sub = beatsin8_t(7, 0, 128 - (S.intensity >> 1));
  for (let i = 0; i < SEGLEN; i++) {
    const ci = (cubicwave8((i * k1 + thisPhase) & 0xFF) >> 1) + (cos8_t((i * k2 + thatPhase) & 0xFF) >> 1);
    setPixelColor(i, cfp(ci, false, PSW(), 0, qsub8(ci, sub)));
  }
  return FRAMETIME;
}
function mode_heartbeat() {
  const S = SEG;
  const bpm = 40 + (S.speed >> 3);
  const msPerBeat = (60000 / bpm) | 0, second = (msPerBeat / 3) | 0;
  let bl = S.aux1;
  const timer = (NOW - S.step) >>> 0;
  bl = ((bl * 2042) / (2048 + S.intensity)) | 0;
  S.aux1 = bl & 0xFFFF;
  if (timer > second && !S.aux0) { S.aux1 = 0xFFFF; S.aux0 = 1; }
  if (timer > msPerBeat) { S.aux1 = 0xFFFF; S.aux0 = 0; S.step = NOW; }
  const bg = SEGCOLOR(1), a = 255 - (S.aux1 >> 8);
  for (let i = 0; i < SEGLEN; i++) setPixelColor(i, color_blend(cfp(i, true, PSW(), 0), bg, a));
  return FRAMETIME;
}
const PAC1 = new Uint8Array(48), PAC2 = new Uint8Array(48), PAC3 = new Uint8Array(48);
palFromColors(PAC1, [0x000507,0x000409,0x00030B,0x00030D,0x000210,0x000212,0x000114,0x000117,0x000019,0x00001C,0x000026,0x000031,0x00003B,0x000046,0x14554B,0x28AA50]);
palFromColors(PAC2, [0x000507,0x000409,0x00030B,0x00030D,0x000210,0x000212,0x000114,0x000117,0x000019,0x00001C,0x000026,0x000031,0x00003B,0x000046,0x0C5F52,0x19BE5F]);
palFromColors(PAC3, [0x000208,0x00030E,0x000514,0x00061A,0x000820,0x000927,0x000B2D,0x000C33,0x000E39,0x001040,0x001450,0x001860,0x001C70,0x002080,0x1040BF,0x2060FF]);
function pacifica_layer(i, p, cistart, wavescale, bri, ioff) {
  const wsh = ((wavescale & 0xFFFF) >> 1) + 20;
  const wa = (ioff + (120 + SEG.intensity) * i) & 0xFFFF;
  const s16 = SIN16[wa] + 32768;
  const cs = scale16(s16, wsh) + wsh;
  const ci = (cistart + cs * i) & 0xFFFF;
  const si16 = SIN16[ci] + 32768;
  return CFP(p, scale16(si16, 240), bri, 1);
}
function mode_pacifica() {
  const S = SEG;
  let p1 = PAC1, p2 = PAC2, p3 = PAC3;
  if (S.palette) { p1 = S.pal; p2 = S.pal; p3 = S.pal; }
  let s1 = S.aux0, s2 = S.aux1, s3 = S.step & 0xFFFF, s4 = S.step >>> 16;
  const dms = (FRAMETIME >> 2) + ((FRAMETIME * S.speed) >> 7);
  const sf1 = beatsin16_t(3, 179, 269), sf2 = beatsin16_t(4, 179, 269);
  const d1 = Math.floor(dms * sf1 / 256), d2 = Math.floor(dms * sf2 / 256), d21 = Math.floor((d1 + d2) / 2);
  s1 = (s1 + d1 * beatsin88_t(1011, 10, 13)) >>> 0;
  s2 = (s2 - d21 * beatsin88_t(777, 8, 11)) >>> 0;
  s3 = (s3 - d1 * beatsin88_t(501, 5, 7)) >>> 0;
  s4 = (s4 - d2 * beatsin88_t(257, 4, 6)) >>> 0;
  S.aux0 = s1 & 0xFFFF; S.aux1 = s2 & 0xFFFF;
  S.step = (((s4 << 16) | (s3 & 0xFFFF)) >>> 0);
  s1 &= 0xFFFF; s2 &= 0xFFFF; s3 &= 0xFFFF; s4 &= 0xFFFF;
  const basethr = beatsin8_t(9, 55, 65);
  let wave = beat8(7);
  const ws1 = beatsin16_t(3, 11 * 256, 14 * 256), b1 = beatsin8_t(10, 70, 130), o1 = (0 - beat16(301)) & 0xFFFF;
  const ws2 = beatsin16_t(4, 6 * 256, 9 * 256), b2 = beatsin8_t(17, 40, 80), o2 = beat16(401);
  const b3 = beatsin8_t(9, 10, 38), o3 = (0 - beat16(503)) & 0xFFFF;
  const b4 = beatsin8_t(8, 10, 28), o4 = beat16(601);
  for (let i = 0; i < SEGLEN; i++) {
    let c = 0x02060A;
    c = qaddC(c, pacifica_layer(i, p1, s1, ws1, b1, o1));
    c = qaddC(c, pacifica_layer(i, p2, s2, ws2, b2, o2));
    c = qaddC(c, pacifica_layer(i, p3, s3, 6 * 256, b3, o3));
    c = qaddC(c, pacifica_layer(i, p3, s4, 5 * 256, b4, o4));
    const thr = scale8(sin8_t(wave), 20) + basethr;
    wave = (wave + 7) & 255;
    const l = avgLight(c);
    if (l > thr) { const ov = l - thr, ov2 = qadd8(ov, ov); c = qaddC(c, RGB(ov, ov2, qadd8(ov2, ov2))); }
    c = (c & 0xFF0000) | (scale8((c >> 8) & 255, 200) << 8) | scale8(c & 255, 145);
    c = maxC(c, 0x020507);
    setPixelColor(i, c);
  }
  return FRAMETIME;
}
function mode_sunrise() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  if (S.call === 0 || S.speed !== S.aux0) { S.step = MILLIS; S.aux0 = S.speed; }
  fill(BLACK);
  let stage = 0xFFFF;
  let s10 = Math.floor(((MILLIS - S.step) >>> 0) / 100);
  if (S.speed > 120) {
    const counter = mul32(NOW >>> 1, ((S.speed - 120) >> 1) + 1);
    stage = triwave16(counter);
  } else if (S.speed) {
    let dur = S.speed; if (dur > 60) dur -= 60;
    const tgt = dur * 600;
    if (s10 > tgt) s10 = tgt;
    stage = map(s10, 0, tgt, 0, 0xFFFF);
    if (S.speed > 60) stage = 0xFFFF - stage;
  }
  for (let i = 0; i <= (SEGLEN >> 1); i++) {
    let wave = triwave16(Math.floor(i * stage / SEGLEN));
    wave = (wave >> 8) + ((wave * S.intensity) >> 15);
    const c = wave > 240 ? cfp(240, false, true, 255) : cfp(wave, false, true, 255);
    setPixelColor(i, c);
    setPixelColor(SEGLEN - i - 1, c);
  }
  return FRAMETIME;
}
function mode_twinkleup() {
  const S = SEG;
  const prev = SEED;
  SEED = 535;
  const bg = SEGCOLOR(1);
  const tq = Math.floor(mul32(16, NOW) / (256 - S.speed)), t100 = Math.floor(NOW / 100);
  for (let i = 0; i < SEGLEN; i++) {
    const ranstart = random8();
    let pb = sin8_t(ranstart + tq);
    if (random8() > S.intensity) pb = 0;
    setPixelColor(i, color_blend(bg, cfp(random8() + t100, false, PSW(), 0), pb));
  }
  SEED = prev;
  return FRAMETIME;
}
const HSV4 = new Array(12);
function mode_noisepal() {
  const S = SEG;
  const scale = 15 + (S.intensity >> 2);
  const pal0 = data('p0', Uint8Array, 48), pal1 = data('p1', Uint8Array, 48);
  const change = 4000 + S.speed * 10;
  if (((NOW - S.step) >>> 0) > change) {
    S.step = NOW;
    const base = random8();
    HSV4[0] = (base + random8l(64)) & 255; HSV4[1] = 255; HSV4[2] = random8r(128, 255);
    HSV4[3] = (base + 128) & 255; HSV4[4] = 255; HSV4[5] = random8r(128, 255);
    HSV4[6] = (base + random8l(92)) & 255; HSV4[7] = 192; HSV4[8] = random8r(128, 255);
    HSV4[9] = (base + random8l(92)) & 255; HSV4[10] = 255; HSV4[11] = random8r(128, 255);
    palFromHSV4(pal1, HSV4);
  }
  nblendPaletteTowardPalette(pal0, pal1, 48);
  if (S.palette > 0) pal0.set(S.pal);
  for (let i = 0; i < SEGLEN; i++) {
    const index = inoise8_2(i * scale, S.aux0 + i * scale);
    setPixelColor(i, CFP(pal0, index, 255, 1));
  }
  S.aux0 = (S.aux0 + beatsin8_t(10, 1, 4)) & 0xFFFF;
  return FRAMETIME;
}
function mode_flow() {
  const S = SEG;
  let counter = 0;
  if (S.speed !== 0) counter = mul32(NOW, (S.speed >> 2) + 1) >>> 8;
  const maxZones = (SEGLEN / 6) | 0;
  let zones = (S.intensity * maxZones) >> 8;
  if (zones & 1) zones++;
  if (zones < 2) zones = 2;
  const zl = (SEGLEN / zones) | 0, offset = (SEGLEN - zones * zl) >> 1;
  fill(cfp(-counter, false, true, 255));
  for (let z = 0; z < zones; z++) {
    const pos = offset + z * zl;
    for (let i = 0; i < zl; i++) {
      const ci = ((i * 255 / zl) | 0) - counter;
      let led = (z & 1) ? i : (zl - 1) - i;
      if (S.reverse) led = (zl - 1) - led;
      setPixelColor(pos + led, cfp(ci, false, true, 255));
    }
  }
  return FRAMETIME;
}
function mode_dancing_shadows() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const num = map(S.intensity, 0, 255, 2, 49);
  const init = S.aux0 !== num;
  S.aux0 = num;
  const spd = data('spd', Float32Array, num), cidx = data('cidx', Uint8Array, num), pos = data('pos', Int16Array, num),
        lut = data('lut', Uint32Array, num), wid = data('wid', Uint8Array, num), typ = data('typ', Uint8Array, num);
  fill(BLACK);
  const time = NOW;
  let respawn = false;
  for (let i = 0; i < num; i++) {
    if (!init) {
      const delta = Math.trunc(((time - lut[i]) >>> 0) * (spd[i] * ((1.0 + S.speed) / 100.0)));
      if (Math.abs(delta) >= 1) { pos[i] += delta; lut[i] = time; }
      respawn = (spd[i] > 0 && pos[i] > SEGLEN + 2) || (spd[i] < 0 && pos[i] < -(wid[i] + 2));
    }
    if (init || respawn) {
      cidx[i] = random8();
      wid[i] = random8r(1, 10);
      spd[i] = 1.0 / random8r(4, 50);
      if (init) { pos[i] = random16l(SEGLEN); spd[i] *= random8l(2) ? 1 : -1; }
      else if (random8l(2)) { pos[i] = SEGLEN + wid[i]; spd[i] *= -1; }
      else pos[i] = -wid[i];
      lut[i] = time;
      typ[i] = random8l(6);
    }
    const color = cfp(cidx[i], false, false, 255);
    const start = pos[i], w = wid[i];
    if (w <= 1) { if (start >= 0 && start < SEGLEN) blendPixelColor(start, color, 128); }
    else {
      const t = typ[i];
      const stepJ = t === 3 ? 2 : t === 4 ? 3 : t === 5 ? 4 : 1;
      for (let j = 0; j < w; j += stepJ) {
        const p = start + j;
        if (p < 0 || p >= SEGLEN) continue;
        let b = 128;
        if (t === 1) b = cubicwave8(map(j, 0, w - 1, 0, 255) & 255);
        else if (t === 2) b = cubicwave8((2 * map(j, 0, w - 1, 0, 255)) & 255);
        blendPixelColor(p, color, b);
      }
    }
  }
  return FRAMETIME;
}
function mode_blends() {
  const S = SEG;
  const pl = SEGLEN > 255 ? 255 : SEGLEN;
  const px = data('px', Int32Array, pl + 1);
  const bs = map(S.intensity, 0, 255, 10, 128);
  let shift = mul32(NOW, (S.speed >> 3) + 1) >>> 8;
  for (let i = 0; i < pl; i++) {
    px[i] = color_blend(px[i], cfp(shift + quadwave8(((i + 1) * 16) & 255), false, PSW(), 255), bs);
    shift += 3;
  }
  let off = 0;
  for (let i = 0; i < SEGLEN; i++) { setPixelColor(i, px[off++]); if (off > pl) off = 0; }
  return FRAMETIME;
}
function mode_dynamic_smooth() {
  const S = SEG;
  const d = data('dyn', Uint8Array, SEGLEN);
  if (S.call === 0) for (let i = 0; i < SEGLEN; i++) d[i] = random8();
  const cycle = 50 + (255 - S.speed) * 15, it = Math.floor(NOW / cycle);
  if (it !== S.step && S.speed !== 0) {
    for (let i = 0; i < SEGLEN; i++) if (random8() <= S.intensity) d[i] = random8();
    S.step = it;
  }
  for (let i = 0; i < SEGLEN; i++) blendPixelColor(i, color_wheel(d[i]), 16);   // check1 forced true
  return FRAMETIME;
}
function mode_perlinmove() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  fade_out(255 - S.custom1);
  const t = Math.floor(mul32(NOW, 128) / (260 - S.speed));
  for (let i = 0; i < ((S.intensity / 16) | 0) + 1; i++) {
    const locn = inoise16_2((t + i * 15000) >>> 0, t);
    const pixloc = map(locn, 50 * 256, 192 * 256, 0, SEGLEN - 1);
    if (pixloc < 0) continue;   // unsigned wrap → setPixelColor() ignores
    setPixelColor(pixloc, cfp(pixloc % 255, false, PSW(), 0));
  }
  return FRAMETIME;
}
// ---- audio reactive (data supplied by app in P.audio, or WLED's simulateSound(UMS_BeatSin))
function mode_gravcenter() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const gc = data('gc', Int32Array, 2);
  const vol = AUD.volumeSmth;
  fade_out(251);
  let ssa = Math.fround(vol * S.intensity / 255); ssa = Math.fround(ssa * 0.125);
  const msa = mapf(ssa * 2, 0, 32, 0, SEGLEN / 2);
  const temps = Math.trunc(constrain(msa, 0, (SEGLEN / 2) | 0));
  const grav = 8 - (S.speed >> 5);
  const half = SEGLEN >> 1, bg = SEGCOLOR(1), bl = Math.trunc(ssa * 8);
  for (let i = 0; i < temps; i++) {
    const index = inoise8_2(Math.trunc(Math.fround(i * ssa + NOW)), Math.trunc(Math.fround(5000 + i * ssa)));
    const c = color_blend(bg, cfp(index, false, PSW(), 0), bl);
    setPixelColor(i + half, c);
    setPixelColor(half - i - 1, c);
  }
  if (temps >= gc[0]) gc[0] = temps - 1;
  else if (gc[1] % grav === 0) gc[0]--;
  if (gc[0] >= 0) {
    const c = cfp(NOW, false, PSW(), 0);
    setPixelColor(gc[0] + half, c);
    setPixelColor(half - 1 - gc[0], c);
  }
  gc[1] = (gc[1] + 1) % grav;
  return FRAMETIME;
}
function mode_DJLight() {
  const S = SEG;
  const mid = SEGLEN >> 1, fft = AUD.fft;
  if (S.call === 0) fill(BLACK);
  const sh = (Math.floor(Math.floor(MICROS / (256 - S.speed)) / 500) + 1) & 255;
  if (S.aux0 !== sh) {
    S.aux0 = sh;
    const c = RGB(fft[15] >> 1, fft[5] >> 1, fft[0] >> 1);
    setPixelColor(mid, nscale8(c, 255 - (map(fft[4], 0, 255, 255, 4) & 255)));
    for (let i = SEGLEN - 1; i > mid; i--) setPixelColor(i, getPixelColor(i - 1));
    for (let i = 0; i < mid; i++) setPixelColor(i, getPixelColor(i + 1));
  }
  return FRAMETIME;
}
const NOISEFIRE_PAL = palFromColors(new Uint8Array(48), [hsv2rgb(0, 255, 2), hsv2rgb(0, 255, 4), hsv2rgb(0, 255, 8), hsv2rgb(0, 255, 8),
  hsv2rgb(0, 255, 16), 0xFF0000, 0xFF0000, 0xFF0000, 0xFF8C00, 0xFF8C00, 0xFFA500, 0xFFA500, 0xFFFF00, 0xFFA500, 0xFFFF00, 0xFFFF00]);
function mode_noisefire() {
  const S = SEG;
  const vol = AUD.volumeSmth;
  if (S.call === 0) fill(BLACK);
  const y = Math.floor(Math.floor(Math.floor(mul32(NOW, S.speed) / 64) * SEGLEN) / 255);
  const bri = Math.trunc(vol * 2) & 255;
  for (let i = 0; i < SEGLEN; i++) {
    let index = inoise8_2((i * S.speed / 64) | 0, y);
    index = ((255 - ((i * 256 / SEGLEN) | 0)) * index / (256 - S.intensity)) | 0;
    setPixelColor(i, CFP(NOISEFIRE_PAL, index, bri, 1));
  }
  return FRAMETIME;
}
function mode_waterfall() {
  const S = SEG;
  const px = data('px', Int32Array, SEGLEN);
  let peak = AUD.majorPeak; if (peak < 1) peak = 1;
  const mag = Math.trunc(AUD.magnitude / 8) & 255;
  if (S.call === 0) { px.fill(0); S.aux0 = 255; }
  const sh = (Math.floor(Math.floor(MICROS / (256 - S.speed)) / 500) + 1) & 255;
  if (S.aux0 !== sh) {
    S.aux0 = sh;
    let pixCol = Math.trunc((Math.log10(peak) - 2.26) * 150) & 255;
    if (peak < 182) pixCol = 0;
    const k = SEGLEN - 1;
    if (AUD.samplePeak) px[k] = hsv2rgb(92, 92, 92);
    else px[k] = color_blend(SEGCOLOR(1), cfp(pixCol + S.intensity, false, PSW(), 0), mag);
    setPixelColor(k, px[k]);
    for (let i = 0; i < k; i++) { px[i] = px[i + 1]; setPixelColor(i, px[i]); }
  }
  return FRAMETIME;
}
function mode_freqwave() {
  const S = SEG;
  let peak = AUD.majorPeak; const vol = AUD.volumeSmth;
  if (S.call === 0) fill(BLACK);
  const sh = Math.floor(Math.floor(MICROS / (256 - S.speed)) / 500) % 16;
  if (S.aux0 !== sh) {
    S.aux0 = sh;
    const sens = mapf(S.custom3, 1, 31, 1, 10);
    const pixVal = Math.min(255, vol * S.intensity / 256 * sens);
    const inten = mapf(pixVal, 0, 255, 0, 100) / 100;
    let color = 0;
    if (peak > 11025) peak = 1;
    if (peak >= 80) {
      const up = 80 + 42 * S.custom2, lo = 80 + 3 * S.custom1;
      const i = (lo !== up ? map(Math.trunc(peak), lo, up, 0, 255) : Math.trunc(peak)) & 255;
      const b = Math.min(255, 255 * inten);
      color = hsv2rgb(i, 240, Math.trunc(b) & 255);
    }
    const h = SEGLEN >> 1;
    setPixelColor(h, color);
    for (let i = SEGLEN - 1; i > h; i--) setPixelColor(i, getPixelColor(i - 1));
    for (let i = 0; i < h; i++) setPixelColor(i, getPixelColor(i + 1));
  }
  return FRAMETIME;
}
// raw gamma8 table (always table, independent of gammaCorrectCol)
const GAMMA_RAW = GAMMA;

// =====================================================================================================================
// effect registry   tb = output depends only on strip.now (+params) → evaluate once per render
// ===== WLED effects, port batch A =====
// =====================================================================================================================
// batch A — WLED FX.cpp ports: 1 Blink, 3 Wipe, 4 Wipe Random, 5 Random Colors, 6 Sweep, 7 Dynamic, 8 Colorloop,
// 9 Rainbow, 10 Scan, 11 Scan Dual, 13 Theater, 14 Theater Rainbow, 16 Saw, 18 Dissolve, 19 Dissolve Rnd,
// 21 Sparkle Dark, 23 Strobe, 24 Strobe Rainbow, 25 Strobe Mega, 26 Blink Rainbow, 27 Android, 28 Chase,
// 29 Chase Random, 30 Chase Rainbow, 31 Chase Flash, 32 Chase Flash Rnd
// SEGENV mapping: step = uint32 (>>> 0), aux0/aux1 = uint16 (& 0xFFFF), call = uint32.
// =====================================================================================================================

// util.cpp get_random_wheel_index(uint8_t pos)
function bA_get_random_wheel_index(pos) {
  pos &= 255;
  let r = 0, x = 0, y = 0, d = 0;
  while (d < 42) {
    r = random8();
    x = Math.abs(pos - r) & 255;
    y = (255 - x) & 255;
    d = x < y ? x : y;
  }
  return r;
}

// ---- blink(color1, color2, strobe, do_palette)
function bA_blink(color1, color2, strobe, do_palette) {
  const S = SEG;
  let cycleTime = ((255 - S.speed) * 20) >>> 0;
  let onTime = FRAMETIME >>> 0;
  if (!strobe) onTime = (onTime + ((cycleTime * S.intensity) >>> 8)) >>> 0;
  cycleTime = (cycleTime + FRAMETIME * 2) >>> 0;
  const it = Math.floor(NOW / cycleTime) >>> 0;
  const rem = (NOW % cycleTime) >>> 0;
  let on = false;
  if (it !== S.step || rem <= onTime) on = true;
  S.step = it;
  const color = on ? color1 : color2;
  if (color === color1 && do_palette) {
    for (let i = 0; i < SEGLEN; i++) setPixelColor(i, cfp(i, true, PSW(), 0));
  } else fill(color);
  return FRAMETIME;
}
function mode_blink() { return bA_blink(SEGCOLOR(0), SEGCOLOR(1), false, true); }
function mode_blink_rainbow() { return bA_blink(color_wheel(SEG.call & 0xFF), SEGCOLOR(1), false, false); }
function mode_strobe() { return bA_blink(SEGCOLOR(0), SEGCOLOR(1), true, true); }
function mode_strobe_rainbow() { return bA_blink(color_wheel(SEG.call & 0xFF), SEGCOLOR(1), true, false); }

// ---- color_wipe(rev, useRandomColors)
function bA_color_wipe(rev, useRandomColors) {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const cycleTime = 750 + (255 - S.speed) * 150;
  const perc = (NOW % cycleTime) >>> 0;
  let prog = Math.floor(perc * 65535 / cycleTime) >>> 0;
  const back = prog > 32767;
  if (back) {
    prog = (prog - 32767) >>> 0;
    if (S.step === 0) S.step = 1;
  } else {
    if (S.step === 2) S.step = 3;   // trigger color change
  }
  if (useRandomColors) {
    if (S.call === 0) { S.aux0 = random8(); S.step = 3; }
    if (S.step === 1) { S.aux1 = bA_get_random_wheel_index(S.aux0); S.step = 2; }
    if (S.step === 3) { S.aux0 = bA_get_random_wheel_index(S.aux1); S.step = 0; }
  }
  const ledIndex = (prog * SEGLEN) >>> 15;
  let rem = ((prog * SEGLEN) * 2) & 0xFFFF;   // uint16_t: mod 0xFFFF by truncating
  rem = (rem / (S.intensity + 1)) | 0;
  if (rem > 255) rem = 255;
  const col1 = useRandomColors ? color_wheel(S.aux1) : SEGCOLOR(1);
  for (let i = 0; i < SEGLEN; i++) {
    const index = (rev && back) ? SEGLEN - 1 - i : i;
    const col0 = useRandomColors ? color_wheel(S.aux0) : cfp(index, true, PSW(), 0);
    if (i < ledIndex) {
      setPixelColor(index, back ? col1 : col0);
    } else {
      setPixelColor(index, back ? col0 : col1);
      if (i === ledIndex) setPixelColor(index, color_blend(back ? col0 : col1, back ? col1 : col0, rem));
    }
  }
  return FRAMETIME;
}
function mode_color_wipe() { return bA_color_wipe(false, false); }
function mode_color_sweep() { return bA_color_wipe(true, false); }
function mode_color_wipe_random() { return bA_color_wipe(false, true); }

// ---- 5 Random Colors
function mode_random_color() {
  const S = SEG;
  const cycleTime = 200 + (255 - S.speed) * 50;
  const it = Math.floor(NOW / cycleTime) >>> 0;
  const rem = (NOW % cycleTime) >>> 0;
  const fadedur = (cycleTime * S.intensity) >>> 8;
  let fade = 255;
  if (fadedur) {
    fade = Math.floor(rem * 255 / fadedur) >>> 0;
    if (fade > 255) fade = 255;
  }
  if (S.call === 0) { S.aux0 = random8(); S.step = 2; }
  if (it !== S.step) {
    S.aux1 = S.aux0;
    S.aux0 = bA_get_random_wheel_index(S.aux0);
    S.step = it;
  }
  fill(color_blend(color_wheel(S.aux1), color_wheel(S.aux0), fade));
  return FRAMETIME;
}

// ---- 7 Dynamic
function mode_dynamic() {
  const S = SEG;
  const d = data('bA_dyn', Uint8Array, SEGLEN);
  if (S.call === 0) for (let i = 0; i < SEGLEN; i++) d[i] = random8();
  const cycleTime = 50 + (255 - S.speed) * 15;
  const it = Math.floor(NOW / cycleTime) >>> 0;
  if (it !== S.step && S.speed !== 0) {
    for (let i = 0; i < SEGLEN; i++) if (random8() <= S.intensity) d[i] = random8();
    S.step = it;
  }
  if (S.check1) { for (let i = 0; i < SEGLEN; i++) blendPixelColor(i, color_wheel(d[i]), 16); }
  else { for (let i = 0; i < SEGLEN; i++) setPixelColor(i, color_wheel(d[i])); }
  return FRAMETIME;
}

// ---- 10/11 Scan
function bA_scan(dual) {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const cycleTime = 750 + (255 - S.speed) * 150;
  const perc = (NOW % cycleTime) >>> 0;
  const prog = Math.floor(perc * 65535 / cycleTime) | 0;
  const size = 1 + ((S.intensity * SEGLEN) >> 9);
  const ledIndex = Math.imul(prog, (SEGLEN * 2) - size * 2) >> 16;
  if (!S.check2) fill(SEGCOLOR(1));
  let led_offset = ledIndex - (SEGLEN - size);
  led_offset = Math.abs(led_offset);
  if (dual) {
    for (let j = led_offset; j < led_offset + size; j++) {
      const i2 = SEGLEN - 1 - j;   // j <= SEGLEN-1 always, so the C++ unsigned never wraps
      setPixelColor(i2, cfp(i2, true, PSW(), SEGCOLOR(2) ? 2 : 0));
    }
  }
  for (let j = led_offset; j < led_offset + size; j++) setPixelColor(j, cfp(j, true, PSW(), 0));
  return FRAMETIME;
}
function mode_scan() { return bA_scan(false); }
function mode_dual_scan() { return bA_scan(true); }

// ---- 8 Colorloop (mode_rainbow), 9 Rainbow (mode_rainbow_cycle)
function mode_rainbow() {
  const S = SEG;
  let counter = mul32(NOW, (S.speed >> 2) + 2) & 0xFFFF;
  counter = counter >> 8;
  if (S.intensity < 128) fill(color_blend(color_wheel(counter), WHITE, 128 - S.intensity));
  else fill(color_wheel(counter));
  return FRAMETIME;
}
function mode_rainbow_cycle() {
  const S = SEG;
  let counter = mul32(NOW, (S.speed >> 2) + 2) & 0xFFFF;
  counter = counter >> 8;
  const mul = 16 << ((S.intensity / 29) | 0);
  for (let i = 0; i < SEGLEN; i++) {
    const index = ((((i * mul) / SEGLEN) | 0) + counter) & 255;
    setPixelColor(i, color_wheel(index));
  }
  return FRAMETIME;
}

// ---- running(color1, color2, theatre) — 13 Theater, 14 Theater Rainbow
function bA_running(color1, color2, theatre) {
  const S = SEG;
  const width = (theatre ? 3 : 1) + (S.intensity >> 4);
  const cycleTime = 50 + (255 - S.speed);
  const it = Math.floor(NOW / cycleTime) >>> 0;
  const usePalette = color1 === SEGCOLOR(0);
  for (let i = 0; i < SEGLEN; i++) {
    let col = color2;
    if (usePalette) color1 = cfp(i, true, PSW(), 0);
    if (theatre) {
      if ((i % width) === S.aux0) col = color1;
    } else {
      const pos = i % (width << 1);
      if ((pos < S.aux0 - width) || ((pos >= S.aux0) && (pos < S.aux0 + width))) col = color1;
    }
    setPixelColor(i, col);
  }
  if (it !== S.step) {
    S.aux0 = ((S.aux0 + 1) % (theatre ? width : (width << 1))) & 0xFFFF;
    S.step = it;
  }
  return FRAMETIME;
}
function mode_theater_chase() { return bA_running(SEGCOLOR(0), SEGCOLOR(1), true); }
function mode_theater_chase_rainbow() { return bA_running(color_wheel(SEG.step & 0xFF), SEGCOLOR(1), true); }

// ---- 16 Saw (running_base(saw=true))
function mode_saw() {
  const S = SEG;
  const x_scale = S.intensity >> 2;
  const counter = mul32(NOW, S.speed) >>> 9;
  const bg = SEGCOLOR(1);
  for (let i = 0; i < SEGLEN; i++) {
    let a = (i * x_scale - counter) >>> 0;
    a &= 0xFF;
    if (a < 16) a = 192 + a * 8;
    else a = map(a, 16, 255, 64, 192);
    a = (255 - a) >>> 0;
    const s = sin8_t(a & 255);
    setPixelColor(i, color_blend(bg, cfp(i, true, PSW(), 0), s));
  }
  return FRAMETIME;
}

// ---- dissolve(color) — 18 Dissolve, 19 Dissolve Rnd
function bA_dissolve(color) {
  const S = SEG;
  const pixels = data('bA_dis', Int32Array, SEGLEN);
  if (S.call === 0) {
    for (let i = 0; i < SEGLEN; i++) pixels[i] = SEGCOLOR(1);
    S.aux0 = 1;
  }
  const jm = (SEGLEN / 15) | 0;
  for (let j = 0; j <= jm; j++) {
    if (random8() <= S.intensity) {
      for (let times = 0; times < 10; times++) {
        const i = random16l(SEGLEN);
        if (S.aux0) {
          if (pixels[i] === SEGCOLOR(1)) {
            pixels[i] = color === SEGCOLOR(0) ? cfp(i, true, PSW(), 0) : color;
            break;
          }
        } else {
          if (pixels[i] !== SEGCOLOR(1)) { pixels[i] = SEGCOLOR(1); break; }
        }
      }
    }
  }
  for (let i = 0; i < SEGLEN; i++) setPixelColor(i, pixels[i]);
  if (S.step > (255 - S.speed) + 15) {
    S.aux0 = S.aux0 ? 0 : 1;
    S.step = 0;
  } else {
    S.step = (S.step + 1) >>> 0;
  }
  return FRAMETIME;
}
function mode_dissolve() { return bA_dissolve(SEG.check1 ? color_wheel(random8()) : SEGCOLOR(0)); }
function mode_dissolve_random() { return bA_dissolve(color_wheel(random8())); }

// ---- 21 Sparkle Dark
function mode_flash_sparkle() {
  const S = SEG;
  if (!S.check2) for (let i = 0; i < SEGLEN; i++) setPixelColor(i, cfp(i, true, PSW(), 0));
  if (((NOW - S.aux0) >>> 0) > S.step) {
    if (random8l((255 - S.intensity) >> 4) === 0) setPixelColor(random16l(SEGLEN), SEGCOLOR(1));
    S.step = NOW >>> 0;
    S.aux0 = 255 - S.speed;
  }
  return FRAMETIME;
}

// ---- 25 Strobe Mega
function mode_multi_strobe() {
  const S = SEG;
  for (let i = 0; i < SEGLEN; i++) setPixelColor(i, cfp(i, true, PSW(), 1));
  S.aux0 = (50 + 20 * (255 - S.speed)) & 0xFFFF;
  const count = 2 * (((S.intensity / 10) | 0) + 1);
  if (S.aux1 < count) {
    if ((S.aux1 & 1) === 0) { fill(SEGCOLOR(0)); S.aux0 = 15; }
    else S.aux0 = 50;
  }
  if (((NOW - S.aux0) >>> 0) > S.step) {
    S.aux1 = (S.aux1 + 1) & 0xFFFF;
    if (S.aux1 > count) S.aux1 = 0;
    S.step = NOW >>> 0;
  }
  return FRAMETIME;
}

// ---- 27 Android
function mode_android() {
  const S = SEG;
  for (let i = 0; i < SEGLEN; i++) setPixelColor(i, cfp(i, true, PSW(), 1));
  if (S.aux1 > (((S.intensity * SEGLEN) / 255) | 0)) S.aux0 = 1;
  else if (S.aux1 < 2) S.aux0 = 0;
  let a = S.step & 0xFFFF;
  if (S.aux0 === 0) {
    if (S.call % 3 === 1) a++;
    else S.aux1 = (S.aux1 + 1) & 0xFFFF;
  } else {
    a++;
    if (S.call % 3 !== 1) S.aux1 = (S.aux1 - 1) & 0xFFFF;
  }
  if (a >= SEGLEN) a = 0;
  const c0 = SEGCOLOR(0);
  if (a + S.aux1 < SEGLEN) {
    for (let i = a; i < a + S.aux1; i++) setPixelColor(i, c0);
  } else {
    for (let i = a; i < SEGLEN; i++) setPixelColor(i, c0);
    const end = (S.aux1 - (SEGLEN - a)) >>> 0;
    for (let i = 0; i < end; i++) { if (i >= 0x10000) break; setPixelColor(i, c0); }   // i beyond 0xFFFF: all out of range anyway
  }
  S.step = a >>> 0;
  return 3 + (((8 * (255 - S.speed)) / SEGLEN) | 0);
}

// ---- chase(color1, color2, color3, do_palette) — 28/29/30 (engine's chase() is the reduced variant used by id 33)
function bA_chase(color1, color2, color3, do_palette) {
  const S = SEG;
  const counter = mul32(NOW, (S.speed >> 2) + 1) & 0xFFFF;
  const a = ((counter * SEGLEN) >>> 16) & 0xFFFF;
  const chase_random = S.mode === 29;   // FX_MODE_CHASE_RANDOM
  if (chase_random) {
    if (a < S.step) {
      S.aux1 = S.aux0;
      S.aux0 = bA_get_random_wheel_index(S.aux0);
    }
    color1 = color_wheel(S.aux0);
  }
  S.step = a;
  const size = 1 + ((S.intensity * SEGLEN) >> 10);
  let b = (a + size) & 0xFFFF; if (b > SEGLEN) b = (b - SEGLEN) & 0xFFFF;
  let c = (b + size) & 0xFFFF; if (c > SEGLEN) c = (c - SEGLEN) & 0xFFFF;
  if (do_palette) { for (let i = 0; i < SEGLEN; i++) setPixelColor(i, cfp(i, true, PSW(), 1)); }
  else fill(color1);
  if (chase_random) {
    color1 = color_wheel(S.aux1);
    for (let i = a; i < SEGLEN; i++) setPixelColor(i, color1);
  }
  if (a < b) { for (let i = a; i < b; i++) setPixelColor(i, color2); }
  else { for (let i = a; i < SEGLEN; i++) setPixelColor(i, color2); for (let i = 0; i < b; i++) setPixelColor(i, color2); }
  if (b < c) { for (let i = b; i < c; i++) setPixelColor(i, color3); }
  else { for (let i = b; i < SEGLEN; i++) setPixelColor(i, color3); for (let i = 0; i < c; i++) setPixelColor(i, color3); }
  return FRAMETIME;
}
function mode_chase_color() { return bA_chase(SEGCOLOR(1), SEGCOLOR(2) ? SEGCOLOR(2) : SEGCOLOR(0), SEGCOLOR(0), true); }
function mode_chase_random() { return bA_chase(SEGCOLOR(1), SEGCOLOR(2) ? SEGCOLOR(2) : SEGCOLOR(0), SEGCOLOR(0), false); }
function mode_chase_rainbow() {
  const S = SEG;
  let color_sep = (256 / SEGLEN) | 0;
  if (color_sep === 0) color_sep = 1;
  const color_index = S.call & 0xFF;
  const color = color_wheel(((mul32(S.step, color_sep) + color_index) >>> 0) & 0xFF);
  return bA_chase(color, SEGCOLOR(0), SEGCOLOR(1), false);
}

// ---- 31 Chase Flash, 32 Chase Flash Rnd
const bA_FLASH_COUNT = 4;
function mode_chase_flash() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const flash_step = S.call % ((bA_FLASH_COUNT * 2) + 1);
  for (let i = 0; i < SEGLEN; i++) setPixelColor(i, cfp(i, true, PSW(), 0));
  let delay = 10 + (((30 * (255 - S.speed)) / SEGLEN) | 0);
  if (flash_step < (bA_FLASH_COUNT * 2)) {
    if (flash_step % 2 === 0) {
      const n = S.step, m = (S.step + 1) % SEGLEN;
      setPixelColor(n, SEGCOLOR(1));
      setPixelColor(m, SEGCOLOR(1));
      delay = 20;
    } else delay = 30;
  } else {
    S.step = ((S.step + 1) % SEGLEN) >>> 0;
  }
  return delay;
}
function mode_chase_flash_random() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const flash_step = S.call % ((bA_FLASH_COUNT * 2) + 1);
  for (let i = 0; i < S.aux1; i++) setPixelColor(i, color_wheel(S.aux0));
  let delay = 1 + (((10 * (255 - S.speed)) / SEGLEN) | 0);
  if (flash_step < (bA_FLASH_COUNT * 2)) {
    const n = S.aux1, m = (S.aux1 + 1) % SEGLEN;
    if (flash_step % 2 === 0) {
      setPixelColor(n, SEGCOLOR(0));
      setPixelColor(m, SEGCOLOR(0));
      delay = 20;
    } else {
      setPixelColor(n, color_wheel(S.aux0));
      setPixelColor(m, SEGCOLOR(1));
      delay = 30;
    }
  } else {
    S.aux1 = ((S.aux1 + 1) % SEGLEN) & 0xFFFF;
    if (S.aux1 === 0) S.aux0 = bA_get_random_wheel_index(S.aux0);
  }
  return delay;
}

// ===== WLED effects, port batch B =====
// =====================================================================================================================
// batch B — WLED FX.cpp ports: 35 36 37 39 40 41 44 45 47 48 49 50 52 54 55 56 58 59 60 61 62
// (spliced verbatim into tlfx.js just before `const FX = {`)
// =====================================================================================================================

// ---- FX.cpp sin_gap()
function bB_sin_gap(inp) {
  inp &= 0xFFFF;
  if (inp & 0x100) return 0;
  return sin8_t((inp + 192) & 255);
}
// ---- util.cpp get_random_wheel_index()
function bB_get_random_wheel_index(pos) {
  pos &= 255;
  let r = 0, x = 0, y = 0, d = 0;
  while (d < 42) {
    r = random8();
    x = Math.abs(pos - r) & 255;
    y = (255 - x) & 255;
    d = Math.min(x, y);
  }
  return r;
}

// ---- color_wipe(rev, useRandomColors)
function bB_color_wipe(rev, useRandomColors) {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const cycleTime = 750 + (255 - S.speed) * 150;
  const perc = NOW % cycleTime;
  let prog = Math.floor((perc * 65535) / cycleTime);
  const back = prog > 32767;
  if (back) {
    prog -= 32767;
    if (S.step === 0) S.step = 1;
  } else {
    if (S.step === 2) S.step = 3;
  }
  if (useRandomColors) {
    if (S.call === 0) { S.aux0 = random8(); S.step = 3; }
    if (S.step === 1) { S.aux1 = bB_get_random_wheel_index(S.aux0); S.step = 2; }
    if (S.step === 3) { S.aux0 = bB_get_random_wheel_index(S.aux1); S.step = 0; }
  }
  const ledIndex = (prog * SEGLEN) >>> 15;
  let rem = ((prog * SEGLEN) * 2) & 0xFFFF;
  rem = (rem / (S.intensity + 1)) | 0;
  if (rem > 255) rem = 255;
  const col1 = useRandomColors ? color_wheel(S.aux1) : SEGCOLOR(1);
  for (let i = 0; i < SEGLEN; i++) {
    const index = (rev && back) ? SEGLEN - 1 - i : i;
    const col0 = useRandomColors ? color_wheel(S.aux0) : cfp(index, true, PSW(), 0);
    if (i < ledIndex) {
      setPixelColor(index, back ? col1 : col0);
    } else {
      setPixelColor(index, back ? col0 : col1);
      if (i === ledIndex) setPixelColor(index, color_blend(back ? col0 : col1, back ? col1 : col0, rem));
    }
  }
  return FRAMETIME;
}

// ---- running(color1, color2, theatre)
function bB_running(color1, color2, theatre) {
  const S = SEG;
  const width = (theatre ? 3 : 1) + (S.intensity >> 4);
  const cycleTime = 50 + (255 - S.speed);
  const it = Math.floor(NOW / cycleTime);
  const usePalette = color1 === SEGCOLOR(0);
  for (let i = 0; i < SEGLEN; i++) {
    let col = color2;
    if (usePalette) color1 = cfp(i, true, PSW(), 0);
    if (theatre) {
      if ((i % width) === S.aux0) col = color1;
    } else {
      const pos = i % (width << 1);
      if ((pos < S.aux0 - width) || ((pos >= S.aux0) && (pos < S.aux0 + width))) col = color1;
    }
    setPixelColor(i, col);
  }
  if (it !== S.step) {
    S.aux0 = ((S.aux0 + 1) % (theatre ? width : (width << 1))) & 0xFFFF;
    S.step = it >>> 0;
  }
  return FRAMETIME;
}

// ---- running_base(saw, dual)
function bB_running_base(saw, dual) {
  const S = SEG;
  const x_scale = S.intensity >> 2;
  const counter = mul32(NOW, S.speed) >>> 9;
  const bg = SEGCOLOR(1);
  for (let i = 0; i < SEGLEN; i++) {
    let a = (i * x_scale - counter) >>> 0;
    if (saw) {
      a &= 0xFF;
      if (a < 16) a = 192 + a * 8;
      else a = map(a, 16, 255, 64, 192);
      a = 255 - a;
    }
    const s = dual ? bB_sin_gap(a) : sin8_t(a);
    let ca = color_blend(bg, cfp(i, true, PSW(), 0), s);
    if (dual) {
      const b = ((SEGLEN - 1 - i) * x_scale - counter) >>> 0;
      const t = bB_sin_gap(b);
      const cb = color_blend(bg, cfp(i, true, PSW(), 2), t);
      ca = color_blend(ca, cb, 127);
    }
    setPixelColor(i, ca);
  }
  return FRAMETIME;
}

// ---- police_base(color1, color2)
function bB_police_base(color1, color2) {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const delay = 1 + (((FRAMETIME << 3) / SEGLEN) | 0);
  const it = Math.floor(NOW / map(S.speed, 0, 255, delay << 4, delay));
  const offset = it % SEGLEN;
  let width = (SEGLEN * (S.intensity + 1)) >>> 9;
  if (!width) width = 1;
  for (let i = 0; i < width; i++) {
    const indexR = (offset + i) % SEGLEN;
    const indexB = (offset + i + (SEGLEN >> 1)) % SEGLEN;
    setPixelColor(indexR, color1);
    setPixelColor(indexB, color2);
  }
  return FRAMETIME;
}

// ---- tricolor_chase(color1, color2)
function bB_tricolor_chase(color1, color2) {
  const S = SEG;
  const cycleTime = 50 + ((255 - S.speed) << 1);
  const it = Math.floor(NOW / cycleTime);
  const width = 1 + (S.intensity >> 4);
  let index = it % (width * 3);
  for (let i = 0; i < SEGLEN; i++, index++) {
    if (index > (width * 3) - 1) index = 0;
    let color = color1;
    if (index > (width << 1) - 1) color = cfp(i, true, PSW(), 1);
    else if (index > width - 1) color = color2;
    setPixelColor(SEGLEN - i - 1, color);
  }
  return FRAMETIME;
}

// ---- 35 Traffic Light
function mode_traffic_light() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  for (let i = 0; i < SEGLEN; i++) setPixelColor(i, cfp(i, true, PSW(), 1));
  let mdelay = 500;
  for (let i = 0; i < SEGLEN - 2; i += 3) {
    switch (S.aux0) {
      case 0: setPixelColor(i, 0xFF0000); mdelay = 150 + 100 * (255 - S.speed); break;
      case 1: setPixelColor(i, 0xFF0000); mdelay = 150 + 20 * (255 - S.speed); setPixelColor(i + 1, 0xEECC00); break;
      case 2: setPixelColor(i + 2, 0x00FF00); mdelay = 150 + 100 * (255 - S.speed); break;
      case 3: setPixelColor(i + 1, 0xEECC00); mdelay = 150 + 20 * (255 - S.speed); break;
    }
  }
  if (((NOW - S.step) >>> 0) > mdelay) {
    S.aux0 = (S.aux0 + 1) & 0xFFFF;
    if (S.aux0 === 1 && S.intensity > 140) S.aux0 = 2;
    if (S.aux0 > 3) S.aux0 = 0;
    S.step = NOW >>> 0;
  }
  return FRAMETIME;
}

// ---- 36 Sweep Random
function mode_color_sweep_random() { return bB_color_wipe(true, true); }

// ---- 37 Chase 2
function mode_running_color() { return bB_running(SEGCOLOR(0), SEGCOLOR(1), false); }

// ---- 39 Stream
function mode_running_random() {
  const S = SEG;
  const cycleTime = 25 + 3 * (255 - S.speed);
  const it = Math.floor(NOW / cycleTime);
  if (S.call === 0) S.aux0 = random16();
  const zoneSize = ((255 - S.intensity) >> 4) + 1;
  let PRNG16 = S.aux0 & 0xFFFF;
  let z = it % zoneSize;
  let nzone = (!z && it !== S.aux1);   // uint32 it vs uint16 aux1 (sic)
  for (let i = SEGLEN - 1; i >= 0; i--) {
    if (nzone || z >= zoneSize) {
      const lastrand = PRNG16 >> 8;
      let diff = 0;
      while (Math.abs(diff) < 42) {
        PRNG16 = (Math.imul(PRNG16, 2053) + 13849) & 0xFFFF;
        diff = toI16((PRNG16 >> 8) - lastrand);
      }
      if (nzone) { S.aux0 = PRNG16; nzone = false; }
      z = 0;
    }
    setPixelColor(i, color_wheel(PRNG16 >> 8));
    z++;
  }
  S.aux1 = it & 0xFFFF;
  return FRAMETIME;
}

// ---- 40 Scanner
function mode_larson_scanner() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const speed = FRAMETIME * map(S.speed, 0, 255, 96, 2);
  const pixels = (SEGLEN / speed) >>> 0;
  fade_out(255 - S.intensity);
  if (S.step > NOW) return FRAMETIME;
  let index = S.aux1 + pixels;
  if (pixels === 0) {
    const frames = (speed / SEGLEN) >>> 0;
    const old = S.step; S.step = (S.step + 1) >>> 0;
    if (old < frames) return FRAMETIME;
    S.step = 0;
    index++;
  }
  if (index > SEGLEN) {
    S.aux0 = S.aux0 ? 0 : 1;
    S.aux1 = 0;
    if (S.aux0 || S.check2) S.step = (NOW + S.custom1 * 25) >>> 0;
    else S.step = 0;
  } else {
    for (let i = S.aux1; i < index; i++) {
      const j = S.aux0 ? i : SEGLEN - 1 - i;
      const c = cfp(j, true, PSW(), 0);
      setPixelColor(j, c);
      if (S.check1) setPixelColor(SEGLEN - 1 - j, SEGCOLOR(2) ? SEGCOLOR(2) : c);
    }
    S.aux1 = index & 0xFFFF;
  }
  return FRAMETIME;
}

// ---- 60 Scanner Dual
function mode_dual_larson_scanner() {
  SEG.check1 = true;
  return mode_larson_scanner();
}

// ---- 41 Lighthouse
function mode_comet() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const counter = mul32(NOW, (S.speed >> 2) + 1) & 0xFFFF;
  const index = (counter * SEGLEN) >>> 16;
  if (S.call === 0) S.aux0 = index;
  fade_out(S.intensity);
  setPixelColor(index, cfp(index, true, PSW(), 0));
  if (index > S.aux0) {
    for (let i = S.aux0; i < index; i++) setPixelColor(i, cfp(i, true, PSW(), 0));
  } else if (index < S.aux0 && index < 10) {
    for (let i = 0; i < index; i++) setPixelColor(i, cfp(i, true, PSW(), 0));
  }
  S.aux0 = index & 0xFFFF;
  return FRAMETIME;
}

// ---- 44 Tetrix (1D: nrOfVStrips() == 1)
function mode_tetrix() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const fl = data('bB_tx_f', Float32Array, 2);   // [pos, speed]
  const cl = data('bB_tx_c', Uint8Array, 1);     // col
  const bs = data('bB_tx_s', Uint16Array, 2);    // [brick, stack]
  const st = data('bB_tx_t', Uint32Array, 1);    // step
  if (S.call === 0) {
    bs[1] = 0;
    st[0] = NOW + 2000;
    if (S.check1) cl[0] = 0;
  }
  if (st[0] === 0) {
    let speed = S.speed ? S.speed : random8r(1, 255);
    speed = map(speed, 1, 255, 5000, 250);
    fl[1] = Math.fround(SEGLEN * FRAMETIME) / Math.fround(speed);
    fl[0] = SEGLEN;
    if (!S.check1) cl[0] = random8r(0, 15) << 4;
    st[0] = 1;
    bs[0] = (S.intensity ? (S.intensity >> 5) + 1 : random8r(1, 5)) * (1 + (SEGLEN >> 6));
  }
  if (st[0] === 1) {
    if (random8() >> 6) st[0] = 2;
  }
  if (st[0] === 2) {
    if (fl[0] > bs[1]) {
      fl[0] = fl[0] - fl[1];
      if (Math.trunc(fl[0]) < bs[1]) fl[0] = bs[1];
      const p = Math.trunc(fl[0]);
      for (let i = p; i < SEGLEN; i++) {
        const col = i < p + bs[0] ? cfp(cl[0], false, false, 0) : SEGCOLOR(1);
        setPixelColor(i, col);
      }
    } else {
      st[0] = 0;
      bs[1] = bs[1] + bs[0];
      if (bs[1] >= SEGLEN) st[0] = NOW + 2000;
    }
  }
  if (st[0] > 2) {
    bs[0] = 0;
    if (st[0] > NOW) {
      const bg = SEGCOLOR(1);
      for (let i = 0; i < SEGLEN; i++) blendPixelColor(i, bg, 25);
    } else {
      bs[1] = 0;
      st[0] = 0;
      if (S.check1) cl[0] = cl[0] + 8;
    }
  }
  return FRAMETIME;
}

// ---- 45 Fire Flicker
function mode_fire_flicker() {
  const S = SEG;
  const cycleTime = 40 + (255 - S.speed);
  const it = Math.floor(NOW / cycleTime);
  if (S.step === it) return FRAMETIME;
  const c0 = SEGCOLOR(0);
  const w = 0, r = (c0 >> 16) & 255, g = (c0 >> 8) & 255, b = c0 & 255;
  let lum = (S.palette === 0) ? Math.max(w, r, g, b) : 255;
  lum = (lum / ((((256 - S.intensity) / 16) | 0) + 1)) | 0;
  for (let i = 0; i < SEGLEN; i++) {
    const flicker = random8l(lum);
    if (S.palette === 0) {
      setPixelColor(i, RGB(Math.max(r - flicker, 0), Math.max(g - flicker, 0), Math.max(b - flicker, 0)));
    } else {
      setPixelColor(i, cfp(i, true, PSW(), 0, 255 - flicker));
    }
  }
  S.step = it >>> 0;
  return FRAMETIME;
}

// ---- 47 Loading (gradient_base(true))
function mode_loading() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const counter = mul32(NOW, (S.speed >> 2) + 1) & 0xFFFF;
  let pp = ((counter * SEGLEN) >>> 16) & 0xFFFF;
  if (S.call === 0) pp = 0;
  const brd = S.intensity >> 1;   // sic: "1 + loading ? ix/2 : ix/4" always picks ix/2
  const p2 = pp + SEGLEN, c0 = SEGCOLOR(0);
  for (let i = 0; i < SEGLEN; i++) {
    let val = Math.abs(((i > pp) ? p2 : pp) - i);
    val = (brd > val) ? ((val * 255 / brd) | 0) : 255;
    setPixelColor(i, color_blend(c0, cfp(i, true, PSW(), 1), val));
  }
  return FRAMETIME;
}

// ---- 48 Rolling Balls
function rolling_balls() {
  const S = SEG, f = Math.fround;
  const maxNumBalls = 16;
  const lb = data('bB_rb_lb', Uint32Array, maxNumBalls);
  const mass = data('bB_rb_m', Float32Array, maxNumBalls);
  const vel = data('bB_rb_v', Float32Array, maxNumBalls);
  const hgt = data('bB_rb_h', Float32Array, maxNumBalls);
  const numBalls = ((S.intensity / 16) | 0) + 1;
  const hasCol2 = SEGCOLOR(2) !== 0;
  if (S.call === 0) {
    fill(hasCol2 ? BLACK : SEGCOLOR(1));
    for (let i = 0; i < maxNumBalls; i++) {
      lb[i] = NOW;
      vel[i] = f(f(20 * random16r(1000, 10000)) / 10000);
      if (random8() < 128) vel[i] = -vel[i];
      hgt[i] = f(random16r(0, 10000) / 10000);
      mass[i] = f(random16r(1000, 10000) / 10000);
    }
  }
  const cfac = f((scale8(8, 255 - S.speed) + 1) * 20000);
  if (S.check3) fade_out(250);
  else if (!S.check2) fill(hasCol2 ? BLACK : SEGCOLOR(1));
  for (let i = 0; i < numBalls; i++) {
    const tslu = f(f((NOW - lb[i]) >>> 0) / cfac);
    let thisHeight = f(hgt[i] + f(vel[i] * tslu));
    if (thisHeight < -0.5 || thisHeight > 1.5) {
      thisHeight = hgt[i] = f(random16r(0, 10000) / 10000);
      lb[i] = NOW;
    }
    if ((thisHeight <= 0 && vel[i] < 0) || (thisHeight >= 1 && vel[i] > 0)) {
      vel[i] = -vel[i];
      lb[i] = NOW;
      hgt[i] = thisHeight;
    }
    if (S.check1) {
      for (let j = i + 1; j < numBalls; j++) {
        if (vel[j] !== vel[i]) {
          const dji = f((lb[j] - lb[i]) >>> 0);   // unsigned long difference (wraps, sic)
          const tcollided = f(f(f(cfac * f(hgt[i] - hgt[j])) + f(vel[i] * dji)) / f(vel[j] - vel[i]));
          if ((tcollided > 2) && (tcollided < f((NOW - lb[j]) >>> 0))) {
            hgt[i] = f(hgt[i] + f(f(vel[i] * f(tcollided + dji)) / cfac));
            hgt[j] = hgt[i];
            lb[i] = (Math.trunc(f(tcollided + 0.5)) + lb[j]) >>> 0;
            lb[j] = lb[i];
            const vtmp = vel[i];
            const msum = f(mass[i] + mass[j]);
            vel[i] = f(f(f(f(mass[i] - mass[j]) * vtmp) + f(f(2 * mass[j]) * vel[j])) / msum);
            vel[j] = f(f(f(f(mass[j] - mass[i]) * vel[j]) + f(f(2 * mass[i]) * vtmp)) / msum);
            thisHeight = f(hgt[i] + f(f(vel[i] * f((NOW - lb[i]) >>> 0)) / cfac));
          }
        }
      }
    }
    let color = SEGCOLOR(0);
    if (S.palette) color = cfp((i * 255 / numBalls) | 0, false, PSW(), 0);
    else if (hasCol2) color = SEGCOLOR(i % 3);
    if (thisHeight < 0) thisHeight = 0;
    if (thisHeight > 1) thisHeight = 1;
    const pos = Math.round(f(thisHeight * (SEGLEN - 1)));
    setPixelColor(pos, color);
    lb[i] = NOW;
    hgt[i] = thisHeight;
  }
  return FRAMETIME;
}

// ---- 49 Fairy
const bB_FLASHERS_PER_ZONE = 6, bB_MAX_SHIMMER = 92;
const bB_flasherBri = new Uint8Array(bB_FLASHERS_PER_ZONE * 2 - 1 + 16);   // C++ array is 11; slack keeps JS safe
function mode_fairy() {
  const S = SEG;
  let PRNG16 = 5100;   // + segment id 0
  for (let i = 0; i < SEGLEN; i++) {
    PRNG16 = (Math.imul(PRNG16, 2053) + 1384) & 0xFFFF;
    setPixelColor(i, cfp(PRNG16 >> 8, false, false, 0));
  }
  if (S.intensity === 0) return FRAMETIME;
  const flasherDistance = (((255 - S.intensity) / 28) | 0) + 1;
  const numFlashers = ((SEGLEN / flasherDistance) | 0) + 1;
  // SEGENV.data = Flasher[numFlashers] { uint16 stateStart; uint8 stateDur; bool stateOn; }
  const fStart = data('bB_fy_s', Uint16Array, numFlashers);
  const fDur = data('bB_fy_d', Uint8Array, numFlashers);
  const fOn = data('bB_fy_o', Uint8Array, numFlashers);
  const now16 = NOW & 0xFFFF;
  let zones = (numFlashers / bB_FLASHERS_PER_ZONE) | 0;
  if (!zones) zones = 1;
  let flashersInZone = (numFlashers / zones) | 0;
  const flasherBri = bB_flasherBri;
  const bg = SEGCOLOR(1);
  for (let z = 0; z < zones; z++) {
    let flasherBriSum = 0;
    const firstFlasher = z * flashersInZone;
    if (z === zones - 1) flashersInZone = numFlashers - (flashersInZone * (zones - 1));
    for (let f = firstFlasher; f < firstFlasher + flashersInZone; f++) {
      let stateTime = (now16 - fStart[f]) & 0xFFFF;
      if (stateTime > fDur[f] * 10) {
        fOn[f] = fOn[f] ? 0 : 1;
        if (fOn[f]) fDur[f] = 12 + random8l(12 + ((255 - S.speed) >> 2));
        else fDur[f] = 20 + random8l(6 + ((255 - S.speed) >> 2));
        fStart[f] = now16;
        if (stateTime < 255) {
          fStart[f] = (fStart[f] - (255 - stateTime)) & 0xFFFF;
          fDur[f] = (fDur[f] + 26 - ((stateTime / 10) | 0)) & 255;
          stateTime = 255 - stateTime;
        } else {
          stateTime = 0;
        }
      }
      if (stateTime > 255) stateTime = 255;
      flasherBri[f - firstFlasher] = fOn[f] ? stateTime : 255 - stateTime;
      flasherBriSum += flasherBri[f - firstFlasher];
    }
    const avgFlasherBri = (flasherBriSum / flashersInZone) | 0;
    const globalPeakBri = 255 - ((avgFlasherBri * bB_MAX_SHIMMER) >> 8);
    for (let f = firstFlasher; f < firstFlasher + flashersInZone; f++) {
      const bri = ((flasherBri[f - firstFlasher] * globalPeakBri) / 255) | 0;
      PRNG16 = (Math.imul(PRNG16, 2053) + 1384) & 0xFFFF;
      const flasherPos = f * flasherDistance;
      setPixelColor(flasherPos, color_blend(bg, cfp(PRNG16 >> 8, false, false, 0), bri));
      for (let i = flasherPos + 1; i < flasherPos + flasherDistance && i < SEGLEN; i++) {
        PRNG16 = (Math.imul(PRNG16, 2053) + 1384) & 0xFFFF;
        setPixelColor(i, cfp(PRNG16 >> 8, false, false, 0, globalPeakBri));
      }
    }
  }
  return FRAMETIME;
}

// ---- 50 Two Dots
function mode_two_dots() {
  if (!SEG.check2) fill(SEGCOLOR(2));
  const color2 = (SEGCOLOR(1) === SEGCOLOR(2)) ? SEGCOLOR(0) : SEGCOLOR(1);
  return bB_police_base(SEGCOLOR(0), color2);
}

// ---- 52 Running Dual
function mode_running_dual() { return bB_running_base(false, true); }

// ---- 54 Chase 3
function mode_tricolor_chase() { return bB_tricolor_chase(SEGCOLOR(2), SEGCOLOR(0)); }

// ---- 58 ICU
function mode_icu() {
  const S = SEG;
  let dest = S.step & 0xFFFF;
  const space = (S.intensity >> 3) + 2;
  const sp = (SEGLEN / space) | 0;
  if (!S.check2) fill(SEGCOLOR(1));
  const pindex = map(dest, 0, SEGLEN - sp, 0, 255) & 255;
  const col = cfp(pindex, false, false, 0);
  setPixelColor(dest, col);
  setPixelColor(dest + sp, col);
  if (S.aux0 === dest) {
    if (random8l(6) === 0) {
      setPixelColor(dest, SEGCOLOR(1));
      setPixelColor(dest + sp, SEGCOLOR(1));
      return 200;
    }
    S.aux0 = random16l(SEGLEN - sp);
    return 1000 + random16l(2000);
  }
  if (S.aux0 > S.step) { S.step = (S.step + 1) >>> 0; dest++; }
  else if (S.aux0 < S.step) { S.step = (S.step - 1) >>> 0; dest--; }
  setPixelColor(dest, col);
  setPixelColor(dest + sp, col);
  return 5 + (((50 * (255 - S.speed)) / SEGLEN) >>> 0);   // SPEED_FORMULA_L
}

// ---- 55 Tri Wipe
function mode_tricolor_wipe() {
  const S = SEG;
  const cycleTime = 1000 + (255 - S.speed) * 200;
  const perc = NOW % cycleTime;
  const prog = Math.floor((perc * 65535) / cycleTime);
  const ledIndex = Math.floor((prog * SEGLEN * 3) / 65536);
  let ledOffset = ledIndex;
  for (let i = 0; i < SEGLEN; i++) setPixelColor(i, cfp(i, true, PSW(), 2));
  if (ledIndex < SEGLEN) {
    for (let i = 0; i < SEGLEN; i++) setPixelColor(i, (i > ledOffset) ? SEGCOLOR(0) : SEGCOLOR(1));
  } else if (ledIndex < SEGLEN * 2) {
    ledOffset = ledIndex - SEGLEN;
    for (let i = ledOffset + 1; i < SEGLEN; i++) setPixelColor(i, SEGCOLOR(1));
  } else {
    ledOffset = ledIndex - SEGLEN * 2;
    for (let i = 0; i <= ledOffset; i++) setPixelColor(i, SEGCOLOR(0));
  }
  return FRAMETIME;
}

// ---- 56 Tri Fade
function mode_tricolor_fade() {
  const S = SEG;
  const counter = mul32(NOW, (S.speed >> 3) + 1) & 0xFFFF;
  const prog = (counter * 768) >>> 16;
  let color1 = 0, color2 = 0, stage = 0;
  if (prog < 256) { color1 = SEGCOLOR(0); color2 = SEGCOLOR(1); stage = 0; }
  else if (prog < 512) { color1 = SEGCOLOR(1); color2 = SEGCOLOR(2); stage = 1; }
  else { color1 = SEGCOLOR(2); color2 = SEGCOLOR(0); stage = 2; }
  const stp = prog & 255;
  for (let i = 0; i < SEGLEN; i++) {
    let color;
    if (stage === 2) color = color_blend(cfp(i, true, PSW(), 2), color2, stp);
    else if (stage === 1) color = color_blend(color1, cfp(i, true, PSW(), 2), stp);
    else color = color_blend(color1, color2, stp);
    setPixelColor(i, color);
  }
  return FRAMETIME;
}

// ---- 59 Multi Comet
function mode_multi_comet() {
  const S = SEG;
  const MAX_COMETS = 8;
  const cycleTime = 10 + (255 - S.speed);
  const it = Math.floor(NOW / cycleTime);
  if (S.step === it) return FRAMETIME;
  const comets = data('bB_mc', Uint16Array, MAX_COMETS);
  fade_out((S.intensity >> 1) + 128);
  for (let i = 0; i < MAX_COMETS; i++) {
    if (comets[i] < SEGLEN) {
      const index = comets[i];
      if (SEGCOLOR(2) !== 0) setPixelColor(index, (i % 2) ? cfp(index, true, PSW(), 0) : SEGCOLOR(2));
      else setPixelColor(index, cfp(index, true, PSW(), 0));
      comets[i]++;
    } else {
      if (!random16l(SEGLEN)) comets[i] = 0;
    }
  }
  S.step = it >>> 0;
  return FRAMETIME;
}

// ---- 61 Stream 2
function mode_random_chase() {
  const S = SEG;
  if (S.call === 0) {
    const r0 = random8(), g0 = random8(), b0 = random8();   // C++ evaluation order of RGBW32 operands is unspecified
    S.step = RGB(r0, g0, b0) >>> 0;
    S.aux0 = random16();
  }
  const prevSeed = SEED;
  const cycleTime = 25 + 3 * (255 - S.speed);
  const it = Math.floor(NOW / cycleTime);
  let color = S.step;
  SEED = S.aux0 & 0xFFFF;
  for (let i = SEGLEN - 1; i >= 0; i--) {
    const r = random8l(6) !== 0 ? ((color >> 16) & 0xFF) : random8();
    const g = random8l(6) !== 0 ? ((color >> 8) & 0xFF) : random8();
    const b = random8l(6) !== 0 ? (color & 0xFF) : random8();
    color = RGB(r, g, b);
    setPixelColor(i, color);
    if (i === SEGLEN - 1 && S.aux1 !== (it & 0xFFFF)) {
      S.step = color >>> 0;
      S.aux0 = SEED;
    }
  }
  S.aux1 = it & 0xFFFF;
  SEED = prevSeed;
  return FRAMETIME;
}

// ---- 62 Oscillate
function mode_oscillate() {
  const S = SEG;
  const N = 3;
  // Oscillator { uint16 pos; uint8 size; int8 dir; uint8 speed; }
  const opos = data('bB_os_p', Uint16Array, N), osize = data('bB_os_s', Uint8Array, N);
  const odir = data('bB_os_d', Int8Array, N), ospd = data('bB_os_v', Uint8Array, N);
  if (S.call === 0) {
    opos[0] = (SEGLEN / 4) | 0;           osize[0] = (SEGLEN / 8) | 0; odir[0] = 1;  ospd[0] = 1;
    opos[1] = ((SEGLEN / 4) | 0) * 3;     osize[1] = (SEGLEN / 8) | 0; odir[1] = 1;  ospd[1] = 2;
    opos[2] = ((SEGLEN / 4) | 0) * 2;     osize[2] = (SEGLEN / 8) | 0; odir[2] = -1; ospd[2] = 1;
  }
  const cycleTime = 20 + 2 * (255 - S.speed);
  const it = Math.floor(NOW / cycleTime);
  for (let i = 0; i < N; i++) {
    if (it !== S.step) opos[i] = opos[i] + odir[i] * ospd[i];
    osize[i] = (SEGLEN / (3 + ((S.intensity / 8) | 0))) | 0;
    if ((odir[i] === -1) && (opos[i] > (SEGLEN << 1))) {
      opos[i] = 0;
      odir[i] = 1;
      ospd[i] = S.speed > 100 ? random8r(2, 4) : random8r(1, 3);
    }
    if ((odir[i] === 1) && (opos[i] >= (SEGLEN - 1))) {
      opos[i] = SEGLEN - 1;
      odir[i] = -1;
      ospd[i] = S.speed > 100 ? random8r(2, 4) : random8r(1, 3);
    }
  }
  for (let i = 0; i < SEGLEN; i++) {
    let color = BLACK;
    for (let j = 0; j < N; j++) {
      if (i >= opos[j] - osize[j] && i <= opos[j] + osize[j]) {
        color = (color === BLACK) ? SEGCOLOR(j) : color_blend(color, SEGCOLOR(j), 128);
      }
    }
    setPixelColor(i, color);
  }
  S.step = it >>> 0;
  return FRAMETIME;
}

// ===== WLED effects, port batch C =====
// =====================================================================================================================
// batch C — WLED FX.cpp ports: 69 73 78 85 86 93 98 103 105 108 109 111 113 116 179 184
// (spliced verbatim into tlfx.js before `const FX = {`; helpers prefixed bC_)
// =====================================================================================================================

// ---- FastLED noise.cpp 1D inoise8(uint16_t x) (inoise8_raw + qadd8) — used by Phased Noise
function bC_grad8_1(hash, x) {
  let u, v;
  if (hash & 8) { u = x; v = x; }
  else if (hash & 4) { u = 1; v = x; }
  else { u = x; v = 1; }
  if (hash & 1) u = toI8(-u);
  if (hash & 2) v = toI8(-v);
  return avg7(u, v);
}
function bC_inoise8_1(x) {
  x &= 0xFFFF;
  const P = PERM;
  const X = x >> 8;
  const A = P[X], AA = P[A], B = P[X + 1], BA = P[B];
  let u = x & 255;
  const xx = toI8((u >> 1) & 0x7F), N = 0x80;
  u = ease8InOutQuad(u);
  const n = (lerp7by8(bC_grad8_1(P[AA], xx), bC_grad8_1(P[BA], toI8(xx - N)), u) + 64) & 255;
  return qadd8(n, n);
}

// ---- FX.cpp tristate_square8()
function bC_tristate_square8(x, pulsewidth, attdec) {
  x &= 255;
  let a = 127;
  if (x > 127) { a = -127; x = (x - 127) & 255; }
  if (x < attdec) return toI8(Math.trunc(x * a / attdec));
  else if (x < pulsewidth - attdec) return a;
  else if (x < pulsewidth) return toI8(Math.trunc((pulsewidth - x) * a / attdec));
  return 0;
}

// 69 Fill Noise
function mode_fillnoise8() {
  const S = SEG;
  if (S.call === 0) S.step = random16l(12345);
  for (let i = 0; i < SEGLEN; i++) {
    const index = inoise8_2(i * SEGLEN, (S.step + i * SEGLEN) >>> 0);
    setPixelColor(i, cfp(index, false, PSW(), 0));
  }
  S.step = (S.step + beatsin8_t(S.speed, 1, 6)) >>> 0;
  return FRAMETIME;
}

// 73 Noise 4
function mode_noise16_4() {
  const S = SEG;
  const stp = mul32(NOW, S.speed) >>> 7;
  for (let i = 0; i < SEGLEN; i++) {
    const index = inoise16_2((i << 12) >>> 0, stp);
    setPixelColor(i, cfp(index, false, PSW(), 0));
  }
  return FRAMETIME;
}

// 78 Railway
function mode_railway() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const dur = (256 - S.speed) * 40;
  const rampdur = ((dur * S.intensity) >> 8) & 0xFFFF;
  if ((S.step >>> 0) > dur) {
    S.step = 0;
    S.aux0 = S.aux0 ? 0 : 1;
  }
  let pos = 255;
  if (rampdur !== 0) {
    const p0 = Math.floor(mul32(S.step, 255) / rampdur);
    if (p0 < 255) pos = p0;
  }
  if (S.aux0) pos = 255 - pos;
  for (let i = 0; i < SEGLEN; i += 2) {
    setPixelColor(i, cfp(255 - pos, false, false, 255));
    if (i < SEGLEN - 1) setPixelColor(i + 1, cfp(pos, false, false, 255));
  }
  S.step = (S.step + FRAMETIME) >>> 0;
  return FRAMETIME;
}

// 85 Spots / 86 Spots Fade
function bC_spots_base(threshold) {
  const S = SEG;
  threshold &= 0xFFFF;
  if (SEGLEN === 1) return mode_static();
  if (!S.check2) fill(SEGCOLOR(1));
  const maxZones = SEGLEN >> 2;
  const zones = 1 + ((S.intensity * maxZones) >> 8);
  const zoneLen = (SEGLEN / zones) | 0;
  const offset = (SEGLEN - zones * zoneLen) >> 1;
  for (let z = 0; z < zones; z++) {
    const pos = offset + z * zoneLen;
    for (let i = 0; i < zoneLen; i++) {
      const wave = triwave16(((i * 0xFFFF) / zoneLen) >>> 0);
      if (wave > threshold) {
        const index = pos + i;
        const s = Math.floor((wave - threshold) * 255 / (0xFFFF - threshold));
        setPixelColor(index, color_blend(cfp(index, true, PSW(), 0), SEGCOLOR(1), 255 - s));
      }
    }
  }
  return FRAMETIME;
}
function mode_spots() { return bC_spots_base((255 - SEG.speed) << 8); }
function mode_spots_fade() {
  const counter = mul32(NOW, (SEG.speed >> 2) + 8);
  const t = triwave16(counter & 0xFFFF);
  const tr = (t >> 1) + (t >> 2);
  return bC_spots_base(tr);
}

// 93 Sinelon Dual (FX.cpp sinelon_base(dual, rainbow))
function bC_sinelon_base(dual, rainbow) {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  fade_out(S.intensity);
  const pos = beatsin16_t((S.speed / 10) | 0, 0, SEGLEN - 1);
  if (S.call === 0) S.aux0 = pos;
  let color1 = cfp(pos, true, false, 0);
  let color2 = SEGCOLOR(2);
  if (rainbow) color1 = color_wheel((pos & 0x07) * 32);
  setPixelColor(pos, color1);
  if (dual) {
    if (!color2) color2 = cfp(pos, true, false, 0);
    if (rainbow) color2 = color1;
    setPixelColor(SEGLEN - 1 - pos, color2);
  }
  if (S.aux0 !== pos) {
    if (S.aux0 < pos) {
      for (let i = S.aux0; i < pos; i++) { setPixelColor(i, color1); if (dual) setPixelColor(SEGLEN - 1 - i, color2); }
    } else {
      for (let i = S.aux0; i > pos; i--) { setPixelColor(i, color1); if (dual) setPixelColor(SEGLEN - 1 - i, color2); }
    }
    S.aux0 = pos & 0xFFFF;
  }
  return FRAMETIME;
}
function mode_sinelon_dual() { return bC_sinelon_base(true, false); }

// 98 Percent
function mode_percent() {
  const S = SEG;
  let percent = S.intensity;
  percent = constrain(percent, 0, 200);
  const active_leds = (percent < 100) ? Math.round(Math.fround(Math.fround(SEGLEN * percent) / 100))
                                      : Math.round(Math.fround(Math.fround(SEGLEN * (200 - percent)) / 100));
  let size = 1 + ((S.speed * SEGLEN) >> 11);
  if (S.speed === 255) size = 255;
  if (percent <= 100) {
    for (let i = 0; i < SEGLEN; i++) {
      if (i < S.aux1) {
        if (S.check1) setPixelColor(i, cfp(map(percent, 0, 100, 0, 255), false, false, 0));
        else setPixelColor(i, cfp(i, true, PSW(), 0));
      } else setPixelColor(i, SEGCOLOR(1));
    }
  } else {
    for (let i = 0; i < SEGLEN; i++) {
      if (i < (SEGLEN - S.aux1)) setPixelColor(i, SEGCOLOR(1));
      else {
        if (S.check1) setPixelColor(i, cfp(map(percent, 100, 200, 255, 0), false, false, 0));
        else setPixelColor(i, cfp(i, true, PSW(), 0));
      }
    }
  }
  if (active_leds > S.aux1) {
    S.aux1 = (S.aux1 + size) & 0xFFFF;
    if (S.aux1 > active_leds) S.aux1 = active_leds;
  } else if (active_leds < S.aux1) {
    if (S.aux1 > size) S.aux1 = (S.aux1 - size) & 0xFFFF; else S.aux1 = 0;
    if (S.aux1 < active_leds) S.aux1 = active_leds;
  }
  return FRAMETIME;
}

// 103 Solid Glitter
function mode_solid_glitter() {
  const S = SEG;
  fill(SEGCOLOR(0));
  const col = SEGCOLOR(2) ? SEGCOLOR(2) : WHITE;   // ULTRAWHITE on an RGB strip
  if (S.intensity > random8()) setPixelColor(random16l(SEGLEN), col);
  return FRAMETIME;
}

// 105 Phased / 109 Phased Noise — SEGENV.step reinterpreted as float
const bC_F32 = new Float32Array(1), bC_U32 = new Uint32Array(bC_F32.buffer);
function bC_phased_base(moder) {
  const S = SEG;
  const allfreq = 16;
  bC_U32[0] = S.step >>> 0;
  let phase = bC_F32[0];
  const cutOff = 255 - S.intensity;
  let modVal = 5;
  let index = Math.floor(NOW / 64) >>> 0;
  phase = Math.fround(phase + S.speed / 32.0);
  bC_F32[0] = phase; S.step = bC_U32[0];
  for (let i = 0; i < SEGLEN; i++) {
    if (moder === 1) modVal = bC_inoise8_1(i * 10 + i * 10) >> 4;
    let val = ((i + 1) * allfreq) >>> 0;
    if (modVal === 0) modVal = 1;
    const k = (i % modVal) + 1;
    const add = Math.fround(Math.fround(phase * k) / 2);
    val = Math.trunc(Math.fround(Math.fround(val) + add)) >>> 0;
    let b = cubicwave8(val & 255);
    b = (b > cutOff) ? (b - cutOff) : 0;
    setPixelColor(i, color_blend(SEGCOLOR(1), cfp(index, false, false, 0), b));
    index = (index + ((256 / SEGLEN) | 0)) >>> 0;
    if (SEGLEN > 256) index = (index + 1) >>> 0;
  }
  return FRAMETIME;
}
function mode_phased() { return bC_phased_base(0); }
function mode_phased_noise() { return bC_phased_base(1); }

// 108 Sine
function mode_sinewave() {
  const S = SEG;
  const colorIndex = Math.floor(NOW / 32) >>> 0;
  S.step = (S.step + (S.speed >> 4)) >>> 0;
  const freq = S.intensity >> 2;
  for (let i = 0; i < SEGLEN; i++) {
    const pixBri = cubicwave8(((i * freq) + S.step) & 255);
    setPixelColor(i, color_blend(SEGCOLOR(1), cfp(Math.floor(mul32(i, colorIndex) / 255), false, PSW(), 0), pixBri));
  }
  return FRAMETIME;
}

// 111 Chunchun
function mode_chunchun() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  fade_out(254);
  let counter = mul32(NOW, 6 + (S.speed >> 4));
  const numBirds = 2 + (SEGLEN >> 3);
  const span = ((S.intensity << 8) / numBirds) | 0;
  for (let i = 0; i < numBirds; i++) {
    counter = (counter - span) >>> 0;
    const megumin = (sin16_t(counter) + 0x8000) >>> 0;
    let bird = (mul32(megumin, SEGLEN) >>> 16);
    const c = cfp(((i * 255) / numBirds) | 0, false, false, 0);
    bird = constrain(bird, 0, SEGLEN - 1);
    setPixelColor(bird, c);
  }
  return FRAMETIME;
}

// 113 Washing Machine
function mode_washing_machine() {
  const S = SEG;
  const speed = bC_tristate_square8((NOW >>> 7) & 255, 90, 15);
  S.step = (S.step + Math.trunc((speed * 2048) / (512 - S.speed))) >>> 0;
  for (let i = 0; i < SEGLEN; i++) {
    const col = sin8_t((((((S.intensity / 25) | 0) + 1) * 255 * i / SEGLEN) | 0) + (S.step >>> 7));
    setPixelColor(i, cfp(col, false, PSW(), 3));
  }
  return FRAMETIME;
}

// 116 TV Simulator (this version has only the Adafruit "Fake TV" HSB variant — no lookup tables in this version)
function mode_tv_simulator() {
  const S = SEG;
  let nr, ng, nb, r, g, b, i, hue, sat, bri, j;
  let tv = S.st.bC_tv;
  if (!tv || S.call === 0) {
    tv = S.st.bC_tv = { totalTime: 0, fadeTime: 0, startTime: 0, elapsed: 0, pixelNum: 0, sliderValues: 0,
      sceeneStart: 0, sceeneDuration: 0, sceeneColorHue: 0, sceeneColorSat: 0, sceeneColorBri: 0,
      actualColorR: 0, actualColorG: 0, actualColorB: 0, pr: 0, pg: 0, pb: 0 };
  }
  const colorSpeed = map(S.speed, 0, 255, 1, 20) & 255;
  const colorIntensity = map(S.intensity, 0, 255, 10, 30) & 255;

  i = (S.speed << 8) | S.intensity;
  if (i !== tv.sliderValues) { tv.sliderValues = i & 0xFFFF; S.aux1 = 0; }

  if ((((NOW - tv.sceeneStart) >>> 0) >= tv.sceeneDuration) || S.aux1 === 0) {
    tv.sceeneStart = NOW >>> 0;
    tv.sceeneDuration = random16r((60 * 250 * colorSpeed) & 0xFFFF, (60 * 750 * colorSpeed) & 0xFFFF);
    tv.sceeneColorHue = random16r(0, 768);
    tv.sceeneColorSat = random8r(100, (130 + colorIntensity) & 255);
    tv.sceeneColorBri = random8r(200, 240);
    S.aux1 = 1;
    S.aux0 = 0;
  }

  if (S.aux0 === 0) {
    j = random8l((4 * colorIntensity) & 255);
    const H = tv.sceeneColorHue;
    hue = (random8() < 128) ? ((j < H) ? H - j : 767 - H - j)
                            : ((j + H) < 767 ? H + j : H + j - 767);
    j = random8l((2 * colorIntensity) & 255);
    sat = ((tv.sceeneColorSat - j) < 0 ? 0 : tv.sceeneColorSat - j) & 255;
    j = random8l(100);
    bri = ((tv.sceeneColorBri - j) < 0 ? 0 : tv.sceeneColorBri - j) & 255;
    {
      const temp = [0, 0, 0, 0, 0], n = ((hue >> 8) % 3) & 255;
      const x = ((((((hue & 255) * sat) >> 8) * bri) >> 8)) & 255;
      const s = (((256 - sat) * bri) >> 8) & 255;
      temp[0] = temp[3] = s;
      temp[1] = temp[4] = (x + s) & 255;
      temp[2] = (bri - x) & 255;
      tv.actualColorR = temp[n + 2];
      tv.actualColorG = temp[n + 1];
      tv.actualColorB = temp[n];
    }
  }
  nr = GAMMA_RAW[tv.actualColorR] * 257;
  ng = GAMMA_RAW[tv.actualColorG] * 257;
  nb = GAMMA_RAW[tv.actualColorB] * 257;

  if (S.aux0 === 0) {
    S.aux0 = 1;
    tv.totalTime = random16r(250, 2500);
    tv.fadeTime = random16r(0, tv.totalTime);
    if (random8l(10) < 3) tv.fadeTime = 0;
    tv.startTime = NOW >>> 0;
  }

  tv.elapsed = (NOW - tv.startTime) >>> 0;

  if (tv.elapsed < tv.fadeTime) {
    r = map(tv.elapsed, 0, tv.fadeTime, tv.pr, nr);
    g = map(tv.elapsed, 0, tv.fadeTime, tv.pg, ng);
    b = map(tv.elapsed, 0, tv.fadeTime, tv.pb, nb);
  } else { r = nr; g = ng; b = nb; }

  const c = RGB((r >> 8) & 255, (g >> 8) & 255, (b >> 8) & 255);
  for (i = 0; i < SEGLEN; i++) setPixelColor(i, c);

  if (tv.elapsed >= tv.totalTime) {
    tv.pr = nr & 0xFFFF; tv.pg = ng & 0xFFFF; tv.pb = nb & 0xFFFF;
    S.aux0 = 0;
  }
  return FRAMETIME;
}

// 179 Flow Stripe
function mode_FlowStripe() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const hl = (SEGLEN * 10 / 13) | 0;
  const hue = Math.floor(NOW / (S.speed + 1)) & 255;
  const t = Math.floor(NOW / (((S.intensity / 8) | 0) + 1)) >>> 0;
  for (let i = 0; i < SEGLEN; i++) {
    let c = ((Math.abs(i - hl) / hl) | 0) * 127;
    c = sin8_t(c);
    c = sin8_t(((c >> 1) + t) >>> 0);
    const b = sin8_t((c + (t >>> 3)) >>> 0);
    setPixelColor(i, hsv2rgb((b + hue) & 255, 255, 255));
  }
  return FRAMETIME;
}

// 184 Wavesins
function mode_wavesins() {
  const S = SEG;
  for (let i = 0; i < SEGLEN; i++) {
    const bri = sin8_t(((NOW >>> 2) + i * S.intensity) >>> 0);
    const index = beatsin8_t(S.speed, S.custom1, (S.custom1 + S.custom2) & 255, 0, (i * (S.custom3 << 3)) & 255);
    setPixelColor(i, cfp(index, false, PSW(), 0, bri));
  }
  return FRAMETIME;
}

// ===== WLED effects, port batch D =====
// =====================================================================================================================
// batch D — WLED 1D audio-reactive effects (FX.cpp ~6300-7280), ported 1:1.
// Sound is read only through AUD (filled by prepareAudio() from P.audio, or simulateSound() = util.cpp UMS_BeatSin).
// um_data fields the engine does not expose directly are derived by the bD_ helpers below, exactly the way
// util.cpp simulateSound() derives them (volumeRaw = (uint16_t)volumeSmth).
// =====================================================================================================================
const bD_F = Math.fround;
const bD_C178 = Math.fround(1.78);               // 1.78f
const bD_MAXF_LOG10 = Math.fround(4.04238);      // MAX_FREQ_LOG10 (22 kHz sampling)
const bD_MAX_FREQUENCY = 11025;
const bD_GRAY = 0x808080;                        // CRGB::Gray
function bD_log10f(x) { return bD_F(Math.log10(bD_F(x))); }
function bD_mapf(x, a, b, c, d) {                // util.cpp mapf(), all-float
  x = bD_F(x); a = bD_F(a); b = bD_F(b); c = bD_F(c); d = bD_F(d);
  return bD_F(bD_F(bD_F(bD_F(x - a) * bD_F(d - c)) / bD_F(b - a)) + c);
}
// float -> uint8/uint16 conversion as the ESP32 build does it (trunc to int, keep low bits)
function bD_u8(x) { return Math.trunc(x) & 255; }
function bD_u16(x) { return Math.trunc(x) & 0xFFFF; }
// um_data->u_data[1] volumeRaw: int16 view of a uint16 (simulateSound: volumeRaw = volumeSmth)
function bD_volumeRaw() {
  if (AUD.volumeRaw !== undefined) return toI16(Math.trunc(AUD.volumeRaw) & 0xFFFF);
  return toI16(Math.trunc(AUD.volumeSmth) & 0xFFFF);
}
function bD_volumeSmth() { return bD_F(AUD.volumeSmth); }            // u_data[0] float
function bD_samplePeak() { return AUD.samplePeak ? 1 : 0; }          // u_data[3] uint8
function bD_majorPeak() { return bD_F(AUD.majorPeak); }              // u_data[4] float FFT_MajorPeak
function bD_magnitude() { return bD_F(AUD.magnitude); }              // u_data[5] float FFT_Magnitude
// Segment::addPixelColor(n, color, fast=false)
function bD_addPixelColor(i, c) { setPixelColor(i, color_add(getPixelColor(i), c, false)); }
// Segment::fadeToBlackBy (engine fadeToBlackBy masks to uint8 already)

/////////////////////////////////
//     * Ripple Peak  (148)    //
/////////////////////////////////
function mode_ripplepeak() {
  const S = SEG;
  const maxRipples = 16;
  const st = data('rpS', Uint8Array, maxRipples), co = data('rpC', Uint8Array, maxRipples), po = data('rpP', Uint16Array, maxRipples);
  const samplePeak = bD_samplePeak();
  const FFT_MajorPeak = bD_majorPeak();
  // C++: on call 0 custom1/custom2 are overwritten from *binNum / *maxVol, then written back to the usermod
  // (bin select / volume comparator for the peak detector). Here samplePeak comes from P.audio, so this is a no-op.
  if (S.call === 0) S.aux0 = 255;
  fade_out(240);
  fade_out(240);
  const n = (S.intensity / 16) | 0;
  for (let i = 0; i < n; i++) {
    if (samplePeak) st[i] = 255;
    switch (st[i]) {
      case 254: break;
      case 255:
        po[i] = random16l(SEGLEN);
        if (FFT_MajorPeak > 1) co[i] = bD_u8(bD_F(bD_log10f(FFT_MajorPeak) * 128));
        else co[i] = 0;
        st[i] = 0;
        break;
      case 0:
        setPixelColor(po[i], color_blend(SEGCOLOR(1), cfp(co[i], false, PSW(), 0), S.aux0 & 0xFFFF));
        st[i] = (st[i] + 1) & 255;
        break;
      case 16:   // maxsteps
        st[i] = 254;
        break;
      default: {
        const bl = ((((S.aux0 & 0xFFFF) / st[i]) | 0) * 2) & 0xFFFF;
        setPixelColor((po[i] + st[i] + SEGLEN) % SEGLEN, color_blend(SEGCOLOR(1), cfp(co[i], false, PSW(), 0), bl));
        setPixelColor((po[i] - st[i] + SEGLEN) % SEGLEN, color_blend(SEGCOLOR(1), cfp(co[i], false, PSW(), 0), bl));
        st[i] = (st[i] + 1) & 255;
      }
    }
  }
  return FRAMETIME;
}

///////////////////////
//   * GRAVCENTRIC (157)
///////////////////////
function mode_gravcentric() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const gc = data('gcc', Int32Array, 2);   // struct Gravity { int topLED; int gravityCounter; }
  const volumeSmth = bD_volumeSmth();
  fade_out(253);
  let ssa = bD_F(bD_F(volumeSmth * S.intensity) / 255);
  ssa = bD_F(ssa * 0.125);
  const msa = bD_mapf(ssa * 2.0, 0, 32, 0, bD_F(SEGLEN / 2));
  const tempsamp = Math.trunc(constrain(msa, 0, (SEGLEN / 2) | 0));
  const gravity = (8 - ((S.speed / 32) | 0)) & 255;
  const half = (SEGLEN / 2) | 0;
  for (let i = 0; i < tempsamp; i++) {
    const index = bD_u8(bD_F(bD_F(ssa * 24) + Math.floor(NOW / 200)));
    setPixelColor(i + half, cfp(index, false, PSW(), 0));
    setPixelColor(half - 1 - i, cfp(index, false, PSW(), 0));
  }
  if (tempsamp >= gc[0]) gc[0] = tempsamp - 1;
  else if (gc[1] % gravity === 0) gc[0]--;
  if (gc[0] >= 0) {
    setPixelColor(gc[0] + half, bD_GRAY);
    setPixelColor(half - 1 - gc[0], bD_GRAY);
  }
  gc[1] = (gc[1] + 1) % gravity;
  return FRAMETIME;
}

///////////////////////
//   * GRAVIMETER (132)
///////////////////////
function mode_gravimeter() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const gc = data('gcm', Int32Array, 2);
  const volumeSmth = bD_volumeSmth();
  fade_out(249);
  let ssa = bD_F(bD_F(volumeSmth * S.intensity) / 255.0);   // float*float promoted to double / 255.0 -> float
  ssa = bD_F(ssa * 0.25);
  const msa = bD_mapf(ssa * 2.0, 0, 64, 0, SEGLEN - 1);
  const tempsamp = Math.trunc(constrain(msa, 0, SEGLEN - 1));
  const gravity = (8 - ((S.speed / 32) | 0)) & 255;
  for (let i = 0; i < tempsamp; i++) {
    const index = inoise8_2(bD_u16(bD_F(bD_F(i * ssa) + NOW)), bD_u16(bD_F(5000 + bD_F(i * ssa))));
    setPixelColor(i, color_blend(SEGCOLOR(1), cfp(index, false, PSW(), 0), bD_u16(bD_F(ssa * 8))));
  }
  if (tempsamp >= gc[0]) gc[0] = tempsamp;
  else if (gc[1] % gravity === 0) gc[0]--;
  if (gc[0] > 0) setPixelColor(gc[0], cfp(NOW, false, PSW(), 0));
  gc[1] = (gc[1] + 1) % gravity;
  return FRAMETIME;
}

//////////////////////
//   * JUGGLES (130)
//////////////////////
function mode_juggles() {
  const S = SEG;
  const volumeSmth = bD_volumeSmth();
  fade_out(224);
  const my_sampleAgc = Math.trunc(Math.max(Math.min(volumeSmth, 255.0), 0)) >>> 0;
  const n = ((S.intensity / 32) | 0) + 1;
  for (let i = 0; i < n; i++) {
    setPixelColor(beatsin16_t((((S.speed / 4) | 0) + i * 2) & 0xFFFF, 0, SEGLEN - 1),
      color_blend(SEGCOLOR(1), cfp(Math.floor(NOW / 4) + i * 2, false, PSW(), 0), my_sampleAgc & 0xFFFF));
  }
  return FRAMETIME;
}

//////////////////////
//   * MATRIPIX (131)
//////////////////////
function mode_matripix() {
  const S = SEG;
  const px = data('mpx', Int32Array, SEGLEN);
  const volumeRaw = bD_volumeRaw();
  if (S.call === 0) px.fill(BLACK);
  const secondHand = (Math.floor(Math.floor(MICROS / (256 - S.speed)) / 500) % 16) & 255;
  if (S.aux0 !== secondHand) {
    S.aux0 = secondHand;
    const pixBri = Math.trunc(volumeRaw * S.intensity / 64);
    const k = SEGLEN - 1;
    for (let i = 0; i < k; i++) { px[i] = px[i + 1]; setPixelColor(i, px[i]); }
    px[k] = color_blend(SEGCOLOR(1), cfp(NOW, false, PSW(), 0), pixBri & 0xFFFF);
    setPixelColor(k, px[k]);
  }
  return FRAMETIME;
}

//////////////////////
//   * MIDNOISE (135)
//////////////////////
function mode_midnoise() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const volumeSmth = bD_volumeSmth();
  fade_out(S.speed);
  fade_out(S.speed);
  let tmpSound2 = bD_F(bD_F(volumeSmth * S.intensity) / 256.0);
  tmpSound2 = bD_F(tmpSound2 * (bD_F(S.intensity) / 128.0));
  const half = (SEGLEN / 2) | 0;
  let maxLen = Math.trunc(bD_mapf(tmpSound2, 0, 127, 0, half));
  if (maxLen > half) maxLen = half;
  for (let i = half - maxLen; i < half + maxLen; i++) {
    const iv = bD_F(i * volumeSmth);
    const index = inoise8_2(bD_u16(bD_F(iv + (S.aux0 & 0xFFFF))), bD_u16(bD_F((S.aux1 & 0xFFFF) + iv)));
    setPixelColor(i, cfp(index, false, PSW(), 0));
  }
  S.aux0 = (S.aux0 + beatsin8_t(5, 0, 10)) & 0xFFFF;
  S.aux1 = (S.aux1 + beatsin8_t(4, 0, 10)) & 0xFFFF;
  return FRAMETIME;
}

///////////////////////
//   * Noisemeter (136)
///////////////////////
function mode_noisemeter() {
  const S = SEG;
  const volumeSmth = bD_volumeSmth();
  const volumeRaw = bD_volumeRaw();
  const fadeRate = map(S.speed, 0, 255, 200, 254) & 255;
  fade_out(fadeRate);
  const tmpSound2 = bD_F(volumeRaw * 2.0 * bD_F(S.intensity) / 255.0);   // double expression -> float
  let maxLen = Math.trunc(bD_mapf(tmpSound2, 0, 255, 0, SEGLEN));
  if (maxLen < 0) maxLen = 0;
  if (maxLen > SEGLEN) maxLen = SEGLEN;
  for (let i = 0; i < maxLen; i++) {
    const iv = bD_F(i * volumeSmth);
    const index = inoise8_2(bD_u16(bD_F(iv + (S.aux0 & 0xFFFF))), bD_u16(bD_F((S.aux1 & 0xFFFF) + iv)));
    setPixelColor(i, cfp(index, false, PSW(), 0));
  }
  S.aux0 = (S.aux0 + beatsin8_t(5, 0, 10)) & 0xFFFF;
  S.aux1 = (S.aux1 + beatsin8_t(4, 0, 10)) & 0xFFFF;
  return FRAMETIME;
}

//////////////////////
//   * PIXELWAVE (129)
//////////////////////
function mode_pixelwave() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  if (S.call === 0) fill(BLACK);
  const volumeRaw = bD_volumeRaw();
  // C++: micros()/(256-speed)/500+1 % 16  ==  (micros()/(256-speed)/500) + 1, stored in uint8_t
  const secondHand = (Math.floor(Math.floor(MICROS / (256 - S.speed)) / 500) + 1) & 255;
  if (S.aux0 !== secondHand) {
    S.aux0 = secondHand;
    const pixBri = Math.trunc(volumeRaw * S.intensity / 64);
    const half = (SEGLEN / 2) | 0;
    setPixelColor(half, color_blend(SEGCOLOR(1), cfp(NOW, false, PSW(), 0), pixBri & 0xFFFF));
    for (let i = SEGLEN - 1; i > half; i--) setPixelColor(i, getPixelColor(i - 1));
    for (let i = 0; i < half; i++) setPixelColor(i, getPixelColor(i + 1));
  }
  return FRAMETIME;
}

//////////////////////
//   * PLASMOID (133)
//////////////////////
function mode_plasmoid() {
  const S = SEG;
  const ph = data('plp', Int16Array, 2);   // struct Plasphase { int16_t thisphase; int16_t thatphase; }
  const volumeSmth = bD_volumeSmth();
  fadeToBlackBy(32);
  ph[0] = toI16(ph[0] + beatsin8_t(6, -4, 4));
  ph[1] = toI16(ph[1] + beatsin8_t(7, -4, 4));
  const m1 = 1 + ((3 * S.speed / 32) | 0), m2 = 97 + ((5 * S.speed / 32) | 0);
  const lim = bD_F(bD_F(volumeSmth * S.intensity) / 64);
  for (let i = 0; i < SEGLEN; i++) {
    let thisbright = cubicwave8(((i * m1) + ph[0]) & 0xFF) >> 1;
    thisbright = (thisbright + (cos8_t(((i * m2) + ph[1]) & 0xFF) >> 1)) & 255;
    const colorIndex = thisbright;
    if (lim < thisbright) thisbright = 0;
    bD_addPixelColor(i, color_blend(SEGCOLOR(1), cfp(colorIndex, false, PSW(), 0), thisbright));
  }
  return FRAMETIME;
}

///////////////////////
//   * PUDDLEPEAK (144)
///////////////////////
function mode_puddlepeak() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  let size = 0;
  const fadeVal = map(S.speed, 0, 255, 224, 254) & 255;
  const pos = random16l(SEGLEN);
  const samplePeak = bD_samplePeak();
  const volumeSmth = bD_volumeSmth();
  // C++ call==0: custom1/custom2 <- *binNum / *maxVol*2, then written back to the usermod (peak-detector config).
  fade_out(fadeVal);
  if (samplePeak === 1) {
    size = Math.trunc(bD_F(bD_F(bD_F(bD_F(volumeSmth * S.intensity) / 256) / 4) + 1)) >>> 0;
    if (pos + size >= SEGLEN) size = SEGLEN - pos;
  }
  for (let i = 0; i < size; i++) setPixelColor(pos + i, cfp(NOW, false, PSW(), 0));
  return FRAMETIME;
}

//////////////////////
//   * PUDDLES (134)
//////////////////////
function mode_puddles() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  let size = 0;
  const fadeVal = map(S.speed, 0, 255, 224, 254) & 255;
  const pos = random16l(SEGLEN);
  fade_out(fadeVal);
  const volumeRaw = bD_volumeRaw();
  if (volumeRaw > 1) {
    size = ((((volumeRaw * S.intensity / 256) | 0) / 8) | 0) + 1;
    if (pos + size >= SEGLEN) size = SEGLEN - pos;
  }
  for (let i = 0; i < size; i++) setPixelColor(pos + i, cfp(NOW, false, PSW(), 0));
  return FRAMETIME;
}

//////////////////////
//     * PIXELS (128)
//////////////////////
function mode_pixels() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const myVals = data('pxv', Uint8Array, 32);
  const volumeSmth = bD_volumeSmth();
  myVals[NOW % 32] = bD_u8(volumeSmth);
  fade_out(64 + (S.speed >> 1));
  const n = (S.intensity / 8) | 0;
  const bl = bD_u16(volumeSmth);
  for (let i = 0; i < n; i++) {
    const segLoc = random16l(SEGLEN);
    setPixelColor(segLoc, color_blend(SEGCOLOR(1), cfp(myVals[i % 32] + i * 4, false, PSW(), 0), bl));
  }
  return FRAMETIME;
}

//////////////////////
//    ** Blurz (163)
//////////////////////
function mode_blurz() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const fftResult = AUD.fft;
  if (S.call === 0) { fill(BLACK); S.aux0 = 0; }
  const fadeoutDelay = ((256 - S.speed) / 32) | 0;
  if (fadeoutDelay <= 1 || (S.call % fadeoutDelay) === 0) fade_out(S.speed);
  S.step = (S.step + FRAMETIME) >>> 0;
  const SPEED_FORMULA_L = 5 + Math.floor((50 * (255 - S.speed)) / SEGLEN);
  if (S.step > SPEED_FORMULA_L) {
    const segLoc = random16l(SEGLEN);
    const f = fftResult[(S.aux0 & 0xFFFF) % 16];
    setPixelColor(segLoc, color_blend(SEGCOLOR(1), cfp(((2 * f * 240) / Math.max(1, SEGLEN - 1)) | 0, false, PSW(), 0), (2 * f) & 0xFFFF));
    S.aux0 = (((S.aux0 + 1) & 0xFFFF) % 16);
    S.step = 1;
    blur(S.intensity);
  }
  return FRAMETIME;
}

////////////////////
//   ** Freqmap (155)
////////////////////
function mode_freqmap() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  let FFT_MajorPeak = bD_majorPeak();
  const my_magnitude = bD_F(bD_magnitude() / 4.0);
  if (FFT_MajorPeak < 1) FFT_MajorPeak = 1;
  if (S.call === 0) fill(BLACK);
  const fadeoutDelay = ((256 - S.speed) / 32) | 0;
  if (fadeoutDelay <= 1 || (S.call % fadeoutDelay) === 0) fade_out(S.speed);
  const L = bD_F(bD_log10f(FFT_MajorPeak) - bD_C178), D = bD_F(bD_MAXF_LOG10 - bD_C178);
  let locn = Math.trunc(bD_F(bD_F(L * SEGLEN) / D));
  if (locn < 1) locn = 0;
  if (locn >= SEGLEN) locn = SEGLEN - 1;
  let pixCol = Math.trunc(bD_F(bD_F(L * 255.0) / D)) >>> 0;
  if (FFT_MajorPeak < 61.0) pixCol = 0;
  const bright = Math.trunc(my_magnitude) >>> 0;
  setPixelColor(locn, color_blend(SEGCOLOR(1), cfp((S.intensity + pixCol) & 0xFFFF, false, PSW(), 0), bright & 0xFFFF));
  return FRAMETIME;
}

///////////////////////
//   ** Freqmatrix (138)
///////////////////////
function mode_freqmatrix() {
  const S = SEG;
  let FFT_MajorPeak = bD_majorPeak();
  const volumeSmth = bD_volumeSmth();
  if (S.call === 0) fill(BLACK);
  const secondHand = (Math.floor(Math.floor(MICROS / (256 - S.speed)) / 500) % 16) & 255;
  if (S.aux0 !== secondHand) {
    S.aux0 = secondHand;
    const sensitivity = map(S.custom3, 0, 31, 1, 10) & 255;
    let pixVal = Math.trunc(bD_F(bD_F(bD_F(volumeSmth * S.intensity) * sensitivity) / 256.0));
    if (pixVal > 255) pixVal = 255;
    const intensity = bD_F(map(pixVal, 0, 255, 0, 100) / 100.0);
    let color = BLACK;
    if (FFT_MajorPeak > bD_MAX_FREQUENCY) FFT_MajorPeak = 1;
    if (FFT_MajorPeak < 80) {
      color = BLACK;
    } else {
      const upperLimit = 80 + 42 * S.custom2;
      const lowerLimit = 80 + 3 * S.custom1;
      const i = (lowerLimit !== upperLimit ? map(Math.trunc(FFT_MajorPeak), lowerLimit, upperLimit, 0, 255) : Math.trunc(FFT_MajorPeak)) & 255;
      let b = Math.trunc(bD_F(255 * intensity)) >>> 0;
      if (b > 255) b = 255;
      color = hsv2rgb(i, 240, b & 255);
    }
    setPixelColor(0, color);
    for (let i = SEGLEN - 1; i > 0; i--) setPixelColor(i, getPixelColor(i - 1));
  }
  return FRAMETIME;
}

//////////////////////
//   ** Freqpixels (141)
//////////////////////
function mode_freqpixels() {
  const S = SEG;
  let FFT_MajorPeak = bD_majorPeak();
  const my_magnitude = bD_F(bD_magnitude() / 16.0);
  if (FFT_MajorPeak < 1) FFT_MajorPeak = 1.0;
  let fadeRate = S.speed * S.speed;
  fadeRate = map(fadeRate, 0, 65535, 1, 255);
  const fadeoutDelay = ((256 - S.speed) / 64) | 0;
  if (fadeoutDelay <= 1 || (S.call % fadeoutDelay) === 0) fade_out(fadeRate & 255);
  let pixCol = bD_u8(bD_F(bD_F(bD_F(bD_log10f(FFT_MajorPeak) - bD_C178) * 255.0) / bD_F(bD_MAXF_LOG10 - bD_C178)));
  if (FFT_MajorPeak < 61.0) pixCol = 0;
  const n = ((S.intensity / 32) | 0) + 1;
  const bl = Math.trunc(my_magnitude) & 0xFFFF;
  for (let i = 0; i < n; i++) {
    const locn = random16r(0, SEGLEN);
    setPixelColor(locn, color_blend(SEGCOLOR(1), cfp(S.intensity + pixCol, false, PSW(), 0), bl));
  }
  return FRAMETIME;
}

///////////////////////
//    ** Gravfreq (158)
///////////////////////
function mode_gravfreq() {
  const S = SEG;
  if (SEGLEN === 1) return mode_static();
  const gc = data('gcf', Int32Array, 2);
  let FFT_MajorPeak = bD_majorPeak();
  const volumeSmth = bD_volumeSmth();
  if (FFT_MajorPeak < 1) FFT_MajorPeak = 1;
  fade_out(250);
  let ssa = bD_F(bD_F(volumeSmth * S.intensity) / 255.0);
  ssa = bD_F(ssa * 0.125);
  const msa = bD_mapf(bD_F(ssa * 2.0), 0, 32, 0, bD_F(SEGLEN / 2.0));
  const tempsamp = Math.trunc(constrain(msa, 0, (SEGLEN / 2) | 0));
  const gravity = (8 - ((S.speed / 32) | 0)) & 255;
  const half = (SEGLEN / 2) | 0;
  // uint8_t index = (log10f(FFT_MajorPeak) - (MAX_FREQ_LOG10 - 1.78f)) * 255;  (usually negative -> wraps)
  const index = bD_u8(bD_F(bD_F(bD_log10f(FFT_MajorPeak) - bD_F(bD_MAXF_LOG10 - bD_C178)) * 255));
  for (let i = 0; i < tempsamp; i++) {
    setPixelColor(i + half, cfp(index, false, PSW(), 0));
    setPixelColor(half - i - 1, cfp(index, false, PSW(), 0));
  }
  if (tempsamp >= gc[0]) gc[0] = tempsamp - 1;
  else if (gc[1] % gravity === 0) gc[0]--;
  if (gc[0] >= 0) {
    setPixelColor(gc[0] + half, bD_GRAY);
    setPixelColor(half - 1 - gc[0], bD_GRAY);
  }
  gc[1] = (gc[1] + 1) % gravity;
  return FRAMETIME;
}

//////////////////////
//   ** Noisemove (145)
//////////////////////
function mode_noisemove() {
  const S = SEG;
  const fftResult = AUD.fft;
  const fadeoutDelay = ((256 - S.speed) / 96) | 0;
  if (fadeoutDelay <= 1 || (S.call % fadeoutDelay) === 0) fadeToBlackBy(4 + ((S.speed / 4) | 0));
  const numBins = map(S.intensity, 0, 255, 0, 16) & 255;
  const ns = mul32(NOW, S.speed);
  for (let i = 0; i < numBins; i++) {
    let locn = inoise16_2((ns + i * 50000) >>> 0, ns);
    locn = map(locn, 7500, 58000, 0, SEGLEN - 1) >>> 0;   // negative -> huge unsigned -> int: setPixelColor drops it
    setPixelColor(locn | 0, color_blend(SEGCOLOR(1), cfp(i * 64, false, PSW(), 0), (fftResult[i % 16] * 4) & 0xFFFF));
  }
  return FRAMETIME;
}

//////////////////////
//   ** Rocktaves (185)
//////////////////////
function mode_rocktaves() {
  const S = SEG;
  const FFT_MajorPeak = bD_majorPeak();
  const my_magnitude = bD_F(bD_magnitude() / 16.0);
  fadeToBlackBy(16);
  let frTemp = FFT_MajorPeak;
  let octCount = 0;
  let volTemp = bD_u8(bD_F(32.0 + bD_F(my_magnitude * 1.5)));
  if (my_magnitude < 48) volTemp = 0;
  if (my_magnitude > 144) volTemp = 255;
  while (frTemp > 249) {
    octCount = (octCount + 1) & 255;
    frTemp = bD_F(frTemp / 2);
  }
  frTemp = bD_F(frTemp - 132.0);
  frTemp = Math.abs(bD_F(frTemp * bD_F(2.1)));
  let i = map(beatsin8_t((8 + octCount * 4) & 0xFFFF, 0, 255, 0, (octCount * 8) & 255), 0, 255, 0, SEGLEN - 1) >>> 0;
  i = constrain(i, 0, SEGLEN - 1);
  bD_addPixelColor(i, color_blend(SEGCOLOR(1), cfp(bD_u8(frTemp), false, PSW(), 0), volTemp));
  return FRAMETIME;
}

// names / fxdata strings (FX.cpp _data_FX_MODE_*) for FX_NAMES / FX_META
const bD_FX_NAMES = { 128: 'Pixels', 129: 'Pixelwave', 130: 'Juggles', 131: 'Matripix', 132: 'Gravimeter', 133: 'Plasmoid',
  134: 'Puddles', 135: 'Midnoise', 136: 'Noisemeter', 138: 'Freqmatrix', 141: 'Freqpixels', 144: 'Puddlepeak', 145: 'Noisemove',
  148: 'Ripple Peak', 155: 'Freqmap', 157: 'Gravcentric', 158: 'Gravfreq', 163: 'Blurz', 185: 'Rocktaves' };
const bD_FX_META = {
  128: 'Fade rate,# of pixels;!,!;!;1v;m12=0,si=0',
  129: '!,Sensitivity;!,!;!;1v;ix=64,m12=2,si=0',
  130: '!,# of balls;!,!;!;01v;m12=0,si=0',
  131: '!,Brightness;!,!;!;1v;ix=64,m12=2,si=1',
  132: 'Rate of fall,Sensitivity;!,!;!;1v;ix=128,m12=2,si=0',
  133: 'Phase,# of pixels;!,!;!;01v;sx=128,ix=128,m12=0,si=0',
  134: 'Fade rate,Puddle size;!,!;!;1v;m12=0,si=0',
  135: 'Fade rate,Max. length;!,!;!;1v;ix=128,m12=1,si=0',
  136: 'Fade rate,Width;!,!;!;1v;ix=128,m12=2,si=0',
  138: 'Speed,Sound effect,Low bin,High bin,Sensitivity;;;01f;m12=3,si=0',
  141: 'Fade rate,Starting color and # of pixels;!,!,;!;1f;m12=0,si=0',
  144: 'Fade rate,Puddle size,Select bin,Volume (min);!,!;!;1v;c2=0,m12=0,si=0',
  145: 'Speed of perlin movement,Fade rate;!,!;!;01f;m12=0,si=0',
  148: 'Fade rate,Max # of ripples,Select bin,Volume (min);!,!;!;1v;c2=0,m12=0,si=0',
  155: 'Fade rate,Starting color;!,!;!;1f;m12=0,si=0',
  157: 'Rate of fall,Sensitivity;!,!;!;1v;ix=128,m12=3,si=0',
  158: 'Rate of fall,Sensitivity;!,!;!;1f;ix=128,m12=0,si=0',
  163: 'Fade rate,Blur;!,Color mix;!;1f;m12=0,si=0',
  185: ';!,!;!;01f;m12=1,si=0'
};

// =====================================================================================================================
const FX = {
  0:   { fn: mode_static, tb: true },
  2:   { fn: mode_breath, tb: true },
  12:  { fn: mode_fade, tb: true },
  15:  { fn: mode_running_lights, tb: true },
  17:  { fn: mode_twinkle },
  20:  { fn: mode_sparkle },
  22:  { fn: mode_hyper_sparkle },
  33:  { fn: mode_chase_rainbow_white },
  34:  { fn: mode_colorful, tb: true },
  38:  { fn: mode_aurora },
  42:  { fn: mode_fireworks },
  43:  { fn: mode_rain },
  46:  { fn: mode_gradient, tb: true },
  51:  { fn: mode_fairytwinkle, tb: true },
  57:  { fn: mode_lightning },
  63:  { fn: mode_pride_2015 },
  64:  { fn: mode_juggle },
  65:  { fn: mode_palette, tb: true },
  66:  { fn: mode_fire_2012 },
  67:  { fn: mode_colorwaves },
  68:  { fn: mode_bpm, tb: true },
  70:  { fn: mode_noise16_1 },
  71:  { fn: mode_noise16_2 },
  72:  { fn: mode_noise16_3 },
  74:  { fn: mode_colortwinkle },
  75:  { fn: mode_lake, tb: true },
  76:  { fn: mode_meteor },
  77:  { fn: mode_meteor_smooth },
  79:  { fn: mode_ripple },
  80:  { fn: () => twinklefox_base(false), tb: true },
  81:  { fn: () => twinklefox_base(true), tb: true },
  83:  { fn: mode_static_pattern, tb: true },
  84:  { fn: mode_tri_static_pattern, tb: true },
  87:  { fn: mode_glitter },
  88:  { fn: () => candle(false) },
  89:  { fn: mode_starburst },
  90:  { fn: mode_exploding_fireworks },
  91:  { fn: mode_bouncing_balls },
  92:  { fn: () => sinelon_base(false) },
  94:  { fn: () => sinelon_base(true) },
  95:  { fn: mode_popcorn },
  96:  { fn: mode_drip },
  97:  { fn: mode_plasma, tb: true },
  99:  { fn: mode_ripple_rainbow },
  100: { fn: mode_heartbeat },
  101: { fn: mode_pacifica },
  102: { fn: () => candle(true) },
  104: { fn: mode_sunrise, tb: true },
  106: { fn: mode_twinkleup, tb: true },
  107: { fn: mode_noisepal },
  110: { fn: mode_flow, tb: true },
  112: { fn: mode_dancing_shadows },
  115: { fn: mode_blends },
  117: { fn: mode_dynamic_smooth },
  147: { fn: mode_perlinmove },
  156: { fn: mode_gravcenter, audio: true },
  159: { fn: mode_DJLight, audio: true },
  143: { fn: mode_noisefire, audio: true },
  140: { fn: mode_waterfall, audio: true },
  137: { fn: mode_freqwave, audio: true },
  1:  { fn: mode_blink },
  3:  { fn: mode_color_wipe, tb: true },
  4:  { fn: mode_color_wipe_random },
  5:  { fn: mode_random_color },
  6:  { fn: mode_color_sweep, tb: true },
  7:  { fn: mode_dynamic },
  8:  { fn: mode_rainbow, tb: true },
  9:  { fn: mode_rainbow_cycle, tb: true },
  10: { fn: mode_scan },
  11: { fn: mode_dual_scan },
  13: { fn: mode_theater_chase },
  14: { fn: mode_theater_chase_rainbow },
  16: { fn: mode_saw, tb: true },
  18: { fn: mode_dissolve },
  19: { fn: mode_dissolve_random },
  21: { fn: mode_flash_sparkle },
  23: { fn: mode_strobe },
  24: { fn: mode_strobe_rainbow },
  25: { fn: mode_multi_strobe },
  26: { fn: mode_blink_rainbow },
  27: { fn: mode_android },
  28: { fn: mode_chase_color },
  29: { fn: mode_chase_random },
  30: { fn: mode_chase_rainbow },
  31: { fn: mode_chase_flash },
  32: { fn: mode_chase_flash_random },
  35:  { fn: mode_traffic_light },
  36:  { fn: mode_color_sweep_random },
  37:  { fn: mode_running_color },
  39:  { fn: mode_running_random },
  40:  { fn: mode_larson_scanner },
  41:  { fn: mode_comet },
  44:  { fn: mode_tetrix },
  45:  { fn: mode_fire_flicker },
  47:  { fn: mode_loading, tb: true },
  48:  { fn: rolling_balls },
  49:  { fn: mode_fairy },
  50:  { fn: mode_two_dots },
  52:  { fn: mode_running_dual, tb: true },
  54:  { fn: mode_tricolor_chase, tb: true },
  55:  { fn: mode_tricolor_wipe, tb: true },
  56:  { fn: mode_tricolor_fade, tb: true },
  58:  { fn: mode_icu },
  59:  { fn: mode_multi_comet },
  60:  { fn: mode_dual_larson_scanner },
  61:  { fn: mode_random_chase },
  62:  { fn: mode_oscillate },
  69:  { fn: mode_fillnoise8 },
  73:  { fn: mode_noise16_4, tb: true },
  78:  { fn: mode_railway },
  85:  { fn: mode_spots, tb: true },
  86:  { fn: mode_spots_fade, tb: true },
  93:  { fn: mode_sinelon_dual },
  98:  { fn: mode_percent },
  103: { fn: mode_solid_glitter },
  105: { fn: mode_phased },
  108: { fn: mode_sinewave },
  109: { fn: mode_phased_noise },
  111: { fn: mode_chunchun },
  113: { fn: mode_washing_machine },
  116: { fn: mode_tv_simulator },
  179: { fn: mode_FlowStripe, tb: true },
  184: { fn: mode_wavesins, tb: true },
  128: { fn: mode_pixels, audio: true },
  129: { fn: mode_pixelwave, audio: true },
  130: { fn: mode_juggles, audio: true },
  131: { fn: mode_matripix, audio: true },
  132: { fn: mode_gravimeter, audio: true },
  133: { fn: mode_plasmoid, audio: true },
  134: { fn: mode_puddles, audio: true },
  135: { fn: mode_midnoise, audio: true },
  136: { fn: mode_noisemeter, audio: true },
  138: { fn: mode_freqmatrix, audio: true },
  141: { fn: mode_freqpixels, audio: true },
  144: { fn: mode_puddlepeak, audio: true },
  145: { fn: mode_noisemove, audio: true },
  148: { fn: mode_ripplepeak, audio: true },
  155: { fn: mode_freqmap, audio: true },
  157: { fn: mode_gravcentric, audio: true },
  158: { fn: mode_gravfreq, audio: true },
  163: { fn: mode_blurz, audio: true },
  185: { fn: mode_rocktaves, audio: true }
};
const APPROX = [
  { id: 156, reason: 'audio-reactive: algorithm ported 1:1, but volumeSmth comes from P.audio (or WLED simulateSound) instead of the AR usermod' },
  { id: 159, reason: 'audio-reactive: fftResult[] comes from P.audio.fft (or simulateSound BeatSin)' },
  { id: 143, reason: 'audio-reactive: volumeSmth from P.audio' },
  { id: 140, reason: 'audio-reactive: FFT_MajorPeak / FFT_Magnitude are derived from P.audio.fft (argmax bin centre, max bin) unless P.audio.majorPeak / magnitude are given' },
  { id: 128, reason: 'audio-reactive: volumeSmth from P.audio (or simulateSound BeatSin)' },
  { id: 129, reason: 'audio-reactive: volumeRaw = (int16)(uint16)volumeSmth (as simulateSound does); the AR usermod would supply the unsmoothed sample' },
  { id: 130, reason: 'audio-reactive: volumeSmth from P.audio' },
  { id: 131, reason: 'audio-reactive: volumeRaw = (int16)(uint16)volumeSmth (as simulateSound does) unless P.audio.volumeRaw is given' },
  { id: 132, reason: 'audio-reactive: volumeSmth from P.audio' },
  { id: 133, reason: 'audio-reactive: volumeSmth from P.audio' },
  { id: 134, reason: 'audio-reactive: volumeRaw = (int16)(uint16)volumeSmth (as simulateSound does) unless P.audio.volumeRaw is given' },
  { id: 135, reason: 'audio-reactive: volumeSmth from P.audio' },
  { id: 136, reason: 'audio-reactive: volumeSmth from P.audio; volumeRaw derived from volumeSmth (as simulateSound does)' },
  { id: 138, reason: 'audio-reactive: FFT_MajorPeak derived from P.audio.fft (argmax GEQ bin centre) unless P.audio.majorPeak is given' },
  { id: 141, reason: 'audio-reactive: FFT_MajorPeak / FFT_Magnitude derived from P.audio.fft (argmax bin centre, max bin*8) unless given' },
  { id: 144, reason: 'audio-reactive: samplePeak = P.audio.peak; the call-0 custom1/custom2 <- binNum/maxVol UI feedback (peak-detector bin/threshold) is not emulated' },
  { id: 145, reason: 'audio-reactive: fftResult[] from P.audio.fft' },
  { id: 148, reason: 'audio-reactive: samplePeak = P.audio.peak, FFT_MajorPeak derived from P.audio.fft; call-0 custom1/custom2 <- binNum/maxVol UI feedback not emulated' },
  { id: 155, reason: 'audio-reactive: FFT_MajorPeak / FFT_Magnitude derived from P.audio.fft unless given' },
  { id: 157, reason: 'audio-reactive: volumeSmth from P.audio' },
  { id: 158, reason: 'audio-reactive: volumeSmth + FFT_MajorPeak (derived from P.audio.fft); negative float->uint8 index wraps like the ESP32 build (trunc & 255)' },
  { id: 163, reason: 'audio-reactive: fftResult[] from P.audio.fft' },
  { id: 185, reason: 'audio-reactive: FFT_MajorPeak / FFT_Magnitude derived from P.audio.fft unless given' },
  { id: 137, reason: 'audio-reactive: FFT_MajorPeak derived from P.audio.fft unless P.audio.majorPeak is given' }
];
const PALETTE_APPROX = { 1: '* Random Cycle: same harmonic-random generator as WLED but seeded deterministically per 6 s epoch (the device uses its own RNG, so colours will differ)' };

// =====================================================================================================================
// audio input
// =====================================================================================================================
const GEQ_HZ = [60, 105, 170, 255, 360, 490, 680, 960, 1270, 1640, 2140, 2700, 3340, 4070, 5640, 8110];
const SIM_FFT = new Uint8Array(16);
function prepareAudio(inst, P) {
  const a = inst.aud;
  const A = P && P.audio;
  if (A && (A.fft || A.volume !== undefined)) {
    const fft = A.fft || SIM_FFT;
    for (let i = 0; i < 16; i++) a.fft[i] = fft[i] | 0;
    a.volumeSmth = +A.volume || 0;
    a.samplePeak = !!A.peak;
    let mx = 0, mi = 0; for (let i = 0; i < 16; i++) if (a.fft[i] > mx) { mx = a.fft[i]; mi = i; }
    a.majorPeak = A.majorPeak !== undefined ? +A.majorPeak : (mx > 0 ? GEQ_HZ[mi] : 1);
    a.magnitude = A.magnitude !== undefined ? +A.magnitude : mx * 8;
    a.sim = false;
  } else a.sim = true;
}
function simulateSound(a) {   // util.cpp simulateSound(UMS_BeatSin)
  for (let i = 0; i < 16; i++) a.fft[i] = beatsin8_t((120 / (i + 1)) | 0, 0, 255);
  a.volumeSmth = a.fft[8];
  a.samplePeak = random8() > 250;
  a.majorPeak = 21 + (a.volumeSmth * a.volumeSmth) / 8;
  a.magnitude = a.volumeSmth < 1 ? 0.001 : 10000 / 8;
}

// =====================================================================================================================
// instance / scheduler
// =====================================================================================================================
let seedCounter = 0x1234;
function Instance(fxId, n) {
  fxId = fxId | 0; n = Math.max(1, n | 0);
  if (!FX[fxId]) throw new Error('TLFX: unsupported effect id ' + fxId);
  this.fx = fxId; this.n = n; this.def = FX[fxId];
  this.mode = fxId; this.len = n;
  this.phys = new Int32Array(n);
  this.out = new Uint8Array(n * 3);
  this.acc = new Uint32Array(n * 3);
  this.pal = new Uint8Array(48); this.palKey = '';
  this.col = [0xFFAA00, 0, 0]; this.colT = [gamma32(0xFFAA00), 0, 0];
  this.speed = 128; this.intensity = 128; this.custom1 = 128; this.custom2 = 128; this.custom3 = 16;
  this.check1 = false; this.check2 = false; this.check3 = false;
  this.palette = 0; this.grouping = 1; this.spacing = 0; this.offset = 0; this.reverse = false; this.mirror = false; this.opacity = 255;
  seedCounter = (Math.imul(seedCounter, 40503) + 0x3779) & 0xFFFF;
  this.seed = seedCounter || 1;
  this.aud = { fft: new Uint8Array(16), volumeSmth: 0, samplePeak: false, majorPeak: 1, magnitude: 0, sim: true };
  this.simT = NaN;
  this.resetRuntime();
}
Instance.prototype.resetRuntime = function () {
  this.call = 0; this.step = 0; this.aux0 = 0; this.aux1 = 0; this.next_time = 0; this.st = {};
  this.phys.fill(0);
};
Instance.prototype.reset = function () { this.resetRuntime(); this.simT = NaN; this.out.fill(0); };
function colPack(c, d) {
  if (c == null) return d;
  if (typeof c === 'number') return c & 0xFFFFFF;
  return RGB(c[0] | 0, c[1] | 0, c[2] | 0);
}
Instance.prototype.apply = function (P) {
  P = P || {};
  const num = (v, d) => (v === undefined || v === null || isNaN(v)) ? d : (v | 0) & 255;
  this.speed = num(P.sx, 128); this.intensity = num(P.ix, 128);
  this.custom1 = num(P.c1, 128); this.custom2 = num(P.c2, 128); this.custom3 = Math.min(31, num(P.c3, 16));
  this.check1 = !!P.o1; this.check2 = !!P.o2; this.check3 = !!P.o3;
  let pal = P.pal === undefined ? 0 : P.pal | 0; if (pal < 0 || (pal > 70 && !(pal >= 246 && pal <= 255) && pal < 1000)) pal = 0;   // keep custom ids (controller slots 246-255, app previews ≥1000)
  this.palette = pal;
  const col = P.col || [];
  const c0 = colPack(col[0], 0xFFAA00), c1 = colPack(col[1], 0), c2 = colPack(col[2], 0);
  if (c0 !== this.col[0] || c1 !== this.col[1] || c2 !== this.col[2]) {
    this.col[0] = c0; this.col[1] = c1; this.col[2] = c2;
    this.colT[0] = gamma32(c0); this.colT[1] = gamma32(c1); this.colT[2] = gamma32(c2);
  }
  this.opacity = P.bri === undefined ? 255 : num(P.bri, 255);
  this.slow = Math.max(1, Math.min(64, (+P.slow || 1) * (CFG.slowMul || 1)));   // × evening-drift slow-down
  const grp = Math.max(1, P.grp === undefined ? 1 : P.grp | 0), spc = Math.max(0, P.spc === undefined ? 0 : P.spc | 0);
  const rev = !!P.rev, mi = !!P.mi, of = Math.max(0, (P.of | 0) || 0) % this.len;
  if (grp !== this.grouping || spc !== this.spacing || rev !== this.reverse || mi !== this.mirror || of !== this.offset) {
    this.grouping = grp; this.spacing = spc; this.reverse = rev; this.mirror = mi; this.offset = of;
    this.resetRuntime();   // Segment::setGeometry → fill(BLACK) + markForReset()
  }
};
Instance.prototype.vlen = function () {
  const gl = this.grouping + this.spacing;
  let v = ((this.len + gl - 1) / gl) | 0;
  if (this.mirror) v = (v + 1) >> 1;
  return v;
};
Instance.prototype.loadPal = function (ms) {
  const p = this.palette;
  let key;
  if (p === 1) key = '1:' + Math.floor(ms / ((CFG.randomPaletteChangeTime + 1) * 1000));
  else if (p >= 2 && p <= 5) key = p + ':' + this.col[0] + ',' + this.col[1] + ',' + this.col[2] + (CFG.gammaCorrectCol ? 'g' : '');
  else if (p >= 246) key = p + ':c' + CUSTOM_VER;   // custom palettes: rebuild when any is redefined
  else key = p + ':' + this.mode;
  if (key !== this.palKey) { buildPalette(this.pal, p, this.mode, this.col, ms); this.palKey = key; }
};
// one WLED service() tick at simulated time t (ms, float)
Instance.prototype.tick = function (t) {
  const nowUp = Math.floor(t);
  if (nowUp < this.next_time) return false;
  SEG = this; SEGLEN = this.vlen();
  // slow motion (Trimlight Studio WLED patch): the segment runs on its own clock at 1/slow speed
  const sl = this.slow > 1 ? this.slow : 1;
  if (sl > 1) {
    if (!this.vLast || nowUp < this.vLast) { this.vLast = nowUp; this.vNow = nowUp; }
    const adv = Math.floor((nowUp - this.vLast) / sl); this.vNow += adv; this.vLast += adv * sl;
    NOW = this.vNow >>> 0;
  } else { this.vLast = 0; NOW = nowUp >>> 0; }
  MILLIS = NOW; MICROS = Math.floor(t * 1000) >>> 0;
  FRAMETIME = CFG.frameTime;
  SEED = this.seed;
  this.loadPal(nowUp);
  if (this.def.audio) { AUD = this.aud; if (this.aud.sim) simulateSound(this.aud); }
  let delay = this.def.fn();
  this.seed = SEED;
  this.call = (this.call + 1) >>> 0;
  this.next_time = nowUp + (delay | 0) * Math.min(Math.round(sl), 8);   // frame-stepped effects: longer gaps, never under ~30 fps (firmware rounds the factor)
  return true;
};
Instance.prototype.render = function (P, nowMs) {
  this.apply(P);
  if (this.def.audio) prepareAudio(this, P);
  nowMs = +nowMs;
  if (!isFinite(nowMs)) nowMs = 0;
  const fps = Math.max(1, (P && P.simFps) || CFG.simFps);
  const dt = 1000 / fps;
  if (isNaN(this.simT) || nowMs < this.simT - 2000) { this.simT = nowMs - dt; this.next_time = 0; }
  if (nowMs - this.simT > CFG.maxCatchupMs) this.simT = nowMs - CFG.maxCatchupMs;
  const n = this.len, phys = this.phys, out = this.out;
  if (this.def.tb) {
    this.simT = nowMs;
    this.next_time = 0;
    this.tick(nowMs);
    for (let k = 0, o = 0; k < n; k++, o += 3) { const c = phys[k]; out[o] = (c >> 16) & 255; out[o + 1] = (c >> 8) & 255; out[o + 2] = c & 255; }
    return out;
  }
  const acc = this.acc, integ = CFG.integrate && !(P && P.integrate === false);
  let cnt = 0;
  if (integ) acc.fill(0);
  while (this.simT + dt <= nowMs + 1e-6) {
    this.simT += dt;
    this.tick(this.simT);
    cnt++;
    if (integ) for (let k = 0, o = 0; k < n; k++, o += 3) { const c = phys[k]; acc[o] += (c >> 16) & 255; acc[o + 1] += (c >> 8) & 255; acc[o + 2] += c & 255; }
  }
  if (cnt === 0) return out;
  if (integ && cnt > 1) { const inv = 1 / cnt; for (let k = 0; k < n * 3; k++) out[k] = (acc[k] * inv + 0.5) | 0; }
  else for (let k = 0, o = 0; k < n; k++, o += 3) { const c = phys[k]; out[o] = (c >> 16) & 255; out[o + 1] = (c >> 8) & 255; out[o + 2] = c & 255; }
  return out;
};

// =====================================================================================================================
// public API
// =====================================================================================================================
const TMP_PAL = new Uint8Array(48);
function paletteCss(palId, col) {
  palId = palId | 0;
  const c = [colPack(col && col[0], 0xFFAA00), colPack(col && col[1], 0), colPack(col && col[2], 0)];
  buildPalette(TMP_PAL, palId, -1, c, Date.now());
  const hex = v => '#' + (0x1000000 + v).toString(16).slice(1);
  const stops = [];
  for (let k = 0; k < 16; k++) {
    const v = (TMP_PAL[k * 3] << 16) | (TMP_PAL[k * 3 + 1] << 8) | TMP_PAL[k * 3 + 2];
    stops.push(hex(v) + ' ' + (k * 16 / 255 * 100).toFixed(2) + '%');
  }
  stops.push(hex(CFP(TMP_PAL, 255, 255, 1)) + ' 100%');
  return 'linear-gradient(90deg, ' + stops.join(', ') + ')';
}
function paletteRGB(palId, col, mode) {   // 16-entry CRGBPalette16 as used by the engine
  const c = [colPack(col && col[0], 0xFFAA00), colPack(col && col[1], 0), colPack(col && col[2], 0)];
  return Array.from(buildPalette(new Uint8Array(48), palId | 0, mode === undefined ? -1 : mode, c, Date.now()));
}
const supported = Object.keys(FX).map(Number).sort((a, b) => a - b);
const names = {}; for (const id of supported) names[id] = FX_NAMES[id];
const TLFX = {
  version: 'WLED-1D',
  create: (fxId, n) => new Instance(fxId, n),
  supported,
  names,
  meta: FX_META,            // WLED fxdata strings (slider labels;colors;palette;flags;defaults)
  palNames: PAL_NAMES,
  approx: APPROX,
  paletteApprox: PALETTE_APPROX,
  paletteCss,
  setCustomPalette,
  paletteRGB,
  config: CFG,
  setGamma(g) { CFG.gamma = +g || 2.8; calcGamma(CFG.gamma); },
  _internals: { sin8_t, sin16_t, inoise8_2, inoise16_2, inoise16_3, hsv2rgb, CFP, FIXED, GAMMA }
};
root.TLFX = TLFX;
if (typeof module !== 'undefined' && module.exports) module.exports = TLFX;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
