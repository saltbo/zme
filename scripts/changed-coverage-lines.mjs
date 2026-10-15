// LCOV counts a multiline statement at its first executable line. Use the
// native statement ranges when a changed object member has no separate counter.
export function changedExecutableLines(changedLines, lineCounts, statementMap) {
  const result = new Set()
  for (const line of changedLines) {
    if (lineCounts.has(line)) {
      result.add(line)
      continue
    }
    const containing = Object.values(statementMap).filter(
      (statement) => statement.start.line <= line && line <= statement.end.line,
    )
    if (containing.length === 0) continue
    const width = (statement) =>
      (statement.end.line - statement.start.line) * 1_000_000 + statement.end.column - statement.start.column
    const smallest = Math.min(...containing.map(width))
    for (const statement of containing.filter((item) => width(item) === smallest)) {
      if (!lineCounts.has(statement.start.line)) {
        throw new Error(`Native statement at line ${statement.start.line} has no LCOV counter.`)
      }
      result.add(statement.start.line)
    }
  }
  return result
}
