// The create/join responses already include the room state; keep it so the
// room screen renders instantly instead of flashing a spinner.
const primed = new Map()

export const primeRoom = (code, state) => primed.set(code, state)
export const peekPrimed = (code) => primed.get(code) || null
export const clearPrimed = (code) => primed.delete(code)
