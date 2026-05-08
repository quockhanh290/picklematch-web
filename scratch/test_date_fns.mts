import { format } from 'date-fns'
import { vi } from 'date-fns/locale/vi'

const date = new Date()
console.log(format(date, "EEEE, dd/MM", { locale: vi }))
