// Colours measured on real green-screen footage: six screens from five shoots, as their cameras recorded them, and the
// subjects in front of them. The footage isn't here, only these colours. For each screen:
//   key          the key a click on the screen picks: the screen's median colour
//   screen       the screen's mean colour, its darkest and brightest hundredth, and the hundredth farthest from key
//   nearPicked   the subject's colours nearest key that key keeps whole at a similarity of 0.5
//   nearDefault  the subject's colours nearest the default key that the defaults keep whole
// Nearer colours of the subjects', which each key partly takes out, are kept out of the checks: a subject in a colour
// that near the screen is what a picked key, and a similarity set for it, are for

export type RGB = readonly [number, number, number]

export interface Screen {
  name: string
  key: RGB
  screen: readonly RGB[]
  nearPicked: readonly RGB[]
  nearDefault: readonly RGB[]
}

export const SCREENS: readonly Screen[] = [
  {
    name: 'a yellow-green screen',
    key: [93, 163, 45],
    screen: [[95, 165, 46], [70, 126, 33], [126, 204, 63], [63, 110, 33]],
    nearPicked: [[67, 92, 54], [52, 77, 40]],
    nearDefault: [[28, 45, 22], [175, 191, 167]],
  },
  {
    name: 'the yellow-green screen lit brighter',
    key: [97, 184, 45],
    screen: [[99, 186, 48], [72, 142, 34], [131, 227, 67], [67, 126, 36]],
    nearPicked: [[21, 43, 11], [152, 143, 99]],
    nearDefault: [[18, 35, 12], [85, 167, 179]],
  },
  {
    name: 'an even, bright green screen',
    key: [73, 176, 72],
    screen: [[71, 174, 69], [44, 146, 40], [86, 185, 85], [95, 167, 121]],
    nearPicked: [[112, 131, 73], [137, 163, 129]],
    nearDefault: [[72, 118, 118], [185, 198, 170]],
  },
  {
    name: 'a mid-green screen',
    key: [70, 142, 62],
    screen: [[71, 141, 64], [43, 101, 41], [105, 170, 87], [46, 94, 40]],
    nearPicked: [[11, 26, 14], [29, 39, 26]],
    nearDefault: [[11, 26, 14], [162, 157, 122]],
  },
  {
    name: 'a teal screen',
    key: [37, 118, 83],
    screen: [[43, 121, 88], [10, 80, 46], [82, 155, 125], [62, 120, 99]],
    nearPicked: [[99, 132, 138], [68, 101, 107]],
    nearDefault: [[74, 137, 147], [94, 149, 157]],
  },
  {
    name: 'a dull grey-green screen',
    key: [67, 126, 81],
    screen: [[70, 127, 83], [55, 100, 64], [90, 143, 100], [50, 86, 56]],
    nearPicked: [[32, 51, 36], [17, 34, 25]],
    nearDefault: [[32, 51, 36], [22, 30, 4]],
  },
]
