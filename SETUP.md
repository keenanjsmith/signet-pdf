# Setting up Signet PDF

Three parts. Only the first is required. Total time is about 25 minutes, and it's all free.

1. **Put the app online** (10 minutes): gives you a private web address that works on every device.
2. **Connect Google Drive** (10 minutes, optional): adds the Save to Google Drive button.
3. **Install it** on your phone and computer (1 minute each).

Wherever you see `USERNAME` below, use your GitHub username.

---

## Part 1: Put the app online with GitHub Pages

GitHub Pages hosts the app for free. It only serves the app's files. Your PDFs are never sent to it.

1. Sign in to [github.com](https://github.com) (or create a free account).
2. Click **+** (top right) → **New repository**.
   - Repository name: `signet-pdf`
   - Choose **Public** (required for free GitHub Pages; the app's code is public, your documents never are).
   - Click **Create repository**.
3. On the new repository page, click **uploading an existing file**.
4. Unzip `signet-pdf.zip` on your computer and drag **everything inside the `signet-pdf` folder** into the upload box, including the `.github` folder.
   - On a Mac, `.github` is hidden in Finder. Press **Cmd + Shift + .** (period) to show hidden files, then drag it too.
   - Click **Commit changes**.
5. Go to the repository's **Settings** → **Pages**. Under **Build and deployment**, set **Source** to **GitHub Actions**.
6. Open the **Actions** tab. A run named **Deploy to GitHub Pages** starts (if it doesn't, click it on the left and press **Run workflow**). Wait for the green check, about 2 minutes.
7. Your app is live at **`https://USERNAME.github.io/signet-pdf/`**. Open it and try signing a PDF.

---

## Part 2: Connect Google Drive (optional)

This creates your own Google "app" that only you can sign in to. Google requires this for any app that saves to Drive. It's free and needs no credit card.

### A. Create a project and turn on Drive

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and sign in with the Google account whose Drive you want to use.
2. Click the project picker at the top left → **New project**. Name it `Signet PDF` → **Create**. Make sure it's selected afterward.
3. In the search bar at the top, type **Google Drive API**, open it, and click **Enable**.

### B. Set up the sign-in screen

4. In the search bar, type **OAuth consent screen** and open it (it may be labeled **Google Auth Platform**). Click **Get started**.
   - App name: `Signet PDF`. User support email: your email. **Next**.
   - Audience: **External**. **Next**.
   - Contact email: your email. **Next**.
   - Agree to the policy → **Continue** → **Create**.
5. Open **Audience** (left menu). Under **Test users**, click **Add users**, enter your Gmail address, and save.
   Leave the app in **Testing**. That means only you (and anyone else you add here) can connect. That's what you want.
6. Open **Data Access** → **Add or remove scopes**. In the filter, type `drive.file` and tick the row ending in **`/auth/drive.file`**. Click **Update**, then **Save**.

### C. Create the Client ID

7. Open **Clients** → **Create client**.
   - Application type: **Web application**
   - Name: `Signet web`
   - Under **Authorized JavaScript origins**, click **Add URI** and enter exactly `https://USERNAME.github.io`
     (no `/signet-pdf`, no slash at the end).
   - Leave redirect URIs empty. Click **Create**.
8. Copy the **Client ID** (it ends in `.apps.googleusercontent.com`). You don't need the client secret; the app never uses it.

### D. Give the Client ID to Signet

Pick one:

- **Quick:** open Signet → gear icon (Settings) → paste the Client ID → **Save**. Do this once on each device.
- **Every device at once:** in your GitHub repository go to **Settings** → **Secrets and variables** → **Actions** → **Variables** tab → **New repository variable**. Name `GOOGLE_CLIENT_ID`, value = your Client ID. Then **Actions** → **Deploy to GitHub Pages** → **Run workflow**.
  (The Client ID is not a secret. Google sends it to every browser that signs in.)

### First save to Drive

The first time you tap **Save to Google Drive**, Google shows a sign-in window. Because this is your own app in Testing mode, Google says it **hasn't verified this app**. That's expected: click **Continue**, and allow access when asked. Files go into a folder called **Signet PDF** in your Drive.

### Optional: open PDFs from Google Drive

Signet's Save button works with just the Client ID. To also get an **Open from Google Drive** button:

1. Search for **Google Picker API** and click **Enable**.
2. Search for **Credentials** → **Create credentials** → **API key**. Open the new key and set:
   - Application restrictions: **Websites**, add `https://USERNAME.github.io/*`
   - API restrictions: **Restrict key** → **Google Picker API**. Save.
3. Find your **Project number** on the console's home page (project info card).
4. In Signet → Settings → **Optional: open files from Drive**, enter the API key and project number. (Or add repository variables `GOOGLE_API_KEY` and `GOOGLE_APP_ID`.)

---

## Part 3: Install the app

Open `https://USERNAME.github.io/signet-pdf/`, then:

- **Android (Chrome):** menu **⋮** → **Install app** (or **Add to Home screen**). After installing, Signet appears in the share menu, so you can share a PDF from email or Files straight into it.
- **iPhone / iPad (Safari):** Share button → **Add to Home Screen**.
- **Windows / Mac (Chrome or Edge):** click the install icon at the right end of the address bar. Afterward you can right-click a PDF → **Open with** → **Signet PDF**.

Once installed it works offline. When you publish a new version, it updates itself the next time it opens.

---

## Using it

1. Open a PDF.
2. Tap a fill-in box to type in it (if the PDF has them).
3. Tap **Signature**, **Initials**, **Text**, **Date**, **Check** or **X**. It appears in the middle of the screen. Drag it into place; drag the blue corner dot to resize; tap the red ✕ to remove it. **Undo** is at the top.
4. Tap **Finish** → **Create signed PDF** → **Save to Google Drive**, **Share or send**, or **Download**.

### Digital IDs (optional)

Most paperwork only needs your drawn signature. Some places ask for a certificate ("digital") signature. In Signet: home screen → **Digital IDs** → **Manage**.

- **Create personal ID:** free and instant. Recipients see a valid, untampered signature from you. Adobe may show "signer's identity is unknown" because no company vouched for the ID; that's normal for personal IDs.
- **Import .p12 / .pfx:** if an employer, agency or certificate company gave you one, import it here for a fully trusted signature.
- Tap the download icon next to an ID to **save a backup**. If you clear the browser or change phones, you'll need it.

Then on the Finish screen, tick **Add digital ID signature**. Do this as the very last step: any change after a digital ID is added shows as tampering.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| Google says **access blocked** or **app not available** | Part 2, step 5: add your Gmail as a test user. |
| Google says **origin mismatch** or **invalid origin** | Part 2, step 7: the origin must be exactly `https://USERNAME.github.io`. |
| **Pop-up blocked** message | Allow pop-ups for the site, then tap Save to Google Drive again. |
| On an iPhone home-screen app, Google sign-in doesn't come back to Signet | Use **Share or send** → **Save to Files** → **Google Drive** (or the Drive app in the share sheet). Or open Signet in Safari for Drive saves. |
| Actions run fails | Make sure the `.github` folder was uploaded and Pages source is **GitHub Actions**. |
| A PDF asks for a password | Enter the password you were given for that file. The signed copy you create won't need one. |
