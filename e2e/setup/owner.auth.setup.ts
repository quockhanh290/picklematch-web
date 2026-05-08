import fs from 'node:fs'
import path from 'node:path'
import { test as setup } from '@playwright/test'

import { buildOwnerAuthStorageState } from '../helpers/auth'

const authFile = 'e2e/.auth/owner.json'

setup('authenticate owner for web smoke', async ({ request, baseURL }) => {
  const origin = baseURL ?? 'http://127.0.0.1:4173'
  const storageState = await buildOwnerAuthStorageState(request, {
    email: 'host.confirmed@picklematch.vn',
    origin,
  })
  fs.mkdirSync(path.dirname(authFile), { recursive: true })
  fs.writeFileSync(authFile, JSON.stringify(storageState, null, 2), 'utf8')
})
