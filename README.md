# Signet PDF

Sign and fill PDFs on your phone or computer, privately. Free and open source.

Signet is one app that installs on Windows, Mac, Linux, Android and iPhone from the browser. Open a PDF, add your signature, initials, text, dates and check marks, fill in form boxes, then save it to Google Drive, share it, or download it. The file you get opens correctly in any PDF reader, because everything you add is written into the page itself.

## What it does

- **Sign**: draw with a finger, stylus or mouse, type your name in a handwriting style, or use a photo of your real signature (the paper background is removed for you). Blue or black ink.
- **Reuse**: signatures and initials can be saved on your device and placed with one tap.
- **Fill forms**: type straight into a PDF's fill-in boxes and tick its check boxes. A bar shows how many boxes there are and a **Next box** button jumps to the next empty one. Choose to lock the answers when you finish so they can't be changed.
- **Sign here boxes**: signature boxes (and signature lines on flat PDFs) get a yellow **Sign here** tag. One tap fits your signature into the box, and the matching "date signed" boxes get today's date.
- **My info**: save your name, contact details and address once, and Signet fills them into matching boxes when you open a form, highlighted green for you to check, with one-tap undo. Private details (Social Security number, date of birth, VA file and service numbers) are encrypted with a passcode and only filled after you unlock them. It skips boxes about other people (spouse, emergency contact, witness, landlord, representative, "new address", and so on).
- **Flat PDFs**: on PDFs with no real fill-in boxes, Signet finds the blanks people write on (boxes, `______` lines, signature lines) so you can tap one to type on it, and fills them from My info too. Scanned paper forms (pictures of pages) still need you to place things yourself.
- **Add text, dates, ✓ and ✕** anywhere on the page. Drag to move, drag the corner dot to resize, undo any step.
- **Digital ID signatures (optional)**: add a certificate signature that proves who signed and that nothing changed afterward. Import a `.p12`/`.pfx` you already have, or create a free personal ID in the app.
- **Protected PDFs**: files with editing restrictions open normally, and files that need a password ask for it once.
- **Save anywhere**: save to Google Drive (into a "Signet PDF" folder), use your phone's share menu (email, Messages, Files, Drive app), or download.
- **Open from anywhere**: choose a file, drag it in, share it to Signet from another Android app, double-click a PDF (installed desktop app), or pick from Google Drive (optional).
- **Works offline** once installed.

## Privacy and security

- **Your PDFs never leave your device** unless you tap Save to Google Drive. There is no Signet server, no account, no analytics, no ads and no tracking.
- **Saved signatures and digital IDs stay in this browser** on this device. Digital IDs stay locked with your password, and the password is never stored. Unlocked IDs are held in memory only until the app closes.
- **My info stays on this device.** Everyday details are saved like browser autofill. Private details are encrypted with AES-256-GCM using a key made from your passcode (PBKDF2-SHA256, 600,000 rounds); the passcode is never saved, and unlocked details live only in memory and lock again after 15 minutes or when the app closes. Finding boxes and deciding what goes where all happens on the device, with no AI service or server involved.
- **Google is only contacted if you set up Drive.** The app then asks for the narrowest Drive permission (`drive.file`): it can see only files it saved for you or files you pick yourself, not the rest of your Drive. The sign-in token lives in memory and is forgotten when the app closes.
- **You own the Google connection.** Drive goes through your own free Google Cloud project, so no third party sits in between.
- **A strict Content Security Policy** stops the app from loading code or sending data anywhere except itself and, when you use Drive, Google.
- **PDF scripts are never run**, and links inside PDFs open in a separate tab with no access to the app.
- **"Erase everything"** in Settings wipes all saved signatures, IDs and settings from the device.

Note on dependencies: `npm audit` reports an advisory for node-forge about *verifying* RSA signatures. Signet only *creates* signatures with node-forge and never verifies them with it, so that issue does not apply here.

## Getting started

See **[SETUP.md](SETUP.md)** for step-by-step instructions: putting the app online for free with GitHub Pages, connecting Google Drive, and installing it on your phone and computer.

## For developers

```bash
npm install
npm run dev        # local development server
npm run build      # production build in dist/
npm test           # builds, then runs the browser tests (needs: npx playwright install chromium)
```

Built with [pdf.js](https://github.com/mozilla/pdf.js) (Mozilla's PDF engine, used by Firefox) for viewing and form filling, [pdf-lib](https://github.com/cantoo-scribe/pdf-lib) for writing PDFs, and [node-forge](https://github.com/digitalbazaar/forge) for digital ID signatures. No frameworks; the source is small enough to read in an afternoon.

```
src/
  main.js          screens and app flow
  viewer.js        PDF display (pdf.js), zoom, pinch
  items.js         things placed on the page: drag, resize, undo
  sigpad.js        signature drawing, typing and photo cleanup
  pdf/load.js      opening PDFs, including protected ones
  pdf/export.js    writing the finished PDF
  pdf/certsign.js  digital ID signatures (PKCS#7, adbe.pkcs7.detached)
  fields/scan.js   finds form boxes, their labels, and blanks on flat PDFs
  fields/match.js  decides which of your details goes in which box
  smart.js         sign-here tags, autofill, next box
  profile.js       My info, with encrypted private details
  drive.js         Google Drive (drive.file scope)
  store.js         on-device storage (IndexedDB)
  sw-template.js   offline support and Android share menu
tests/             browser tests that drive the real app and check the output PDFs
```

The tests open real PDFs in Chromium, sign and fill them the way a person would, and save the results. They cover form filling and locking, My info autofill (including boxes it must leave alone), sign-here boxes and signing dates, blanks on flat PDFs, placement accuracy on rotated pages, protected PDFs, digital ID signatures, Google Drive uploads (against a stand-in for Google), the Android share menu, offline use, and a check that the app sends nothing anywhere during normal use.

## License

MIT. See [LICENSE](LICENSE). Bundled fonts are under the SIL Open Font License.
