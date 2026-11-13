# Feedback service: one-time setup (about 10 minutes)

The feedback service is a free Google Apps Script that runs under your Google account. It receives reports from the app, emails you Approve / Reject buttons, creates GitHub issues for what you approve, and emails reporters when their request ships.

## 1. Create the script
1. Go to **https://script.google.com** → **New project**. Rename it **Margin feedback**.
2. Delete the sample code in `Code.gs` and paste in the whole of [`feedback/Code.gs`](Code.gs). Press ⌘S / Ctrl+S to save.
3. In the function menu at the top, pick **setup** and press **Run**. Google asks you to authorize the script for your account: choose your account → **Advanced** → **Go to Margin feedback** → **Allow**.
   This creates a private "Margin feedback (private)" Sheet, a private Drive folder for attachments, and an hourly check.

## 2. Give it a GitHub token (only for the margin repo)
1. Open **https://github.com/settings/personal-access-tokens/new** (fine-grained token).
2. Fill in:
   - **Name:** Margin feedback
   - **Expiration:** 1 year
   - **Repository access:** Only select repositories → **GavinDPinto/margin**
3. Under **Repository permissions**, set **Contents: Read and write** and **Issues: Read and write**.
4. **Generate token** and copy it.
5. Back in Apps Script: ⚙️ **Project Settings** → **Script properties** → **Add script property**
   - Property: `GITHUB_TOKEN`
   - Value: paste the token
   - **Save**.
6. Optional check: pick **testGitHub** in the function menu → **Run**. The log should say the token works.

## 3. Publish it as a web app
1. **Deploy** → **New deployment** → gear icon → **Web app**.
2. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone
3. **Deploy** → copy the **Web app URL** (it ends in `/exec`).
4. Send that URL to Claude. Claude adds it to the app as `FEEDBACK_URL`, and the Feedback button goes live.

## Day to day
- Each report arrives in Gmail as **[Margin] 🐞 Bug report / 💡 Feature idea**. Tap **Approve →**, then **Approve & create GitHub issue** on the page that opens.
- To turn one down, tap **Reject**, type your reason, and check the email preview, then tap **Reject & send**. If the reporter asked for updates, they get a polite email that includes your note. Either way, the reason is saved in your Sheet.
- Changed your mind after approving? Open the same email and tap **Reject**. As long as the request hasn't shipped yet, you can still turn it down with a reason. Its GitHub issue is closed as "not planned", and the reporter gets the polite email.
- Within an hour Claude builds the change, ships it, closes the issue and emails you. If the reporter asked, they get an email with how to see it.
- Everything is logged in the private Sheet: reports, decisions, issue numbers and who was notified.

## If you change Code.gs later
Paste the new version, then **Deploy** → **Manage deployments** → ✏️ → **Version: New version** → **Deploy**. Doing it this way keeps the same URL.
