/** A two-letter monogram from a name: initials of the first two words, else the first two letters. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/)
  const first = words[0] ?? name
  const second = words[1]
  const letters = second ? `${first[0] ?? ""}${second[0] ?? ""}` : name.slice(0, 2)
  return letters.toUpperCase()
}

/** A cost as money, or undefined when there is nothing to show. */
export function money(cost: number): string | undefined {
  if (cost <= 0) return undefined
  return `$${cost < 1 ? cost.toFixed(4) : cost.toFixed(2)}`
}

/** Token counts, shortened: 15500 -> "15.5k". The decimal drops past 100k. */
export function tokens(count: number): string {
  if (count < 1000) return String(count)
  return `${(count / 1000).toFixed(count < 100_000 ? 1 : 0)}k`
}

/** HH:MM:SS from an ISO string. */
export function clock(iso: string): string {
  return iso.slice(11, 19)
}

/** Compact binary file size: 11,980 bytes -> "11kB", 1,572,864 -> "1.5MB". */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["kB", "MB", "GB", "TB"]
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length)
  const value = bytes / 1024 ** exponent
  const display = value < 10 ? value.toFixed(1).replace(/\.0$/, "") : String(Math.floor(value))
  return `${display}${units[exponent - 1]}`
}

/** A short relative time like "12 min", "2 h", "yesterday". */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ""
  const seconds = Math.round((Date.now() - then) / 1000)
  if (seconds < 45) return "just now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h`
  const days = Math.round(hours / 24)
  if (days === 1) return "yesterday"
  if (days < 7) return `${days} d`
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" })
}
