// Certificate (digital ID) signing.
// Produces a standard PKCS#7 detached signature (adbe.pkcs7.detached),
// which Adobe Acrobat, Foxit, Preview-compatible validators and pdfsig all read.
// Everything happens locally. Keys never leave the device.

import forge from 'node-forge';
import { PDFDocument, PDFName, PDFNumber, PDFHexString, PDFString, PDFArray } from '@cantoo/pdf-lib';

const SIG_SIZE = 16384; // bytes reserved for the signature (hex doubles this)
const BYTE_RANGE_PLACEHOLDER = '**********';

/* ---------- helpers ---------- */

function u8ToBinary(u8) {
  let out = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) {
    out += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  }
  return out;
}

function binaryToU8(bin) {
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i) & 0xff;
  return u8;
}

function indexOfBytes(hay, needle, from = 0) {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

function lastIndexOfBytes(hay, needle) {
  outer: for (let i = hay.length - needle.length; i >= 0; i--) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

const enc = (s) => new TextEncoder().encode(s);

/* ---------- identity (certificate + key) ---------- */

/** Read a .p12 / .pfx file. Returns { key, cert, chain, name, email, notAfter }. */
export function readP12(bytes, password) {
  let p12;
  try {
    const asn1 = forge.asn1.fromDer(u8ToBinary(bytes));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/mac|password|Invalid/i.test(msg)) throw new Error('That password did not unlock this certificate file.');
    throw new Error('This certificate file could not be read (' + msg + ').');
  }
  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || []),
  ];
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const key = keyBags.find((b) => b.key)?.key;
  if (!key) throw new Error('No private key found in this file. Export it again with "include private key" turned on.');
  const certs = certBags.map((b) => b.cert).filter(Boolean);
  if (!certs.length) throw new Error('No certificate found in this file.');
  // The signing cert is the one whose public key matches the private key.
  const pubPem = forge.pki.publicKeyToPem(forge.pki.setRsaPublicKey(key.n, key.e));
  const cert = certs.find((c) => forge.pki.publicKeyToPem(c.publicKey) === pubPem) || certs[0];
  const chain = certs.filter((c) => c !== cert);
  return { key, cert, chain, ...describeCert(cert) };
}

export function describeCert(cert) {
  const cn = cert.subject.getField('CN')?.value || 'Unknown';
  const email = cert.subject.getField('E')?.value || cert.subject.getField({ name: 'emailAddress' })?.value || '';
  const issuer = cert.issuer.getField('CN')?.value || cert.issuer.getField('O')?.value || '';
  const selfSigned = cert.isIssuer(cert);
  return { name: cn, email, issuer, selfSigned, notBefore: cert.validity.notBefore, notAfter: cert.validity.notAfter };
}

/** Create a personal (self-signed) digital ID. Returns .p12 bytes protected by password. */
export async function createPersonalId({ name, email, password, years = 5 }) {
  let keys;
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    // Fast native key generation, then hand the key to forge.
    const kp = await subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true, ['sign', 'verify']);
    const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', kp.privateKey));
    const privateKey = forge.pki.privateKeyFromAsn1(forge.asn1.fromDer(u8ToBinary(pkcs8)));
    keys = { privateKey, publicKey: forge.pki.setRsaPublicKey(privateKey.n, privateKey.e) };
  } else {
    keys = forge.pki.rsa.generateKeyPair({ bits: 3072, e: 0x10001 });
  }
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  const serial = forge.util.bytesToHex(forge.random.getBytesSync(16));
  cert.serialNumber = (parseInt(serial[0], 16) & 7).toString(16) + serial.slice(1); // positive
  const now = new Date();
  cert.validity.notBefore = new Date(now.getTime() - 60 * 1000);
  cert.validity.notAfter = new Date(now.getTime());
  cert.validity.notAfter.setFullYear(now.getFullYear() + years);
  const attrs = [{ name: 'commonName', value: name }];
  if (email) attrs.push({ name: 'emailAddress', value: email });
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
    { name: 'extKeyUsage', emailProtection: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, {
    algorithm: '3des', // widest compatibility (Windows, macOS, Acrobat)
    friendlyName: name,
  });
  return binaryToU8(forge.asn1.toDer(p12Asn1).getBytes());
}

/* ---------- signing ---------- */

/**
 * Sign a finished PDF with a digital ID.
 * @param {Uint8Array} pdfBytes  final PDF (signatures/text already flattened)
 * @param {{key, cert, chain}} id from readP12
 * @param {{reason?, location?, contactInfo?}} info
 * @returns {Promise<Uint8Array>} signed PDF
 */
export async function signPdfWithId(pdfBytes, id, info = {}) {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const ctx = doc.context;
  const pages = doc.getPages();
  const page = pages[0];

  const signerName = describeCert(id.cert).name;
  const sigDict = ctx.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'adbe.pkcs7.detached',
    ByteRange: PDFArray.withContext(ctx),
    Contents: PDFHexString.of('0'.repeat(SIG_SIZE * 2)),
    M: PDFString.fromDate(new Date()),
    Name: PDFString.of(signerName),
  });
  // ByteRange placeholder: four big numbers we can overwrite in place.
  const br = sigDict.get(PDFName.of('ByteRange'));
  br.push(PDFNumber.of(0));
  br.push(PDFName.of(BYTE_RANGE_PLACEHOLDER));
  br.push(PDFName.of(BYTE_RANGE_PLACEHOLDER));
  br.push(PDFName.of(BYTE_RANGE_PLACEHOLDER));
  if (info.reason) sigDict.set(PDFName.of('Reason'), PDFString.of(info.reason));
  if (info.location) sigDict.set(PDFName.of('Location'), PDFString.of(info.location));
  if (info.contactInfo) sigDict.set(PDFName.of('ContactInfo'), PDFString.of(info.contactInfo));
  const sigRef = ctx.register(sigDict);

  // Invisible signature field (the visible ink is already on the page).
  let n = 1;
  const form = doc.getForm();
  const existing = new Set(form.getFields().map((f) => f.getName()));
  while (existing.has('Signature' + n)) n++;
  const widget = ctx.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    Rect: [0, 0, 0, 0],
    V: sigRef,
    T: PDFString.of('Signature' + n),
    F: 4,
    P: page.ref,
  });
  const widgetRef = ctx.register(widget);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (annots instanceof PDFArray) annots.push(widgetRef);
  else page.node.set(PDFName.of('Annots'), ctx.obj([widgetRef]));
  const acro = form.acroForm.dict;
  const fields = acro.lookup(PDFName.of('Fields'));
  fields.push(widgetRef);
  acro.set(PDFName.of('SigFlags'), PDFNumber.of(3));

  const saved = await doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
  let pdf = new Uint8Array(saved);

  // Locate placeholders.
  const brToken = enc(`/ByteRange [ 0 /${BYTE_RANGE_PLACEHOLDER} /${BYTE_RANGE_PLACEHOLDER} /${BYTE_RANGE_PLACEHOLDER} ]`);
  const brPos = lastIndexOfBytes(pdf, brToken);
  if (brPos < 0) throw new Error('Could not prepare the signature (byte range).');
  const contentsToken = enc('/Contents <' + '0'.repeat(64));
  const cPos = indexOfBytes(pdf, contentsToken, Math.max(0, brPos - SIG_SIZE * 2 - 4096));
  if (cPos < 0) throw new Error('Could not prepare the signature (contents).');
  const sigStart = cPos + '/Contents '.length; // position of '<'
  const sigEnd = sigStart + SIG_SIZE * 2 + 2;  // after '>'
  if (pdf[sigStart] !== 0x3c || pdf[sigEnd - 1] !== 0x3e) throw new Error('Signature placeholder misaligned.');

  const byteRange = [0, sigStart, sigEnd, pdf.length - sigEnd];
  let brStr = `/ByteRange [${byteRange.join(' ')}]`;
  if (brStr.length > brToken.length) throw new Error('Byte range too long.');
  brStr = brStr + ' '.repeat(brToken.length - brStr.length);
  pdf.set(enc(brStr), brPos);

  // Bytes covered by the signature.
  const signed = new Uint8Array(byteRange[1] + byteRange[3]);
  signed.set(pdf.subarray(0, byteRange[1]), 0);
  signed.set(pdf.subarray(byteRange[2]), byteRange[1]);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(u8ToBinary(signed));
  p7.addCertificate(id.cert);
  for (const c of id.chain || []) p7.addCertificate(c);
  p7.addSigner({
    key: id.key,
    certificate: id.cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign({ detached: true });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  if (der.length > SIG_SIZE) throw new Error('Signature is larger than the reserved space.');
  const hex = forge.util.bytesToHex(der).toUpperCase().padEnd(SIG_SIZE * 2, '0');
  pdf.set(enc(hex), sigStart + 1);
  return pdf;
}
