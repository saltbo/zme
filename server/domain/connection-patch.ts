export type StringMapPatch = Record<string, string | null> | null

export function patchStringMap(
  current: Record<string, string>,
  patch: StringMapPatch | undefined,
): Record<string, string> {
  if (patch === undefined) return current
  if (patch === null) return {}
  const result = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key]
    else result[key] = value
  }
  return result
}
