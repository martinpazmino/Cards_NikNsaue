// Values shared by the server (validation) and the client (UI pickers).

export const APP_NAME = 'Sinvergüenzas'

export const AVATARS = [
  '🌮', '🌶️', '🥑', '🦜', '🐓', '🌵', '🎸', '🪅', '💃', '🕺',
  '🥥', '🍍', '🌽', '🦙', '🦩', '🐢', '🧉', '☕', '🍹', '🥭',
  '🎺', '🌺', '🐊', '⚽', '👑', '🔥', '🍺', '🎉', '🐸', '🦖',
]

// Player accent colors, assigned in join order.
export const COLORS = [
  '#ff4d8d', '#ffb627', '#19d3c5', '#8c5cff', '#a3e635',
  '#ff6b35', '#38bdf8', '#f472b6', '#facc15', '#34d399',
]

export const ROOM_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ'
export const ROOM_CODE_LENGTH = 4

export const LIMITS = {
  maxPlayers: 16,
  nameMax: 16,
  promptMin: 4,
  promptMax: 160,
  answerMax: 90,
  customPerRoom: 800,
  deckCards: 2000,
  deckNameMax: 40,
  maxBlanks: 2,
}

export const SETTING_OPTIONS = {
  maxScore: [3, 5, 7, 10, 15],
  handSize: [7, 10, 12],
  blanks: [0, 1, 2, 3, 5],
  timer: [0, 60, 90, 120, 180],
}

export const DEFAULT_SETTINGS = {
  packs: ['clasico', 'spanglish'],
  maxScore: 7,
  handSize: 10,
  blanks: 2,
  timer: 0,
  rando: false,
  custom: true,
  boost: true,
}

export const RANDO_ID = 'rando'
export const RANDO = { name: 'Tío Random', avatar: '🤖' }

// How long the round result stays on screen before anyone can auto-advance.
export const RESULT_MS = 15_000
// A player counts as online if they pinged within this window.
export const ONLINE_MS = 35_000
// Client presence ping interval (piggybacks on a full state fetch).
export const PING_MS = 15_000

export const ROOM_TTL_S = 12 * 60 * 60
export const DECK_TTL_S = 365 * 24 * 60 * 60
