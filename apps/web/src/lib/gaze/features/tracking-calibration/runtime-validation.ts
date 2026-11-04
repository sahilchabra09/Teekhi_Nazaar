export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
export function isFiniteNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= 1e12
  )
}
export function isVector(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every(isFiniteNumber)
  )
}
export function isMatrix(
  value: unknown,
  rows: number,
  columns: number
): value is number[][] {
  return (
    Array.isArray(value) &&
    value.length === rows &&
    value.every((row) => isVector(row, columns))
  )
}
export function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: string[]
): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}
