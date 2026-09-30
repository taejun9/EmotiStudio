import sharp, { type OverlayOptions } from 'sharp';
import { STICKER_PLANS } from '../shared/sticker-plans.ts';
import type { FrameAnimationOptions } from './frame-animation.ts';

export type BuiltInCharacter = 'neulbo' | 'tokki';
export interface CharacterStickerOptions {
  animated: boolean;
  variant?: number;
}
export interface StaticCharacterSticker {
  png: Buffer;
}
export interface AnimatedCharacterSticker {
  sheet: Buffer;
  options: FrameAnimationOptions;
}

type Point = { x: number; y: number };
type Layout = {
  hx: number;
  hy: number;
  tilt: number;
  bx: number;
  by: number;
  rx: number;
  ry: number;
  feet: [Point, Point];
};
const INK = '#654A3D';
const DARK = '#49342D';
const CREAM = '#FFF4DE';
const MINT = '#B2D5BF';
const PINK = '#EDABAB';
const GOLD = '#F2CE7B';
const BLUE = '#A9CFDF';

const n = (value: number) => Number(value.toFixed(2));
const p = (x: number, y: number): Point => ({ x: n(x), y: n(y) });
const ellipse = (
  x: number,
  y: number,
  rx: number,
  ry: number,
  fill: string,
  stroke = INK,
  width = 4.5,
) =>
  `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`;
const path = (d: string, fill = 'none', stroke = INK, width = 4.5) =>
  `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string,
  stroke = INK,
  line = 4.5,
) =>
  `<rect x="${n(x)}" y="${n(y)}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${line}"/>`;
const group = (contents: string, transform: string) =>
  `<g transform="${transform}">${contents}</g>`;
const spark = (x: number, y: number, size = 10, color = GOLD) =>
  path(
    `M${x} ${y - size} Q${x + 2} ${y - 2} ${x + size} ${y} Q${x + 2} ${y + 2} ${x} ${y + size} Q${x - 2} ${y + 2} ${x - size} ${y} Q${x - 2} ${y - 2} ${x} ${y - size}Z`,
    color,
    'none',
  );
const heart = (x: number, y: number, scale = 1, color = PINK) =>
  group(
    path(
      'M0 20 C-12 8 -37 -8 -34 -27 C-31 -48 -8 -48 0 -32 C8 -48 31 -48 34 -27 C37 -8 12 8 0 20Z',
      color,
    ),
    `translate(${x} ${y}) scale(${scale})`,
  );
const flower = (x: number, y: number, scale = 1) =>
  group(
    path('M0 0 Q-8 27 2 47', 'none', '#759C79', 5) +
      path('M-2 25 Q-23 10 -21 28 Q-11 38 -2 31', MINT, '#759C79', 2.5) +
      [-90, -18, 54, 126, 198]
        .map((angle) => group(ellipse(0, -10, 8, 12, '#F3B6B3', INK, 2.5), `rotate(${angle})`))
        .join('') +
      ellipse(0, 0, 8, 8, GOLD, INK, 2.5),
    `translate(${x} ${y}) scale(${scale})`,
  );

function layoutFor(id: string): Layout {
  const layout: Layout = {
    hx: 180,
    hy: 139,
    tilt: 0,
    bx: 180,
    by: 239,
    rx: 56,
    ry: 61,
    feet: [p(142, 298), p(218, 298)],
  };
  if (
    [
      'hello',
      'cheer',
      'surprise',
      'angry',
      'okay',
      'no',
      'yes',
      'welcome',
      'proud',
      'exercise',
      'promise',
    ].includes(id)
  ) {
    layout.hy = 130;
    layout.by = 229;
    layout.ry = 65;
  }
  if (id === 'sleepy')
    Object.assign(layout, {
      hx: 228,
      hy: 211,
      tilt: 18,
      bx: 158,
      by: 274,
      rx: 69,
      ry: 34,
      feet: [p(101, 292), p(126, 301)],
    });
  if (id === 'thanks') Object.assign(layout, { hy: 155, tilt: 9, by: 248 });
  if (id === 'sorry')
    Object.assign(layout, {
      hy: 160,
      tilt: -6,
      by: 256,
      rx: 51,
      ry: 51,
      feet: [p(158, 309), p(202, 309)],
    });
  if (id === 'laugh')
    Object.assign(layout, {
      hx: 183,
      hy: 144,
      tilt: -14,
      bx: 173,
      by: 248,
      feet: [p(132, 301), p(216, 298)],
    });
  if (id === 'cry')
    Object.assign(layout, { hy: 153, tilt: 4, by: 254, feet: [p(140, 309), p(220, 309)] });
  if (id === 'hungry')
    Object.assign(layout, { hy: 144, tilt: -6, by: 246, feet: [p(133, 305), p(227, 305)] });
  if (id === 'yummy') Object.assign(layout, { hx: 176, hy: 138, tilt: -8 });
  if (id === 'coffee')
    Object.assign(layout, { hy: 148, tilt: 6, by: 253, feet: [p(146, 311), p(214, 311)] });
  if (id === 'busy') Object.assign(layout, { hy: 150, by: 253 });
  if (id === 'hurry')
    Object.assign(layout, {
      hx: 190,
      hy: 132,
      tilt: -9,
      bx: 183,
      by: 227,
      ry: 55,
      feet: [p(117, 294), p(240, 270)],
    });
  if (id === 'waiting')
    Object.assign(layout, { hx: 174, hy: 146, tilt: 9, by: 248, feet: [p(145, 309), p(217, 309)] });
  if (id === 'tired')
    Object.assign(layout, {
      hy: 176,
      tilt: -8,
      by: 271,
      rx: 62,
      ry: 39,
      feet: [p(115, 310), p(246, 310)],
    });
  if (id === 'confused') Object.assign(layout, { hx: 176, hy: 137, tilt: -12 });
  if (id === 'celebrate') Object.assign(layout, { hy: 146, by: 246 });
  if (id === 'goodnight')
    Object.assign(layout, { hx: 174, hy: 158, tilt: 9, by: 263, feet: [p(149, 315), p(212, 315)] });
  if (id === 'goodbye')
    Object.assign(layout, {
      hx: 172,
      hy: 137,
      tilt: -7,
      bx: 171,
      feet: [p(131, 302), p(208, 302)],
    });
  if (id === 'shy')
    Object.assign(layout, { hy: 149, tilt: 11, by: 246, feet: [p(158, 307), p(203, 307)] });
  if (id === 'rainy')
    Object.assign(layout, {
      hy: 180,
      tilt: -6,
      by: 273,
      rx: 51,
      ry: 39,
      feet: [p(152, 318), p(208, 318)],
    });
  if (id === 'sick')
    Object.assign(layout, { hy: 166, by: 264, rx: 61, ry: 46, feet: [p(143, 316), p(218, 316)] });
  if (id === 'birthday') Object.assign(layout, { hy: 138, tilt: 3 });
  return layout;
}

function handsFor(id: string, l: Layout, gesture: number, variant: number): [Point, Point] {
  const x = l.bx,
    y = l.by;
  const left = (dx: number, dy: number) => p(x + dx, y + dy);
  const hands: Record<string, [Point, Point]> = {
    hello: [left(-85 - gesture * 6, -91 - gesture * 7), left(58, 34)],
    love: [left(-30 - gesture * 2, 21), left(30 + gesture * 2, 21)],
    sleepy: [p(202, 278), p(265 + gesture * 2, 265)],
    thanks: [left(-15 - gesture, -1 - gesture * 3), left(16 + gesture, -1 - gesture * 3)],
    cheer: [left(-79, -76 - gesture * 8), left(79, -76 + gesture * 8)],
    sorry: [left(-14 - gesture * 2, 6), left(13 + gesture * 2, 10)],
    laugh: [left(-13, 8 + gesture * 2), p(l.hx + 41, l.hy + 32 + gesture * 3)],
    cry: [p(l.hx - 44 + gesture * 3, l.hy + 17), left(50, 21)],
    surprise: [left(-91 - gesture * 3, -37), left(91 + gesture * 3, -37)],
    angry: [left(-51 - gesture * 4, 13), left(51, 13)],
    okay: [left(-71, -78 - gesture * 4), left(48, 17)],
    no: [left(22 + gesture * 2, -27), left(-22 - gesture * 2, -27)],
    yes: [left(-62, -3 - gesture * 4), left(62, -3 + gesture * 4)],
    hungry: [left(-50, 0), left(70, -46 + gesture * 5)],
    yummy: [left(-55, -57 + gesture * 6), p(l.hx + 53, l.hy + 27)],
    coffee: [left(-30 - gesture, -7), left(30 + gesture, -7)],
    busy: [left(-37, 16 + gesture * 2), left(37, 16 - gesture * 2)],
    hurry: [left(-72 - gesture * 4, -12 + gesture * 4), left(69 + gesture * 4, -70 - gesture * 5)],
    waiting: [p(l.hx - 32, l.hy + 51 + gesture * 2), left(49, 17)],
    tired: [left(-84, 17), left(84, 17)],
    confused: [p(l.hx - 73 + gesture * 2, l.hy - 4), left(78, -7 - gesture * 3)],
    celebrate: [left(-79, -88 - gesture * 3), left(77, -77 + gesture * 4)],
    goodnight: [left(-38 - gesture, 0), left(39 + gesture, 2)],
    goodbye: [left(-79 - gesture * 5, -82 - gesture * 6), left(74, 40)],
    welcome: [left(-103, -21), left(103, -21)],
    proud: [p(l.hx - 58, l.hy - 9), left(54, 17)],
    shy: [p(l.hx - 51, l.hy + 26), left(60, 24)],
    rainy: [left(-43, 10), left(70, -7)],
    sick: [left(-50, 17), left(58, -12)],
    exercise: [left(-88, -55), left(88, -55)],
    birthday: [left(-51, 32), left(51, 32)],
    promise: [left(-14, -20), left(91, -33)],
  };
  const result = hands[id]!;
  // Authored revision variants keep the same scene but visibly change the
  // hand gesture and expression. They do not pretend to interpret free text.
  if (variant % 3 !== 0) {
    result[0] = p(result[0].x - 3 * (variant % 3), result[0].y - 5 * (variant % 3));
    result[1] = p(result[1].x + 2 * (variant % 3), result[1].y - 3 * (variant % 3));
  }
  return result;
}

function arm(start: Point, hand: Point, side: number, fur: string) {
  const middle = p((start.x + hand.x) / 2 + side * 9, (start.y + hand.y) / 2 + 13);
  const d = `M${start.x} ${start.y} Q${middle.x} ${middle.y} ${hand.x} ${hand.y}`;
  return path(d, 'none', INK, 36) + path(d, 'none', fur, 27);
}

function hand(point: Point, character: BuiltInCharacter, raised = false) {
  const fur = character === 'neulbo' ? '#CFA984' : '#FFF1D8';
  let result = ellipse(point.x, point.y, 15.5, 17, fur, INK, 4.2);
  if (character === 'neulbo') {
    for (let i = -1; i <= 1; i++)
      result += path(
        `M${n(point.x + i * 7 - 3)} ${n(point.y - 11)} q-1 -7 3 -7 q5 1 4 10`,
        CREAM,
        INK,
        2.7,
      );
  } else if (raised) {
    result += ellipse(point.x, point.y + 3, 6, 7, '#EAC3B2', 'none');
  } else {
    result += path(
      `M${point.x - 5} ${point.y - 10} v7 M${point.x + 3} ${point.y - 11} v7`,
      'none',
      '#BEAA97',
      2.1,
    );
  }
  return result;
}

function accessories(character: BuiltInCharacter, l: Layout) {
  const { bx: x, by: y, hx, hy } = l;
  if (character === 'tokki') {
    return (
      path(`M${x - 43} ${y - 44} Q${x + 10} ${y - 20} ${x + 35} ${y + 25}`, 'none', INK, 13) +
      path(`M${x - 43} ${y - 44} Q${x + 10} ${y - 20} ${x + 35} ${y + 25}`, 'none', '#D39A69', 7) +
      group(
        path('M-16 -14 Q0 -24 17 -14 L5 35 Q1 43 -4 33Z', '#ECA264') +
          path('M-8 -17 Q-18 -38 -4 -29 L0 -17 Q5 -40 13 -30 L7 -14', '#8BB89B', INK, 3) +
          path('M-11 -2 l9 3 M0 14 l8 2', 'none', '#B8754D', 2.5),
        `translate(${x + 35} ${y + 15}) rotate(-12)`,
      ) +
      path(
        `M${hx - 43} ${hy + 47} Q${hx} ${hy + 65} ${hx + 42} ${hy + 47} L${hx + 41} ${hy + 62} Q${hx} ${hy + 79} ${hx - 43} ${hy + 61}Z`,
        MINT,
      ) +
      path(
        `M${hx + 18} ${hy + 64} Q${hx + 40} ${hy + 74} ${hx + 30} ${hy + 103} L${hx + 12} ${hy + 96} Q${hx + 20} ${hy + 80} ${hx + 11} ${hy + 67}Z`,
        MINT,
      ) +
      path(`M${hx + 19} ${hy + 86} l13 5`, 'none', '#80B299', 2.5)
    );
  }
  return (
    path(`M${x + 46} ${y - 44} Q${x + 7} ${y - 10} ${x - 40} ${y + 4}`, 'none', INK, 17) +
    path(`M${x + 46} ${y - 44} Q${x + 7} ${y - 10} ${x - 40} ${y + 4}`, 'none', '#A4BE98', 10) +
    group(
      rect(-27, -20, 53, 46, 14, '#9EB78F') +
        path('M-25 -8 Q0 4 25 -8', 'none', INK, 3) +
        ellipse(0, 5, 13, 11, CREAM, INK, 2) +
        ellipse(-5, 5, 5, 3, '#AA8464', 'none') +
        ellipse(5, 5, 5, 3, '#AA8464', 'none') +
        path('M-3 8 q3 3 6 0', 'none', INK, 1.5),
      `translate(${x - 27} ${y + 25}) rotate(12)`,
    )
  );
}

function face(
  character: BuiltInCharacter,
  id: string,
  l: Layout,
  phase: number,
  frame: number,
  variant: number,
) {
  const fur = character === 'neulbo' ? '#D1AB87' : '#FFF1D8';
  const earBend = Math.sin(phase) * 3;
  let result = '';
  if (character === 'tokki') {
    result += path(`M-48 -45 C-66 -67 -68 -108 -48 -109 C-28 -111 -26 -76 -26 -49Z`, fur);
    result += path('M-48 -58 C-55 -75 -56 -94 -49 -96 C-41 -97 -39 -77 -37 -61', '#EBC1B0', 'none');
    result += path(
      `M22 -49 C20 -70 25 -108 43 -111 Q65 ${-111 + earBend} 72 ${-92 + earBend} Q75 ${-78 + earBend} 59 -77 Q48 -81 45 -93 Q41 -76 44 -51Z`,
      fur,
    );
    result += path(`M33 -61 Q34 -87 42 -98 Q50 -95 57 ${-88 + earBend}`, 'none', '#EBC1B0', 9);
    result += ellipse(0, 0, 69, 63, fur);
    result += ellipse(0, 20, 46, 32, '#FFFAEE', 'none');
  } else {
    result += ellipse(0, 0, 75, 67, fur);
    result += path('M-15 -64 Q-31 -88 -13 -81 L-2 -72 Q10 -94 20 -83 L9 -68 Q29 -77 31 -64', fur);
    result += path(
      'M-61 -15 C-57 -59 -15 -57 0 -47 C16 -57 59 -48 63 -13 Q72 32 31 48 Q-15 62 -51 36 Q-67 15 -61 -15Z',
      CREAM,
      'none',
    );
    result += group(ellipse(-31, -5, 25, 20, '#8E694F', 'none'), 'rotate(-14 -31 -5)');
    result += group(ellipse(31, -5, 25, 20, '#8E694F', 'none'), 'rotate(14 31 -5)');
    result += path('M-65 12 l3 6 M-60 22 l3 6 M58 22 l-3 6', 'none', '#BA926F', 3);
  }
  const blink = frame === 5 || frame === 6;
  const sleepy = ['sleepy', 'goodnight', 'tired'].includes(id);
  const smiling = [
    'thanks',
    'cheer',
    'laugh',
    'yummy',
    'celebrate',
    'birthday',
    'welcome',
  ].includes(id);
  const sad = ['cry', 'sorry', 'rainy', 'sick'].includes(id);
  const wink = id === 'okay' || (variant % 3 === 1 && !sad && !sleepy);
  result += ellipse(-46, 21, 11, 6, '#EAB6A3', 'none') + ellipse(46, 21, 11, 6, '#EAB6A3', 'none');
  for (const side of [-1, 1]) {
    const x = side * 27;
    if (id === 'love') result += heart(x, 4, 0.22, '#6D443C');
    else if (id === 'surprise' && !blink)
      result += ellipse(x, -2, 8, 11, DARK, 'none') + ellipse(x - 2, -5, 2, 3, '#FFFFFF', 'none');
    else if (id === 'angry')
      result += path(
        `M${x - side * 7} -1 L${x + side * 7} -5 M${x - side * 6} -10 L${x + side * 8} -15`,
        'none',
        DARK,
        4.5,
      );
    else if (smiling || blink || sleepy || (wink && side === -1))
      result += path(
        `M${x - 7} ${smiling ? 1 : -1} Q${x} ${smiling ? -9 : 7} ${x + 7} ${smiling ? 1 : -1}`,
        'none',
        DARK,
        4.5,
      );
    else {
      result += ellipse(x, -1, 4.3, sad ? 6 : 5.2, DARK, 'none');
      if (sad) result += path(`M${x - 7} -15 Q${x} -12 ${x + 7} -17`, 'none', DARK, 3);
    }
  }
  result += ellipse(
    0,
    10,
    character === 'neulbo' ? 8 : 5.5,
    character === 'neulbo' ? 5.5 : 4,
    character === 'neulbo' ? DARK : '#B98980',
    'none',
  );
  if (id === 'surprise' || id === 'hungry' || (sleepy && frame > 2 && frame < 5))
    result += ellipse(0, 26, 7 + Math.sin(phase) * 1.3, 10, DARK, 'none');
  else if (id === 'laugh' || id === 'cheer' || id === 'celebrate')
    result +=
      path(
        `M-17 20 Q0 27 17 20 Q14 ${43 + Math.sin(phase) * 2} 0 44 Q-14 42 -17 20Z`,
        DARK,
        DARK,
        2.5,
      ) + ellipse(0, 38, 9, 4, PINK, 'none');
  else if (sad) result += path('M-9 29 Q0 21 9 29', 'none', DARK, 3.5);
  else if (id === 'angry' || id === 'no') result += path('M-9 26 h18', 'none', DARK, 3.5);
  else if (id === 'yummy')
    result +=
      path('M-10 24 Q-3 30 0 24 Q7 31 13 23', 'none', DARK, 3.5) +
      path('M8 26 q8 6 7 -3', PINK, DARK, 2);
  else
    result += path(
      `M0 15 v7 M-12 23 Q-5 ${32 + (variant % 3 === 2 ? 3 : 0)} 0 22 Q6 32 12 23`,
      'none',
      DARK,
      3.5,
    );
  if (id === 'cry') {
    result +=
      path('M-31 10 Q-40 35 -29 44 Q-17 38 -26 11', BLUE, 'none') +
      path('M25 10 Q15 37 28 42 Q40 35 30 11', BLUE, 'none');
  }
  if (id === 'shy')
    result += path('M-52 15 l-4 8 M-44 15 l-4 8 M44 15 l-4 8 M52 15 l-4 8', 'none', '#C48077', 2.2);
  if (id === 'proud')
    result +=
      path(
        'M-58 -12 Q-35 -22 -11 -11 L-14 11 Q-34 25 -51 9Z M11 -11 Q35 -22 58 -12 L51 9 Q33 25 14 11Z',
        DARK,
        INK,
        4,
      ) +
      path('M-12 -9 Q0 -15 12 -9', 'none', INK, 5) +
      path('M-44 -8 l13 -4 M24 -7 l13 -4', 'none', '#9BB6B1', 3);
  if (id === 'sick')
    result +=
      rect(-31, 8, 62, 36, 12, '#EDF4E7', '#869E91', 3) +
      path('M-25 20 h50 M-25 29 h50', 'none', '#BDD3C4', 2) +
      rect(-27, -48, 54, 15, 5, '#C5DEDE', INK, 3);
  if (id === 'exercise')
    result += path('M-67 -21 Q0 -39 67 -21 L66 -35 Q0 -50 -64 -34Z', PINK, INK, 3);
  return group(result, `translate(${l.hx} ${l.hy}) rotate(${l.tilt})`);
}

function propsBack(id: string, l: Layout, character: BuiltInCharacter) {
  let result = '';
  if (id === 'sleepy')
    result +=
      rect(211, 268, 99, 44, 19, '#C6D8CF') +
      path('M227 283 q8 -6 17 0 M266 295 q8 -6 17 0', 'none', '#99B5A6', 2.5);
  if (id === 'welcome')
    result +=
      path('M83 305 V112 Q82 75 123 75 H144 V305', '#EEDAB0', INK, 5) +
      path('M93 293 V115 Q93 89 127 89', 'none', '#CFAF83', 3);
  if (id === 'rainy')
    result +=
      path(
        'M90 102 Q180 0 281 103 Q251 86 227 106 Q198 87 171 107 Q140 90 116 107Z',
        GOLD,
        INK,
        5,
      ) +
      path('M184 72 V283 Q184 302 201 299', 'none', INK, 5) +
      path(
        'M117 67 Q101 81 97 90 M140 36 l-6 12 M241 117 l-5 12 M282 144 l-5 12 M83 150 l-5 12',
        'none',
        BLUE,
        5,
      );
  if (id === 'celebrate')
    result +=
      path(
        `M${l.hx - 31} ${l.hy - 56} L${l.hx - 3} ${character === 'tokki' ? l.hy - 90 : l.hy - 119} L${l.hx + 30} ${l.hy - 56}Z`,
        '#E5ACB8',
        INK,
        4,
      ) + ellipse(l.hx - 3, character === 'tokki' ? l.hy - 93 : l.hy - 121, 7, 7, GOLD, INK, 3);
  return result;
}

function propsFront(id: string, l: Layout, hands: [Point, Point], character: BuiltInCharacter) {
  const { bx: x, by: y } = l;
  const [a, b] = hands;
  let result = '';
  switch (id) {
    case 'love':
      result +=
        heart(x, y + 46, 1.2, '#E99EA8') +
        path(`M${x - 22} ${y - 3} q-10 -8 -16 3`, 'none', '#F8D5D8', 5);
      break;
    case 'thanks':
      result +=
        path(`M${x - 26} ${y - 17} L${x} ${y + 32} L${x + 26} ${y - 17}Z`, '#E9D1AC', INK, 3) +
        flower(x - 17, y - 28, 0.66) +
        flower(x + 15, y - 33, 0.65) +
        flower(x, y - 44, 0.7);
      break;
    case 'sorry':
      result += path(
        `M${l.hx + 68} ${l.hy - 37} Q${l.hx + 83} ${l.hy - 19} ${l.hx + 74} ${l.hy - 11} Q${l.hx + 61} ${l.hy - 9} ${l.hx + 68} ${l.hy - 37}`,
        BLUE,
        INK,
        2.5,
      );
      break;
    case 'cry':
      result += path(`M${b.x - 14} ${b.y - 4} l30 -8 l8 38 l-34 5Z`, '#E2EAD8', INK, 3);
      break;
    case 'hungry':
      result +=
        path(
          `M${x - 58} ${y - 3} H${x + 13} Q${x + 7} ${y + 40} ${x - 22} ${y + 40} Q${x - 51} ${y + 40} ${x - 58} ${y - 3}Z`,
          '#C4DCD1',
        ) +
        ellipse(x - 22, y - 3, 35, 8, '#F8EEDB', INK, 3) +
        path(`M${b.x} ${b.y + 10} V${b.y - 33}`, 'none', INK, 6) +
        ellipse(b.x, b.y - 38, 10, 15, GOLD, INK, 3);
      break;
    case 'yummy':
      if (character === 'tokki')
        result += group(
          path('M-15 -15 Q0 -21 15 -15 L1 35Z', '#EBA063', INK, 3.5) +
            path('M-5 -18 l-7 -15 M0 -18 l3 -18 M6 -17 l12 -12', 'none', '#8EB89A', 5),
          `translate(${a.x} ${a.y - 20}) rotate(-20)`,
        );
      else
        result +=
          ellipse(a.x, a.y - 20, 24, 25, '#DEB57B', INK, 4) +
          [
            [-10, -9],
            [8, -12],
            [-3, 7],
            [12, 8],
          ]
            .map(([dx, dy]) => ellipse(a.x + dx!, a.y - 20 + dy!, 3, 4, '#977050', 'none'))
            .join('');
      break;
    case 'coffee':
      result +=
        path(
          `M${x + 32} ${y - 20} Q${x + 65} ${y - 24} ${x + 50} ${y + 9} H${x + 29}`,
          'none',
          INK,
          9,
        ) +
        rect(x - 34, y - 31, 68, 59, 13, '#D0DFCB') +
        ellipse(x, y - 29, 32, 8, '#AB8369', INK, 3) +
        heart(x, y + 8, 0.3, CREAM) +
        path(
          `M${x - 10} ${y - 51} q-9 -9 0 -16 M${x + 13} ${y - 51} q-9 -9 0 -16`,
          'none',
          '#AEADA0',
          3,
        );
      break;
    case 'busy':
      result +=
        rect(x - 72, y + 9, 144, 59, 9, '#AECAD0') +
        path(`M${x - 81} ${y + 67} H${x + 82} L${x + 68} ${y + 78} H${x - 65}Z`, '#DCE7E0') +
        ellipse(x, y + 39, 10, 10, CREAM, INK, 2.5) +
        path(`M${x - 6} ${y + 37} q6 -8 12 0 M${x - 5} ${y + 42} q5 7 10 0`, 'none', INK, 2);
      break;
    case 'waiting':
      result += group(
        rect(-12, -12, 24, 25, 7, '#D6B794', INK, 3) +
          ellipse(0, 0, 10, 10, CREAM, INK, 2) +
          path('M0 -6 v7 l5 3', 'none', INK, 2),
        `translate(${b.x - 3} ${b.y - 5}) rotate(-15)`,
      );
      break;
    case 'goodnight':
      result +=
        path(
          `M${x - 67} ${y + 11} Q${x} ${y - 7} ${x + 65} ${y + 15} L${x + 62} ${y + 55} Q${x} ${y + 75} ${x - 64} ${y + 55}Z`,
          '#B6CBCE',
        ) +
        path(
          `M${x + 8} ${y - 43} C${x - 30} ${y - 54} ${x - 58} ${y - 4} ${x - 26} ${y + 23} C${x - 6} ${y + 40} ${x + 31} ${y + 24} ${x + 30} ${y + 4} Q${x - 12} ${y + 13} ${x + 8} ${y - 43}`,
          GOLD,
          INK,
          4,
        ) +
        spark(x + 48, y + 36, 7, CREAM) +
        spark(x - 32, y + 42, 6, CREAM);
      break;
    case 'goodbye':
      result +=
        rect(241, 269, 55, 55, 10, '#E9BB8B') +
        path('M258 269 v-10 q10 -10 20 0 v10 M258 279 v33 M277 279 v33', 'none', INK, 3.5) +
        ellipse(250, 327, 5, 5, INK, 'none') +
        ellipse(287, 327, 5, 5, INK, 'none');
      break;
    case 'shy':
      result += flower(b.x + 12, b.y - 15, 0.65);
      break;
    case 'sick':
      result +=
        path(
          `M${x - 68} ${y - 6} Q${x} ${y - 35} ${x + 64} ${y - 5} L${x + 66} ${y + 47} Q${x} ${y + 68} ${x - 67} ${y + 47}Z`,
          '#D6C7D5',
        ) +
        path(
          `M${x - 48} ${y + 3} l13 48 M${x - 19} ${y - 5} l12 59 M${x + 13} ${y - 8} l13 60 M${x + 40} ${y - 2} l12 46`,
          'none',
          '#BEADB9',
          2.5,
        ) +
        group(
          rect(-6, -39, 12, 47, 5, CREAM, INK, 3) +
            ellipse(0, 8, 7, 7, PINK, INK, 3) +
            path('M0 -17 v25', 'none', PINK, 3),
          `translate(${b.x} ${b.y}) rotate(16)`,
        );
      break;
    case 'exercise':
      for (const h of hands)
        result +=
          path(`M${h.x - 29} ${h.y} h58`, 'none', INK, 9) +
          rect(h.x - 35, h.y - 15, 12, 30, 4, BLUE, INK, 3) +
          rect(h.x + 23, h.y - 15, 12, 30, 4, BLUE, INK, 3);
      break;
    case 'birthday':
      result +=
        rect(x - 53, y + 2, 106, 49, 10, '#E6B7B0') +
        path(
          `M${x - 53} ${y + 5} Q${x - 40} ${y - 9} ${x - 25} ${y + 4} Q${x - 11} ${y - 9} ${x + 1} ${y + 4} Q${x + 16} ${y - 9} ${x + 29} ${y + 4} Q${x + 43} ${y - 8} ${x + 53} ${y + 5} V${y + 17} Q${x + 41} ${y + 31} ${x + 30} ${y + 15} Q${x + 16} ${y + 31} ${x} ${y + 15} Q${x - 14} ${y + 30} ${x - 28} ${y + 15} Q${x - 44} ${y + 28} ${x - 53} ${y + 16}Z`,
          CREAM,
          INK,
          3,
        ) +
        rect(x - 5, y - 27, 10, 28, 3, BLUE, INK, 2.5) +
        path(
          `M${x} ${y - 44} Q${x + 13} ${y - 28} ${x} ${y - 29} Q${x - 11} ${y - 31} ${x} ${y - 44}`,
          GOLD,
          INK,
          2,
        );
      break;
  }
  return result;
}

function accents(id: string, l: Layout) {
  const x = l.hx,
    y = l.hy;
  switch (id) {
    case 'hello':
    case 'goodbye':
      return path(
        `M${x - 110} ${y - 40} l-8 -8 M${x - 119} ${y - 15} l-13 -1`,
        'none',
        '#B78D6B',
        4,
      );
    case 'love':
      return heart(x - 99, y - 3, 0.33, '#E6A4AD') + heart(x + 99, y + 25, 0.27, '#E6A4AD');
    case 'sleepy':
      return path('M79 178 h21 l-21 22 h21 M106 151 h17 l-17 19 h17', 'none', '#8E9D9B', 4);
    case 'thanks':
      return spark(84, 157, 9) + spark(277, 196, 9);
    case 'cheer':
      return (
        spark(68, 117, 12) +
        spark(293, 120, 12) +
        path('M64 178 l-13 7 M296 177 l13 7', 'none', GOLD, 4)
      );
    case 'laugh':
      return path(
        'M73 144 l-13 -6 M72 161 l-16 3 M294 148 l13 -9 M296 167 l15 2',
        'none',
        '#B69276',
        4,
      );
    case 'cry':
      return (
        ellipse(83, 277, 17, 5, '#C1DBE5', 'none') + ellipse(274, 290, 19, 5, '#C1DBE5', 'none')
      );
    case 'surprise':
      return path('M74 92 l-2 24 M74 128 v1 M285 94 l-2 24 M284 130 v1', 'none', GOLD, 7);
    case 'angry':
      return path(
        'M276 111 v10 h11 M267 119 h-10 v-11 M257 132 h11 v11 M278 141 v-11 h10',
        'none',
        '#D39584',
        4,
      );
    case 'okay':
      return path('M274 106 l12 12 l23 -31', 'none', '#86AD8A', 7);
    case 'no':
      return path('M75 98 l24 24 M99 98 l-24 24', 'none', '#CC8C83', 6);
    case 'yes':
      return spark(278, 129, 12, MINT);
    case 'hungry':
      return path('M94 145 q-12 -7 -14 7 q-4 11 -10 1', 'none', '#BD987A', 3.5);
    case 'yummy':
      return spark(273, 136, 11, GOLD) + spark(274, 171, 7, GOLD);
    case 'coffee':
      return spark(282, 202, 8, MINT);
    case 'busy':
      return path('M284 157 l-6 10 l9 8 M81 173 l-9 -8', 'none', GOLD, 4);
    case 'hurry':
      return path('M72 225 h-27 M69 242 h-38 M68 260 h-21', 'none', '#B79E88', 4);
    case 'waiting':
      return (
        ellipse(277, 129, 3, 3, INK, 'none') +
        ellipse(291, 129, 3, 3, INK, 'none') +
        ellipse(305, 129, 3, 3, INK, 'none')
      );
    case 'tired':
      return path('M286 236 q25 -6 16 9 q-6 9 -22 6', 'none', '#B6BBB2', 4);
    case 'confused':
      return path('M275 99 q1 -20 17 -15 q20 8 -1 21 v10 M291 126 v1', 'none', '#B39CBA', 5);
    case 'celebrate':
      return [
        spark(61, 133, 9, GOLD),
        spark(301, 146, 9, MINT),
        path('M91 76 l-6 11 M283 76 l8 8 M57 213 l8 9 M303 231 l-9 8', 'none', '#D8A5AE', 5),
      ].join('');
    case 'goodnight':
      return spark(73, 179, 10, GOLD) + spark(280, 160, 10, GOLD) + spark(300, 191, 6, GOLD);
    case 'welcome':
      return spark(293, 130, 11, GOLD);
    case 'proud':
      return spark(77, 130, 12, GOLD) + spark(293, 167, 10, GOLD);
    case 'shy':
      return heart(284, 165, 0.3, '#E5B4AF');
    case 'sick':
      return path('M284 125 q-11 -9 -5 -16 M296 144 q-11 -9 -5 -16', 'none', '#B3C5C9', 3.5);
    case 'exercise':
      return spark(74, 111, 10, GOLD) + spark(286, 106, 10, GOLD);
    case 'birthday':
      return heart(81, 168, 0.3, PINK) + spark(279, 143, 10, GOLD);
    case 'promise':
      return heart(285, 174, 0.26, PINK);
    default:
      return '';
  }
}

// Tokki Changu's second authored design: upright ears, pink cheeks and a real
// backpack. This renderer is separate so the existing Neulbo pixels stay intact.
const TOKKI_INK = '#402D28';
const TOKKI_WHITE = '#FFFDFA';
const TOKKI_PINK = '#F3A5AE';
const TOKKI_CHEEK = '#FFDFDB';
const tokkiPath = (d: string, fill = 'none', width = 5.2) => path(d, fill, TOKKI_INK, width);

function tokkiHeadPoint(l: Layout, x: number, y: number): Point {
  const angle = (l.tilt * Math.PI) / 180;
  return p(
    l.hx + x * Math.cos(angle) - y * Math.sin(angle),
    l.hy + x * Math.sin(angle) + y * Math.cos(angle),
  );
}

function tokkiBackpack(l: Layout) {
  const x = l.bx - l.rx - 6,
    y = l.by - 4;
  return group(
    tokkiPath('M-8 -34 Q-12 -57 9 -56 Q25 -55 21 -37', 'none', 4.4) +
      tokkiPath(
        'M-22 -22 Q-24 -44 0 -44 H15 Q32 -42 32 -20 L31 34 Q17 45 -14 37 Q-25 35 -22 -22Z',
        '#F6B3B9',
      ) +
      path('M-15 -24 Q-14 -35 0 -35 H14 Q23 -33 22 -21', 'none', '#FFE4E2', 3.4) +
      tokkiPath('M-19 7 Q5 3 27 9 L26 28 Q5 36 -18 28Z', '#EE9DA8', 3.5) +
      tokkiPath('M-9 15 h11', 'none', 2.8) +
      // Small hanging charm, not a carrot-shaped handbag or cross-body strap.
      tokkiPath('M-15 -2 q-6 2 -3 10', 'none', 2.8) +
      group(
        tokkiPath('M-7 -9 Q0 -15 8 -8 Q12 3 0 22 Q-11 6 -7 -9Z', '#FAA75D', 3.1) +
          tokkiPath(
            'M-3 -11 Q-10 -20 -3 -22 L1 -16 Q3 -29 8 -23 L6 -14 Q17 -20 12 -11Z',
            '#86A777',
            2.7,
          ) +
          path('M-6 -1 l7 2 M-3 9 l5 1', 'none', '#D77C46', 2),
        'translate(-13 15) rotate(10)',
      ),
    `translate(${x} ${y}) rotate(-5)`,
  );
}

function tokkiBody(l: Layout, id: string) {
  const left = tokkiHeadPoint(l, -36, 47),
    right = tokkiHeadPoint(l, 36, 47);
  if (id === 'sleepy') {
    return (
      tokkiPath(
        `M${left.x} ${left.y} C158 253 119 247 102 269 Q82 287 106 303 Q121 310 143 302 Q164 315 192 297 L${right.x} ${right.y}Z`,
        TOKKI_WHITE,
      ) + tokkiPath('M104 286 Q91 288 102 301 Q117 310 129 299', TOKKI_WHITE, 4.5)
    );
  }
  if (id === 'hurry') {
    return (
      tokkiPath(
        `M${left.x} ${left.y} C146 194 132 228 146 252 C143 261 127 273 113 283 Q102 292 110 300 Q119 310 132 304 Q154 291 170 266 Q181 272 193 265 Q207 281 224 287 Q240 293 249 281 Q253 269 239 264 L222 253 C241 224 240 193 ${right.x} ${right.y}Z`,
        TOKKI_WHITE,
      ) +
      tokkiPath('M217 260 Q207 255 200 246', 'none', 3.4) +
      path('M118 296 l2 5 M126 293 l3 5 M238 275 l5 3', 'none', TOKKI_INK, 2.4)
    );
  }
  const [a, b] = l.feet;
  const bottom = Math.max(a.y, b.y);
  return (
    tokkiPath(
      `M${left.x} ${left.y} C${l.bx - l.rx + 4} ${l.by - 34} ${l.bx - l.rx - 7} ${l.by + 9} ${a.x - 19} ${a.y - 11} Q${a.x - 23} ${a.y + 15} ${a.x - 4} ${a.y + 15} Q${a.x + 15} ${a.y + 16} ${l.bx - 15} ${bottom - 18} Q${l.bx} ${bottom - 14} ${l.bx + 15} ${bottom - 18} Q${b.x - 13} ${b.y + 16} ${b.x + 6} ${b.y + 15} Q${b.x + 26} ${b.y + 14} ${b.x + 19} ${b.y - 13} C${l.bx + l.rx + 7} ${l.by + 8} ${l.bx + l.rx - 2} ${l.by - 33} ${right.x} ${right.y}Z`,
      TOKKI_WHITE,
    ) +
    path(
      `M${a.x - 5} ${a.y + 9} v5 M${a.x + 3} ${a.y + 9} v5 M${b.x - 2} ${b.y + 9} v5 M${b.x + 6} ${b.y + 9} v5`,
      'none',
      TOKKI_INK,
      2.8,
    )
  );
}

function tokkiStraps(l: Layout) {
  const x = l.bx,
    y = l.by;
  return (
    tokkiPath(
      `M${x - 32} ${y - 49} Q${x - 54} ${y - 28} ${x - 42} ${y + 3} Q${x - 33} ${y + 15} ${x - 29} ${y + 2} Q${x - 41} ${y - 21} ${x - 20} ${y - 42}Z`,
      '#F6B3B9',
      4,
    ) +
    tokkiPath(
      `M${x + 28} ${y - 47} Q${x + 48} ${y - 27} ${x + 40} ${y + 2} Q${x + 34} ${y + 11} ${x + 28} ${y + 2} Q${x + 37} ${y - 23} ${x + 17} ${y - 42}Z`,
      '#F6B3B9',
      4,
    )
  );
}

function tokkiArm(start: Point, end: Point, side: number) {
  const middle = p((start.x + end.x) / 2 + side * 9, (start.y + end.y) / 2 + 10);
  const curve = `M${start.x} ${start.y} Q${middle.x} ${middle.y} ${end.x} ${end.y}`;
  return path(curve, 'none', TOKKI_INK, 35) + path(curve, 'none', TOKKI_WHITE, 25);
}

function tokkiPaw(point: Point, start: Point) {
  const angle = (Math.atan2(point.y - start.y, point.x - start.x) * 180) / Math.PI + 90;
  // One broad thumb and a smooth mitten remain readable in a small chat bubble.
  // The wrist stays open so no circular seam separates the paw from the arm.
  const contour =
    'M-12 9 C-17 5 -17 -2 -13 -7 Q-10 -12 -6 -8 Q-8 -17 -1 -18 C8 -19 15 -12 15 -3 Q17 5 11 10';
  return group(
    path(`${contour}Z`, TOKKI_WHITE, 'none') +
      tokkiPath(contour, 'none', 4.5) +
      tokkiPath('M-2 -11 q2 -3 4 -1 M5 -9 q2 -3 4 -1', 'none', 1.9),
    `translate(${point.x} ${point.y}) rotate(${n(angle)})`,
  );
}

function tokkiUmbrella() {
  // The offset shaft stays outside the cheek and passes through the gripping
  // paw. Keeping it behind the paw gives a visible, continuous handhold.
  return (
    tokkiPath(
      'M151 115 Q247 7 342 115 Q318 99 291 119 Q267 103 240 120 Q215 103 188 121Z',
      GOLD,
      5,
    ) +
    tokkiPath('M266 88 V293 Q266 310 253 304 Q247 301 250 294', 'none', 5) +
    path(
      'M84 132 l-5 12 M111 95 l-5 12 M308 160 l-5 12 M324 205 l-5 12 M83 231 l-5 12',
      'none',
      BLUE,
      5,
    )
  );
}

function tokkiCoffee(l: Layout, lift: number) {
  const x = l.bx,
    y = l.by - lift;
  return (
    tokkiPath(
      `M${x + 32} ${y - 20} Q${x + 65} ${y - 24} ${x + 50} ${y + 9} H${x + 29}`,
      'none',
      9,
    ) +
    rect(x - 34, y - 31, 68, 59, 13, '#D0DFCB', TOKKI_INK) +
    ellipse(x, y - 29, 32, 8, '#AB8369', TOKKI_INK, 3) +
    heart(x, y + 8, 0.3, CREAM) +
    (lift < 24
      ? path(
          `M${x - 10} ${y - 51} q-9 -9 0 -16 M${x + 13} ${y - 51} q-9 -9 0 -16`,
          'none',
          '#AEADA0',
          3,
        )
      : '')
  );
}

function tokkiWatch(hand: Point) {
  // The watch sits on the forearm rather than underneath the palm.
  return group(
    rect(-11, -13, 22, 28, 6, '#D6B794', TOKKI_INK, 3) +
      ellipse(0, 0, 11, 11, CREAM, TOKKI_INK, 2.5) +
      tokkiPath('M0 -6 v7 l5 3', 'none', 2.5),
    `translate(${hand.x + 7} ${hand.y + 19}) rotate(-15)`,
  );
}

function tokkiFace(id: string, l: Layout, phase: number, frame: number, variant: number) {
  const blink = frame === 5 || frame === 6;
  const sleepy = ['sleepy', 'goodnight', 'tired'].includes(id);
  const sad = ['cry', 'sorry', 'rainy', 'sick'].includes(id);
  const happy = ['thanks', 'cheer', 'laugh', 'yummy', 'celebrate', 'birthday', 'welcome'].includes(
    id,
  );
  const wink = id === 'okay' || (variant % 3 === 1 && !sad && !sleepy);
  const earFlex = Math.sin(phase) * 1.8;
  let art = '';
  // Both ears rise from the head contour. The slight flex is a local ear-tip
  // articulation; head outline, face position and torso never use phase.
  art += tokkiPath(
    `M-47 -43 C-63 -64 ${-59 + earFlex} -110 -42 -113 C-24 -116 -22 -82 -26 -48Z`,
    TOKKI_WHITE,
  );
  art += path(`M-45 -57 Q${-54 + earFlex} -98 -43 -100 Q-33 -104 -34 -59Z`, '#FFD2D0', 'none');
  art += tokkiPath(
    `M18 -50 C18 -75 ${27 - earFlex} -115 46 -112 C67 -107 52 -66 42 -44Z`,
    TOKKI_WHITE,
  );
  art += path(`M28 -58 Q${32 - earFlex} -99 44 -99 Q54 -94 37 -54Z`, '#FFD2D0', 'none');
  const head =
    'M-36 50 C-63 42 -77 17 -71 -10 Q-68 -40 -39 -53 Q-20 -65 1 -61 Q30 -64 50 -46 Q75 -28 73 1 C76 29 57 46 36 50';
  art += path(`${head}Z`, TOKKI_WHITE, 'none');
  art += tokkiPath(head, 'none', 5.4);
  art +=
    ellipse(-45, 18, 15.2, 15.2, TOKKI_CHEEK, 'none') +
    ellipse(45, 18, 15.2, 15.2, TOKKI_CHEEK, 'none');
  for (const side of [-1, 1]) {
    const x = side * 20;
    if (id === 'love') art += heart(x, 4, 0.2, TOKKI_INK);
    else if (id === 'surprise' && !blink) art += ellipse(x, -2, 5.8, 8.3, TOKKI_INK, 'none');
    else if (id === 'angry')
      art += tokkiPath(`M${x - side * 5} 0 L${x + side * 4} -3`, 'none', 4.8);
    else if (id === 'coffee') art += tokkiPath(`M${x - 5} 0 q5 5 10 0`, 'none', 3.8);
    else if (id === 'waiting' && !blink) art += ellipse(x + 3, 3, 3.8, 4.8, TOKKI_INK, 'none');
    else if (id === 'busy' && !blink) art += ellipse(x, 4, 3.7, 4.9, TOKKI_INK, 'none');
    else if (id === 'tired' && !blink)
      art += tokkiPath(`M${x - 5} 0 h10 M${x - 4} 6 h7`, 'none', 3.3);
    else if (blink || sleepy || (wink && side === -1))
      art += tokkiPath(`M${x - 5} 0 Q${x} 5 ${x + 5} 0`, 'none', 4);
    else if (happy) art += tokkiPath(`M${x - 5} 1 Q${x - 2} -7 ${x + 5} -1`, 'none', 4);
    else art += ellipse(x, -1, 3.9, sad ? 5.2 : 5.8, TOKKI_INK, 'none');
  }
  if (!sleepy) {
    if (sad) art += tokkiPath('M-28 -17 q7 5 12 -1 M14 -18 q7 5 13 -1', 'none', 3.6);
    else if (id === 'angry' || id === 'no')
      art += tokkiPath('M-30 -19 l11 8 M16 -10 l12 -6', 'none', 4.6);
    else if (id === 'coffee')
      art += tokkiPath('M-28 -16 q6 -4 12 0 M15 -17 q6 -3 12 1', 'none', 3.4);
    else if (id === 'waiting') art += tokkiPath('M-28 -15 h11 M15 -20 l11 3', 'none', 3.7);
    else if (id === 'hurry' || id === 'busy')
      art += tokkiPath('M-29 -20 l10 8 M15 -11 l12 -7', 'none', 4.2);
    else if (id === 'confused') art += tokkiPath('M-28 -17 l10 3 M15 -18 l11 -8', 'none', 3.7);
    else if (id === 'surprise') art += tokkiPath('M-27 -20 l8 -5 M15 -25 l11 5', 'none', 3.8);
    else art += tokkiPath(`M-29 -20 l10 ${happy ? 5 : 8} M15 -14 l12 -4`, 'none', 4.2);
  }
  art += ellipse(0, 9, 6, 4.2, TOKKI_INK, 'none');
  if (id === 'surprise' || id === 'hungry' || (sleepy && frame > 2 && frame < 5))
    art +=
      ellipse(0, 28, 7 + Math.sin(phase), 10, TOKKI_INK, 'none') +
      ellipse(0, 33, 4, 3, '#F4B3BA', 'none');
  else if (id === 'cry')
    art += tokkiPath('M-11 28 Q0 16 11 28 Q7 40 0 32 Q-7 41 -11 28Z', '#F1B4BC', 3.4);
  else if (id === 'sorry') art += tokkiPath('M-6 26 Q0 19 7 26', 'none', 3.2);
  else if (sad) art += tokkiPath('M-7 28 Q0 20 8 28', 'none', 3.5);
  else if (id === 'angry') art += tokkiPath('M-9 27 Q0 21 9 27', 'none', 3.8);
  else if (id === 'no') art += tokkiPath('M-8 25 h16', 'none', 3.5);
  else if (id === 'coffee')
    art +=
      Math.cos(phase) < 0
        ? ellipse(0, 25, 4.5, 5.5, TOKKI_INK, 'none')
        : tokkiPath('M-8 23 q8 8 16 0', 'none', 3.4);
  else if (id === 'waiting')
    art += tokkiPath(`M-7 26 q6 ${Math.cos(phase) < 0 ? -4 : 0} 14 0`, 'none', 3.5);
  else if (id === 'busy') art += tokkiPath('M-6 25 h12', 'none', 3.4);
  else if (id === 'hurry')
    art += tokkiPath('M-9 21 Q0 18 10 23 L8 35 Q0 42 -8 34Z', TOKKI_PINK, 3.5);
  else if (sleepy) art += tokkiPath('M0 14 v5 M-9 21 q5 7 9 -1 q5 7 10 0', 'none', 3.4);
  else {
    const wide = id === 'laugh' ? 18 : ['cheer', 'celebrate'].includes(id) ? 16 : 12;
    const bottom = id === 'laugh' ? 44 : happy ? 41 : 37;
    art += tokkiPath(
      `M${-wide} 19 Q0 25 ${wide} 18 Q${wide - 1} ${bottom + Math.sin(phase) * 1.5} 0 ${bottom + 2} Q${-wide + 1} ${bottom} ${-wide} 19Z`,
      TOKKI_PINK,
      3.7,
    );
    art += path(
      `M-7 ${bottom - 3} Q0 ${bottom - 8} 7 ${bottom - 3} Q0 ${bottom + 3} -7 ${bottom - 3}`,
      '#FFD5D7',
      'none',
    );
    art += tokkiPath('M0 13 v4 M-10 18 q6 6 10 -2 q5 6 11 1', 'none', 3.5);
  }
  if (id === 'cry')
    art +=
      path('M-24 10 Q-30 35 -22 40 Q-14 35 -19 11', BLUE, 'none') +
      path('M18 11 Q12 37 22 41 Q32 34 25 11', BLUE, 'none');
  if (id === 'shy')
    art += path('M-48 15 l-3 7 M-41 15 l-3 7 M40 15 l-3 7 M47 15 l-3 7', 'none', '#E5A1A1', 2);
  if (id === 'proud')
    art +=
      tokkiPath(
        'M-53 -10 Q-34 -19 -9 -9 L-13 8 Q-32 21 -49 7Z M9 -9 Q33 -19 53 -10 L49 7 Q32 21 13 8Z',
        TOKKI_INK,
        3.8,
      ) +
      tokkiPath('M-10 -7 Q0 -12 10 -7', 'none', 4) +
      path('M-40 -7 l12 -3 M23 -6 l12 -3', 'none', '#C3C9C6', 2.4);
  if (id === 'sick')
    art +=
      rect(-29, 10, 58, 32, 11, '#F4F7F0', '#81968B', 2.8) +
      path('M-23 20 h46 M-23 28 h46', 'none', '#C3D5CB', 2) +
      rect(-26, -44, 52, 13, 4, '#C5DEDE', TOKKI_INK, 2.8);
  if (id === 'exercise')
    art += tokkiPath('M-67 -20 Q0 -39 67 -20 L63 -34 Q0 -48 -63 -33Z', TOKKI_PINK, 3.4);
  return group(art, `translate(${l.hx} ${l.hy}) rotate(${l.tilt})`);
}

function drawTokkiFrame(planIndex: number, frame: number, variant: number) {
  const id = STICKER_PLANS[planIndex]!.id;
  const l = layoutFor(id);
  const phase = (frame / 8) * Math.PI * 2;
  const hands = handsFor(id, l, Math.sin(phase), variant);
  const lift = (1 - Math.cos(phase)) / 2;
  if (id === 'coffee') {
    hands[0].y -= lift * 48;
    hands[1].y -= lift * 48;
  } else if (id === 'busy') {
    hands[0].y -= Math.sin(phase) * 16;
    hands[1].y += Math.sin(phase) * 16;
  } else if (id === 'waiting') {
    hands[1].y -= lift * 32;
  } else if (id === 'rainy') hands[1] = p(266, l.by - 7);
  const shoulders: [Point, Point] = [
    p(l.bx - l.rx + 12, l.by - 31),
    p(l.bx + l.rx - 12, l.by - 31),
  ];
  let art = (id === 'rainy' ? tokkiUmbrella() : propsBack(id, l, 'tokki')) + tokkiBackpack(l);
  art += tokkiArm(shoulders[0], hands[0], -1) + tokkiArm(shoulders[1], hands[1], 1);
  art += tokkiBody(l, id) + tokkiStraps(l) + tokkiFace(id, l, phase, frame, variant);
  if (id === 'no')
    art +=
      tokkiArm(p(l.bx - 45, l.by + 25), hands[0], -1) +
      tokkiArm(p(l.bx + 45, l.by + 25), hands[1], 1);
  // Forearms travel with the held objects. The torso stays in its authored
  // position; only these connected limbs and the cup/watch articulate.
  if (id === 'coffee' || id === 'busy')
    art += tokkiArm(shoulders[0], hands[0], -1) + tokkiArm(shoulders[1], hands[1], 1);
  if (id === 'waiting') art += tokkiArm(p(l.bx + 53, l.by + 35), hands[1], 1);
  if (id === 'coffee') art += tokkiCoffee(l, lift * 48);
  else if (id !== 'waiting') art += propsFront(id, l, hands, 'tokki');
  if (id === 'busy') {
    art += path(`M${l.bx - 60} ${l.by + 23} h120`, 'none', '#719599', 2.5);
    for (let key = -2; key <= 2; key++)
      art += rect(l.bx + key * 20 - 6, l.by + 14, 12, 6, 2, '#E2ECE6', 'none');
  }
  art += tokkiPaw(hands[0], shoulders[0]) + tokkiPaw(hands[1], shoulders[1]);
  if (id === 'waiting') art += tokkiWatch(hands[1]);
  if (id === 'busy')
    art +=
      rect(l.bx - 71, l.by + 31, 142, 39, 8, '#AECAD0') +
      ellipse(l.bx, l.by + 48, 9, 9, CREAM, INK, 2.5);
  art += accents(id, l);
  art = art.replaceAll(INK, TOKKI_INK).replaceAll(DARK, TOKKI_INK);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" viewBox="0 0 360 360"><g stroke-linejoin="round" stroke-linecap="round">${art}</g></svg>`;
}

/** The body, head, feet, bag and scene layout never use the animation phase. */
function drawFrame(character: BuiltInCharacter, planIndex: number, frame: number, variant: number) {
  if (character === 'tokki') return drawTokkiFrame(planIndex, frame, variant);
  const id = STICKER_PLANS[planIndex]!.id;
  const l = layoutFor(id);
  const phase = (frame / 8) * Math.PI * 2;
  const gesture = Math.sin(phase);
  const fur = character === 'neulbo' ? '#CFA984' : '#FFF1D8';
  const hands = handsFor(id, l, gesture, variant);
  const shoulders: [Point, Point] = [
    p(l.bx - l.rx + 10, l.by - 31),
    p(l.bx + l.rx - 10, l.by - 31),
  ];
  let art = propsBack(id, l, character);
  // Whole connected limbs are redrawn from fixed shoulders to moving hands.
  // Nothing is cropped from a bitmap, and the canvas is never translated.
  art += arm(shoulders[0], hands[0], -1, fur) + arm(shoulders[1], hands[1], 1, fur);
  for (const foot of l.feet)
    art +=
      ellipse(foot.x, foot.y, character === 'neulbo' ? 28 : 26, 18, fur) +
      ellipse(foot.x, foot.y + 1, 17, 9, CREAM, 'none');
  art +=
    ellipse(l.bx, l.by, l.rx, l.ry, fur) +
    ellipse(l.bx, l.by + 8, l.rx * 0.66, l.ry * 0.76, CREAM, 'none');
  if (character === 'neulbo')
    art += path(
      `M${l.bx - 45} ${l.by - 1} l2 7 M${l.bx + 44} ${l.by + 12} l-2 7 M${l.bx + 40} ${l.by + 24} l-2 6`,
      'none',
      '#B8906D',
      3,
    );
  art += accessories(character, l);
  art += face(character, id, l, phase, frame, variant);
  if (id === 'no') {
    art += arm(p(l.bx - 45, l.by + 25), hands[0], -1, fur);
    art += arm(p(l.bx + 45, l.by + 25), hands[1], 1, fur);
  }
  art += propsFront(id, l, hands, character);
  art += hand(hands[0], character, ['hello', 'surprise', 'goodbye', 'welcome'].includes(id));
  art += hand(hands[1], character, ['surprise', 'welcome'].includes(id));
  // A laptop intentionally occludes hands partially; the tips remain visible.
  if (id === 'busy')
    art +=
      rect(l.bx - 71, l.by + 31, 142, 39, 8, '#AECAD0') +
      ellipse(l.bx, l.by + 48, 9, 9, CREAM, INK, 2.5);
  art += accents(id, l);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" viewBox="0 0 360 360"><g stroke-linejoin="round" stroke-linecap="round">${art}</g></svg>`;
}

export function renderCharacterSticker(
  character: BuiltInCharacter,
  planIndex: number,
  options: CharacterStickerOptions & { animated: false },
): Promise<StaticCharacterSticker>;
export function renderCharacterSticker(
  character: BuiltInCharacter,
  planIndex: number,
  options: CharacterStickerOptions & { animated: true },
): Promise<AnimatedCharacterSticker>;
export function renderCharacterSticker(
  character: BuiltInCharacter,
  planIndex: number,
  options: CharacterStickerOptions,
): Promise<StaticCharacterSticker | AnimatedCharacterSticker>;
export async function renderCharacterSticker(
  character: BuiltInCharacter,
  planIndex: number,
  options: CharacterStickerOptions,
): Promise<StaticCharacterSticker | AnimatedCharacterSticker> {
  if (character !== 'neulbo' && character !== 'tokki')
    throw new Error('지원하지 않는 프리셋 캐릭터입니다.');
  if (
    !Number.isInteger(planIndex) ||
    planIndex < 0 ||
    planIndex >= STICKER_PLANS.length ||
    (options.animated && planIndex >= 24)
  )
    throw new Error('프리셋 장면 번호가 범위를 벗어났습니다.');
  const variant = options.variant ?? 0;
  if (!Number.isInteger(variant) || variant < 0 || variant > 10_000)
    throw new Error('프리셋 변주 번호가 범위를 벗어났습니다.');
  if (!options.animated)
    return {
      png: await sharp(Buffer.from(drawFrame(character, planIndex, 0, variant)))
        .png()
        .toBuffer(),
    };
  const frames: OverlayOptions[] = [];
  for (let frame = 0; frame < 8; frame++) {
    frames.push({
      input: await sharp(Buffer.from(drawFrame(character, planIndex, frame, variant)))
        .png()
        .toBuffer(),
      left: (frame % 4) * 360,
      top: Math.floor(frame / 4) * 360,
    });
  }
  const sheet = await sharp({
    create: { width: 1440, height: 720, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(frames)
    .png()
    .toBuffer();
  return {
    sheet,
    options: {
      columns: 4,
      rows: 2,
      region: null,
      registerFrames: false,
      durationMs: 2000,
      delaysMs: [430, 170, 170, 230, 360, 120, 120, 400],
    },
  };
}
