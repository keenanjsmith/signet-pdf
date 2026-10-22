// Builds simple test PDFs: plain, rotated pages, and a small fillable form.
import { PDFDocument, StandardFonts, degrees, rgb } from '@cantoo/pdf-lib';
import fs from 'node:fs';
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
{
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
  for (const rot of [0, 90, 180, 270]) {
    const p = d.addPage([612, 792]); p.setRotation(degrees(rot));
    p.drawText(`Page rotated ${rot}`, { x: 72, y: 700, size: 24, font: f });
    p.drawRectangle({ x: 72, y: 72, width: 200, height: 2, color: rgb(0, 0, 0) });
  }
  fs.writeFileSync(out + '/rotated.pdf', await d.save());
}
{
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([612, 792]);
  p.drawText('Simple Agreement', { x: 72, y: 720, size: 22, font: f });
  p.drawText('Name:', { x: 72, y: 640, size: 12, font: f });
  p.drawText('Agree to terms:', { x: 72, y: 600, size: 12, font: f });
  p.drawText('Signature: ______________________   Date: ____________', { x: 72, y: 200, size: 12, font: f });
  const form = d.getForm();
  const name = form.createTextField('applicant.name'); name.addToPage(p, { x: 130, y: 632, width: 250, height: 22 });
  const cb = form.createCheckBox('agree'); cb.addToPage(p, { x: 170, y: 596, width: 16, height: 16 });
  fs.writeFileSync(out + '/form.pdf', await d.save());
}
{
  // A filled-in field with no saved look (relies on the viewer to draw it).
  const { PDFName, PDFBool } = await import('@cantoo/pdf-lib');
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([612, 792]);
  p.drawText('Prefilled form', { x: 72, y: 720, size: 22, font: f });
  const form = d.getForm();
  const t = form.createTextField('prefilled'); t.addToPage(p, { x: 72, y: 640, width: 250, height: 22 }); t.setText('PREFILLED VALUE');
  form.createTextField('emptyone').addToPage(p, { x: 72, y: 600, width: 250, height: 22 });
  for (const fld of form.getFields()) for (const w of fld.acroField.getWidgets()) w.dict.delete(PDFName.of('AP'));
  form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
  fs.writeFileSync(out + '/noap.pdf', await d.save({ updateFieldAppearances: false }));
}
{
  // A typical fillable application: your details, someone else's, and a signature box.
  const { PDFName, PDFString } = await import('@cantoo/pdf-lib');
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica); const fb = await d.embedFont(StandardFonts.HelveticaBold);
  const p = d.addPage([612, 792]);
  const form = d.getForm();
  p.drawText('Membership Application', { x: 72, y: 730, size: 20, font: fb });
  let y = 680;
  const row = (label, name, x = 72, w = 300, opts = {}) => {
    p.drawText(label, { x, y: y + 6, size: 10, font: f });
    const tf = form.createTextField(name);
    if (opts.maxLen) tf.setMaxLength(opts.maxLen);
    tf.addToPage(p, { x: x + 130, y, width: w, height: 18 });
    return tf;
  };
  row('First name', 'Applicant.FirstName'); y -= 28;
  row('Last name', 'Applicant.LastName'); y -= 28;
  row('Street address', 'Applicant.Address'); y -= 28;
  row('City', 'Applicant.City', 72, 150); y -= 28;
  row('State', 'Applicant.State', 72, 40, { maxLen: 2 }); y -= 28;
  row('ZIP code', 'Applicant.Zip', 72, 80); y -= 28;
  row('Phone', 'Applicant.Phone', 72, 150); y -= 28;
  row('Email', 'Applicant.Email'); y -= 28;
  row('Date of birth', 'Applicant.DOB', 72, 100); y -= 28;
  row('Social Security No.', 'Applicant.SSN', 72, 100); y -= 40;
  p.drawText('Emergency contact', { x: 72, y: y + 10, size: 12, font: fb }); y -= 24;
  row('Name', 'EmergencyContact.Name'); y -= 28;
  row('Phone', 'EmergencyContact.Phone', 72, 150); y -= 28;
  row('Spouse name', 'SpouseName'); y -= 50;
  // Signature box (an unsigned digital signature field) and a date box.
  p.drawText('Applicant signature', { x: 72, y: y + 26, size: 10, font: f });
  p.drawRectangle({ x: 72, y, width: 260, height: 22, borderColor: rgb(0, 0, 0), borderWidth: 0.75 });
  const sigWidget = d.context.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', Rect: [72, y, 332, y + 22], T: PDFString.of('ApplicantSignature'), F: 4, P: p.ref });
  const sigRef = d.context.register(sigWidget);
  p.node.addAnnot(sigRef);
  form.acroForm.addField(sigRef);
  p.drawText('Date signed', { x: 360, y: y + 26, size: 10, font: f });
  form.createTextField('DateSigned').addToPage(p, { x: 360, y, width: 120, height: 22 });
  fs.writeFileSync(out + '/application.pdf', await d.save());
}
{
  // A flat agreement with blanks to write on: underscores, a drawn line, and boxes.
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica); const fb = await d.embedFont(StandardFonts.HelveticaBold);
  const p = d.addPage([612, 792]);
  p.drawText('Rental Agreement', { x: 72, y: 730, size: 20, font: fb });
  p.drawText('This agreement is made between the landlord and the tenant named below.', { x: 72, y: 700, size: 10, font: f });
  p.drawText('Tenant name: ______________________________', { x: 72, y: 660, size: 11, font: f });
  p.drawText('Phone: ____________________', { x: 72, y: 630, size: 11, font: f });
  p.drawText('Email address:', { x: 72, y: 600, size: 11, font: f });
  p.drawRectangle({ x: 160, y: 594, width: 250, height: 20, borderColor: rgb(0, 0, 0), borderWidth: 0.75 });
  p.drawText('Emergency contact phone: ____________________', { x: 72, y: 560, size: 11, font: f });
  p.drawLine({ start: { x: 72, y: 220 }, end: { x: 300, y: 220 }, thickness: 0.8, color: rgb(0, 0, 0) });
  p.drawText('Tenant Signature', { x: 72, y: 208, size: 9, font: f });
  p.drawText('Date: ______________', { x: 340, y: 222, size: 11, font: f });
  p.drawLine({ start: { x: 72, y: 150 }, end: { x: 300, y: 150 }, thickness: 0.8, color: rgb(0, 0, 0) });
  p.drawText('Landlord Signature', { x: 72, y: 138, size: 9, font: f });
  fs.writeFileSync(out + '/agreement.pdf', await d.save());
}
{
  // A page with no text at all, like a scan.
  const d = await PDFDocument.create();
  const p = d.addPage([612, 792]);
  p.drawRectangle({ x: 72, y: 500, width: 300, height: 200, color: rgb(0.8, 0.8, 0.8) });
  fs.writeFileSync(out + '/notext.pdf', await d.save());
}
console.log('fixtures written');
