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
console.log('fixtures written');
