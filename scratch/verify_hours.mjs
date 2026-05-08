import fs from 'fs'
import readline from 'readline'
import path from 'path'

const filePath = path.resolve(process.cwd(), 'results_depth20_hq2.json')

const parseTimeRange = (open_hours) => {
  if (!open_hours) return { open: '06:00', close: '22:00' }
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  let rangeStr = ''
  for (const day of days) {
    if (open_hours[day] && open_hours[day][0]) {
      rangeStr = open_hours[day][0]
      break
    }
  }
  if (!rangeStr) return { open: '06:00', close: '22:00' }

  if (rangeStr.toLowerCase().includes('open 24 hours')) {
    return { open: '00:00', close: '23:59' }
  }

  const parts = rangeStr.split(/[–-—]/)
  if (parts.length !== 2) return { open: '06:00', close: '22:00' }

  const parseTime = (s) => {
    const match = s.trim().match(/(\d+)(?::(\d+))?\s*(a\.m\.|p\.m\.|AM|PM)/i)
    if (!match) return null
    let [_, hours, mins, ampm] = match
    hours = parseInt(hours)
    mins = mins ? parseInt(mins) : 0
    if (ampm.toLowerCase().includes('p') && hours < 12) hours += 12
    if (ampm.toLowerCase().includes('a') && hours === 12) hours = 0
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`
  }

  const open = parseTime(parts[0]) || '06:00'
  const close = parseTime(parts[1]) || '22:00'
  return { open, close }
}

async function check() {
  const fileStream = fs.createReadStream(filePath)
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  })

  let count = 0
  for await (const line of rl) {
    if (!line.trim()) continue
    try {
      const data = JSON.parse(line)
      const hours = parseTimeRange(data.open_hours)
      console.log(`${data.title}: ${JSON.stringify(data.open_hours)} -> ${JSON.stringify(hours)}`)
      count++
      if (count > 10) break
    } catch (e) {
      // skip errors
    }
  }
}

check()
