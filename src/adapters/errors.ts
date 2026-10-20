export class TraceImportError extends Error {
  issues: string[]

  constructor(message: string, issues: string[] = []) {
    super(message)
    this.name = 'TraceImportError'
    this.issues = issues
  }
}
