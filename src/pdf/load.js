// Loading PDFs for editing, including protected ones.
import { PDFDocument, PDFName, PDFDict, PDFStream, PDFInvalidObject } from '@cantoo/pdf-lib';

export class PasswordNeededError extends Error {
  constructor(wrong) {
    super(wrong ? 'That password is not right.' : 'This PDF is password protected.');
    this.name = 'PasswordNeededError';
    this.wrong = wrong;
  }
}

/**
 * Load a PDF for editing. Handles "owner password" (restriction-only) files
 * transparently and asks for a password for files that need one to open.
 * The result is always an unencrypted document, so what you send can be opened
 * by anyone you send it to.
 */
export async function loadForEdit(bytes, password) {
  let doc;
  try {
    doc = await PDFDocument.load(bytes, {
      password: password ?? '',
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch (e) {
    const msg = String(e?.message || e);
    if (/NEEDS PASSWORD/i.test(msg)) throw new PasswordNeededError(false);
    if (/Password incorrect/i.test(msg)) throw new PasswordNeededError(true);
    throw e;
  }
  scrubEncryptionLeftovers(doc);
  return doc;
}

// After decrypting, stale copies of the old cross-reference streams and the old
// encryption dictionary can remain as ordinary objects. Some readers would then
// think the new file is still encrypted, so remove them.
function scrubEncryptionLeftovers(doc) {
  const ctx = doc.context;
  const doomed = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFInvalidObject) {
      // Unparseable leftovers; an old cross-reference stream is the usual culprit.
      const head = new TextDecoder('latin1').decode(obj.data.subarray(0, 600)).replace(/\s+/g, '');
      if (head.includes('/Type/XRef')) doomed.push(ref);
      continue;
    }
    const dict = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : null;
    if (!dict) continue;
    const type = dict.get(PDFName.of('Type'));
    if (type === PDFName.of('XRef')) { doomed.push(ref); continue; }
    const filter = dict.get(PDFName.of('Filter'));
    if (filter === PDFName.of('Standard') && dict.has(PDFName.of('O')) && dict.has(PDFName.of('U'))) doomed.push(ref);
  }
  for (const ref of doomed) ctx.delete(ref);
  delete ctx.trailerInfo.Encrypt;
}
