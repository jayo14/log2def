export function validReportImageCaption(caption: string): boolean {
  return caption.trim().split(/\s+/).filter(Boolean).length >= 3;
}

export function reportImageLabel(index: number, caption: string): string {
  return `Figure A.${index}: ${caption.trim()}`;
}
