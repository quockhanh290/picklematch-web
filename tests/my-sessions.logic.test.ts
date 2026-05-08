import { resolveTab } from '../lib/mySessionsLogic'

describe('resolveTab', () => {
  it('should return pending for host with pending request', () => {
    expect(resolveTab({ role: 'host', request_status: 'pending', status: 'open' })).toBe('pending')
  })
  it('should return pending for player with pending request', () => {
    expect(resolveTab({ role: 'player', request_status: 'pending', status: 'open' })).toBe('pending')
  })
  it('should return history for done session', () => {
    expect(resolveTab({ role: 'player', request_status: 'accepted', status: 'done' })).toBe('history')
  })
  it('should return upcoming for open session', () => {
    expect(resolveTab({ role: 'player', request_status: 'accepted', status: 'open' })).toBe('upcoming')
  })
})
