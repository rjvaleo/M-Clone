export function transportDocumentTitle(documentName: string | null): string {
  if (!documentName) return "Untitled";
  return documentName.replace(/\.(?:mclone(?:\.json)?|json)$/i, "");
}
