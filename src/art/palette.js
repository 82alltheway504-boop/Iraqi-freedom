// Palette for the whole game. One place to retune the look.
// The world is lit from the upper-left, so every drop shadow falls
// down-and-right and every top bevel is the lighter tone.

export const PAL = {
  // Ground
  sand0: '#c8ab72', sand1: '#d4b77e', sand2: '#bd9f68', sand3: '#e0c58f',
  sandDark: '#a88b56',
  road0: '#6f6a62', road1: '#7b7669', road2: '#5e594f', roadLine: '#cdb66b',
  scrub0: '#a89a64', scrub1: '#8e8551',
  palmTrunk: '#6b5334', palmFrond0: '#5e6f3a', palmFrond1: '#47562b',
  rubble0: '#9a8e7c', rubble1: '#7d7364', rubbleDark: '#554d42',
  berm0: '#b89a64', berm1: '#d8bd86', bermShadow: '#8a7043',
  water0: '#3f6b72', water1: '#4f8189', water2: '#2e545c', foam: '#a8c8c6',
  canal0: '#456f6a', canal1: '#57857e',

  // Structures
  concrete0: '#b9b2a2', concrete1: '#cdc6b4', concrete2: '#918b7c',
  metal0: '#8a8a86', metal1: '#a3a39d', metal2: '#5f5f5c',
  canvasTan: '#c6ae7e', canvasShade: '#a08a5f',
  mudbrick0: '#c4a274', mudbrick1: '#d6b487', mudbrick2: '#9d7f57',

  // Vehicles
  ctfHull0: '#a89762', ctfHull1: '#bfae79', ctfHull2: '#82744a',
  rgHull0: '#8b8153', rgHull1: '#9d9463', rgHull2: '#6a6240',
  tyre: '#2d2b28', glass: '#5a6b63',
  barrel: '#6e6448',

  // Team colours - deliberately not the hull colour, so allegiance reads
  // instantly even in a dust cloud.
  team: ['#7fd4ff', '#ff7b52', '#c9a6ff', '#9fe06a'],

  // Interface
  ink: '#11130f', inkSoft: 'rgba(17,19,15,0.55)',
  hudBg: '#12160f', hudBg2: '#1b2015', hudLine: '#3d4732',
  hudText: '#d7e0c2', hudDim: '#8c9877', hudGold: '#e3c26a',
  good: '#a8d36a', bad: '#e0704f', warn: '#e0b24f',
  hpGood: '#7bc24f', hpMid: '#ddb43f', hpBad: '#cf4b39',
  shroud: '#0a0c08',
};

export const factionTeamColor = (playerIndex) => PAL.team[playerIndex % PAL.team.length];
