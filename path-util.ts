// Graph node ids are vault-relative markdown paths without the .md extension,
// e.g. "Projects/My Note" for a file at "Projects/My Note.md".
export function stripMarkdownExtension(path: string): string {
  return path.replace(/\.md$/, "");
}
