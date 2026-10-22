// File names shared by the editor and the PDF writer (kept separate so the
// editor doesn't have to load the PDF-writing library just for a name).

/** File name for a voice note, e.g. "Voice note 1 (page 2).m4a". */
export function voiceNoteName(it, n) {
  return `Voice note ${n} (page ${it.page}).${it.audio?.ext || 'm4a'}`;
}
