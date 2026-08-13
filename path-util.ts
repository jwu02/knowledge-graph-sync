// Graph node ids are note basenames without the .md extension, e.g. "My Note"
// for a file at "Projects/My Note.md".
export function basenameWithoutExtension(path: string): string {
  const basename = path.split("/").pop() ?? path;
  return basename.replace(/\.md$/, "");
}
