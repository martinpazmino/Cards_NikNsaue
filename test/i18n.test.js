import test from 'node:test'
import assert from 'node:assert/strict'
import { checkI18n } from '../scripts/check-i18n.js'

test('every UI string exists in Spanish and English', () => {
  assert.deepEqual(checkI18n(), [])
})
