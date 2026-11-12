# Normal Chrome scanner

Version 0.2 supports approved Apartments.com scans from the desk. A background
worker checks the local app for an approved command every 30 seconds. It opens one
page at a time, waits at least ten seconds between page visits, opens the listing
gallery, and returns photo references to the app. The app retrieves and reviews
photos within the approved limits. With no approved plan, no website is visited.

Version 0.2.3 follows the listing's full photo viewer, including its CSS-drawn next
arrow. Only the active gallery image is collected during traversal, excluding
separate building and map previews. Complete counts are required before AI review;
incomplete work is retained without another AI call.

The separate connection test reads one existing page without navigation, photo
downloads, importing or AI. A connection-test capture is not a completed scan.

1. Keep Apartment Finder running. In your normal Chrome, open `chrome://extensions`.
2. Turn on **Developer mode**, click **Load unpacked**, and select this `extension`
   folder (the folder containing `manifest.json`).
3. In Apartment Finder → **Preferences → Normal Chrome connection**, click
   **Approve one page connection test**. Copy the connection code.
4. Open the approved Apartments.com listing in that Chrome profile. Click the
   puzzle-piece menu → **Apartment Finder — Chrome Bridge**. Paste the code and
   click **Connect**.
5. With the listing still selected, click **Send this page for the connection test**.
   Leave the popup open until it reports success. Check Preferences for the result.

The code and capture approval expire after ten minutes. A failed read may consume
the approval; prepare another test explicitly. Restarting the app cancels pending
approval. **Disconnect Chrome** revokes the connection and pending test.

After an extension update, click its Reload button on `chrome://extensions`.
The existing connection is retained; pairing and repeating the connection test
are unnecessary. Prepare and approve a bounded Apartments.com plan in the desk.

## Access and storage

The extension requests Apartments.com page access and loopback access to contact
the local app. Chrome host permissions cannot restrict the loopback permission to
one port; the extension code uses only `http://127.0.0.1:4317`. Its background worker receives only local, authenticated scan jobs. It has no
automatic content script, remote code, cookie or browsing-history access.
The popup runs a read-only isolated script on the selected listing tab.

The app issues a single-use pairing code through its existing CSRF-protected UI.
Pairing binds a random token to the extension ID; only a hash is stored by the app.
The token stays in trusted extension storage, never the listing page. Bridge routes
check extension identity and token; ordinary web origins cannot use them. Existing
app routes retain their CSRF and same-origin checks.

Captures contain cleaned listing markup, text and loaded image URLs, saved under
gitignored `data/live/browser-captures/`. Scripts, forms and input values are omitted.
Image URLs may include source-provided query strings; treat captures as private.
Loaded image URLs can include decorative images and are not a verified gallery.
Connection tests always set `galleryComplete` to false. Scanner jobs require the
number of distinct gallery photos to match the advertised count; incomplete work
is retained and labelled as such. Cancellation and expiry stop further navigation.
No source pause is automatically cleared by this test.

Version 0.1.1 preserves the listing header and enumerates image references already
present in gallery metadata and inline image backgrounds. The offline extractor
deduplicates image variants, excludes non-photo assets, and records conflicting
listing terms. Extracted previews go to `data/live/browser-extractions/`; they do
not become Sorting Desk cards or confirm nature views without full photo review.
