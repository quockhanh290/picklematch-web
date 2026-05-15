import type { Gender, GenderPreference, PlayerSessionState } from '../../../lib/next-round-suggester/types'

type RawRealPlayer = {
  id: string
  name: string
  checkIn: 'present' | 'pending' | 'no_show'
  pvna: number
  gender: 'female' | 'male'
  partner: 'female' | 'male' | 'any'
  opponent: 'female' | 'male' | 'any'
}

const REAL_SESSION_ROWS: RawRealPlayer[] = [
  row('04329ee4-fa05-4736-9d47-a622c3be2b3f', 'P12', 'present', 3.12, 'female', 'female', 'female'),
  row('0d39e9f4-2f5e-45e8-a441-cc7986c8f6da', 'P8', 'present', 2.92, 'female', 'any', 'female'),
  row('39dd4d6c-21da-4804-a111-dded98dc3936', 'P30', 'present', 4.06, 'female', 'female', 'any'),
  row('3aa28af6-d13e-450b-aa9b-645bb00784da', 'P40', 'present', 2.58, 'female', 'male', 'female'),
  row('3b048d8a-00f5-42ca-8fbc-761750f0b32f', 'P26', 'pending', 3.85, 'female', 'any', 'any'),
  row('3c4a327a-cb79-4d7e-adcc-aa0889b5c41d', 'P7', 'present', 2.86, 'male', 'female', 'any'),
  row('3e5ae0fa-0dad-4753-9468-4ab3f328df8d', 'P32', 'present', 4.16, 'female', 'any', 'female'),
  row('49910ae8-967a-4533-9d9b-ff913e36657c', 'P13', 'pending', 3.18, 'male', 'female', 'female'),
  row('4d5b85a0-c232-4f96-b1d9-edc870dc7c25', 'P3', 'present', 2.66, 'male', 'male', 'any'),
  row('4d685b70-f343-4120-8bcc-7bd87059479f', 'P31', 'pending', 4.11, 'male', 'female', 'any'),
  row('5212b2e0-3ab0-4585-b441-2744602f372d', 'P15', 'pending', 3.28, 'male', 'male', 'any'),
  row('524a1663-d809-4f48-aa0c-56004264eb59', 'P36', 'pending', 4.37, 'female', 'female', 'female'),
  row('58ff3702-9a28-4fda-8f75-0d2396ac67ae', 'P24', 'present', 3.75, 'female', 'female', 'female'),
  row('5ca9a6e9-9c67-459d-a0ee-baea5824eb1a', 'P16', 'present', 3.33, 'female', 'male', 'female'),
  row('7248af20-7646-4cf2-a207-a72652c0cbf7', 'P34', 'pending', 4.27, 'female', 'male', 'any'),
  row('77523c86-fe28-4ff4-b470-230d866a4d39', 'P2', 'present', 2.6, 'female', 'any', 'any'),
  row('7f426e13-8fd4-4a3b-be14-97df95777dd7', 'P27', 'present', 3.9, 'male', 'male', 'any'),
  row('8146301b-9da5-4f03-ba8c-b2bc8aff73c3', 'P39', 'present', 2.53, 'male', 'male', 'any'),
  row('83c04d93-2ddf-41f0-b525-20cc10a29141', 'P9', 'present', 2.97, 'male', 'male', 'female'),
  row('843b02e4-cc93-4da8-b57b-da9f46bc4078', 'P28', 'present', 3.96, 'female', 'male', 'female'),
  row('900d67a2-ccd1-4097-9564-c53b0afb9806', 'P14', 'present', 3.23, 'female', 'any', 'any'),
  row('9d382246-45f4-44c6-af9e-6c45348b3bd7', 'P29', 'pending', 4.01, 'male', 'any', 'female'),
  row('9e8c9a44-965c-4caf-aeef-ea434cd8299f', 'P19', 'pending', 3.49, 'male', 'female', 'any'),
  row('a2ac96bb-cfc6-4037-87e0-668428e6d621', 'P22', 'pending', 3.64, 'female', 'male', 'any'),
  row('a3f1a7be-3385-4179-9c55-48e3e44a9e2d', 'P10', 'present', 3.02, 'female', 'male', 'any'),
  row('ac982516-5501-44a6-b3be-07ae41dd57ad', 'P18', 'present', 3.44, 'female', 'female', 'any'),
  row('b0bf3706-e7cb-41ef-83a8-12b2bfce7075', 'P1', 'present', 2.55, 'male', 'female', 'female'),
  row('b9f6d4a8-c5a6-4366-a71a-9a71cf125de1', 'P33', 'pending', 4.22, 'male', 'male', 'female'),
  row('bbb97109-21c4-4f50-b6ff-75b439124fae', 'P11', 'present', 3.07, 'male', 'any', 'any'),
  row('ce92a7b6-93b3-4b9b-89c7-6ad34bc75318', 'P4', 'present', 2.71, 'female', 'male', 'female'),
  row('d14aec71-7461-405d-bc6a-b12c83c32efc', 'P37', 'present', 4.42, 'male', 'female', 'female'),
  row('d46f77f6-d63b-419d-9b59-9bd7a4264698', 'P35', 'pending', 4.32, 'male', 'any', 'any'),
  row('d54a0fa3-fb8d-481f-b38b-38ce2590db0e', 'P5', 'pending', 2.76, 'male', 'any', 'female'),
  row('de12c501-42c7-468c-868e-cfdfdb7ba9be', 'P23', 'present', 3.7, 'male', 'any', 'any'),
  row('e986708c-62f3-4717-99c9-c2313df5bbbc', 'P6', 'present', 2.81, 'female', 'female', 'any'),
  row('e9d680c2-b307-4fd4-a962-0aea26d6e841', 'P25', 'present', 3.8, 'male', 'female', 'female'),
  row('ec2c76cf-bba5-4671-9961-dbd24a81bd66', 'P38', 'pending', 4.48, 'female', 'any', 'any'),
  row('ec85e0e6-b91c-494c-836c-25c9919a26a0', 'P20', 'pending', 3.54, 'female', 'any', 'female'),
  row('ecac57af-8aee-47b1-ba37-fa12aa0ca24a', 'P21', 'present', 3.59, 'male', 'male', 'female'),
  row('fbda6805-4f6c-4f13-89fa-04f356a6573a', 'P17', 'pending', 3.38, 'male', 'any', 'female'),
  row('24ae401a-2033-4f03-9eb8-0df47ce41e62', 'host', 'no_show', 3.2, 'female', 'any', 'any'),
]

export function createRealSessionPlayers(options: { includePending?: boolean } = {}): PlayerSessionState[] {
  const includePending = options.includePending ?? true
  const rows = REAL_SESSION_ROWS.filter((item) => {
    if (item.checkIn === 'no_show') return false
    if (!includePending && item.checkIn !== 'present') return false
    return true
  })
  const checkedInAt = new Date('2026-05-15T12:00:00.000Z')

  return rows.map((item) => ({
    player_id: item.name,
    pvna: item.pvna,
    group_id: null,
    checked_in_at: checkedInAt,
    checked_out_at: null,
    matches_played: 0,
    last_played_round: -1,
    consecutive_rest: 0,
    consecutive_play: 0,
    partner_counts: new Map(),
    opponent_counts: new Map(),
    opted_rest: false,
    gender: normalizeGender(item.gender),
    partner_gender_pref: normalizePref(item.partner),
    opponent_gender_pref: normalizePref(item.opponent),
  }))
}

export function realSessionPlayerCount(options: { includePending?: boolean } = {}): number {
  return createRealSessionPlayers(options).length
}

function row(
  id: string,
  name: string,
  checkIn: RawRealPlayer['checkIn'],
  pvna: number,
  gender: RawRealPlayer['gender'],
  partner: RawRealPlayer['partner'],
  opponent: RawRealPlayer['opponent'],
): RawRealPlayer {
  return { id, name, checkIn, pvna, gender, partner, opponent }
}

function normalizeGender(value: RawRealPlayer['gender']): Gender {
  return value === 'female' ? 'F' : 'M'
}

function normalizePref(value: RawRealPlayer['partner']): GenderPreference {
  if (value === 'female') return 'F'
  if (value === 'male') return 'M'
  return 'any'
}
