# Design Notes

## Broad host permissions (`<all_urls>`)

When the extension is submitted, the Chrome Web Store flags `<all_urls>` (in `host_permissions` and `content_scripts.matches`) as a broad host permission. That triggers an in-depth review and delays publishing.

**Decision:** superseded. The extension now requests `<all_urls>` as an optional host permission (see Alternatives considered), which avoids the broad host permission flag at install. The reasoning below still explains why access is needed once Auto Scroll or Pause On Hover is on.

### Why stores are concerned

With `<all_urls>`, an extension's code can run on every site the user visits. That includes banks, email, password managers and internal company tools. On any of them it could:

- Read page content, including messages, account numbers and form fields as the user types.
- Change pages, for example by injecting ads, swapping links or adding fake login forms.
- Grab session data and send it to an outside server.

Reviewers treat it as high risk because:

- **Malware uses it the most.** Fake ad blockers, data harvesters and ad-injection extensions almost always request this permission.
- **Updates install silently.** An extension can launch harmless and later ship a malicious update. Sometimes this happens after the developer account is sold or hacked. Chrome installs the update with no new prompt, because the permission was already granted.
- **Users click through the warning.** "Read and change all your data on all websites" is so common that most people accept it without thinking.
- **Clean code still matters.** If a bug in the content script lets a hostile page abuse it, that weakness exists on every site at once.

### Why this extension still needs it

Reviewers mainly check that the permission matches what the extension does. Here it does:

- Users pick which sites rotate, so the list can't be fixed in advance.
- `activeTab` only works right after a click, but tabs switch on a timer with nobody there.
- The content script only scrolls the page and detects mouse hover. It doesn't read or change page content, and nothing is sent anywhere.

### What actually uses host access

Only `content_scroll.js` needs it, for Auto Scroll and Pause On Hover. Tab switching, refresh, rules, On Activity pause, the badge and full screen all work through the `tabs`, `idle`, `alarms` and `windows` APIs, which don't need host access.

### Alternatives considered

- **`activeTab`:** rejected. It only grants access right after a user gesture, but rotation runs unattended.
- **Specific sites in `host_permissions`:** rejected. The sites are chosen by the user and are often internal or self-hosted.
- **`optional_host_permissions`:** adopted in place of the decision above. `<all_urls>` is an optional host permission and the content script is registered at runtime with `chrome.scripting.registerContentScripts` (`syncContentScript()` in `background.js`). Chrome asks for access the first time the user turns on Auto Scroll or Pause On Hover. The rules page shows an **Allow site access** notice if the prompt was declined or the access was revoked. Until granted, scrolling and hover pause do nothing and everything else works.
