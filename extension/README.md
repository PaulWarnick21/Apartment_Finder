# Normal Chrome scanner

Version 0.5.2 reports the running extension version and its last authenticated contact
through `/api/browser/state`. This distinguishes a loaded fix from files that have only
been updated on disk. Restart the backend, reload the existing extension, and verify
`runtime.version` before a bounded live validation. Legacy clients report an unknown
version; this status check makes no source requests and clears no source warning.

Version 0.5.1 fixes Apartments.com availability-text false positives: an ordinary
“temporarily unavailable” amenity/unit does not establish a site access warning.
Explicit security challenges and service-outage headings still stop. The bridge retains
the matched warning and a bounded visible-text excerpt for local diagnosis. Restart the
backend and reload the existing extension to activate both halves of this update.
The chat-controlled `/api/browser/recover-apartments` endpoint supports a separately
approved five-minute, one-search-page check with zero photo downloads, AI or imports.
It retains existing inventory and clears the pause only after recognizing rental results.

Version 0.5.0 receives approved jobs promptly through authenticated localhost long
polling during a run. The 30-second alarm remains an idle wakeup only. Page start
times persist across service-worker restarts; new adaptive quick plans gradually
reduce healthy-source navigation gaps from ten to five seconds. Reload the existing
extension once in `chrome://extensions`; pairing and permissions are unchanged.
No approved job means no listing-site navigation, even while localhost is polled.

The following notes describe earlier milestones.

Version 0.4.0 separates discovery pagination from listing links and makes
Apartments.com gallery collection resumable under a small approved photo allowance.
Reload the installed extension in `chrome://extensions`; existing pairing remains valid.
The app checks fresh discovery even when older candidates remain queued. Optional
expanded-coverage trials use already-advertised search routes and remain explicitly
unvalidated until a separately approved live run establishes their behavior.

A partially collected Apartments.com gallery can leave its scanner-created tab open,
with its image references and position saved in trusted extension storage. At most
three such tabs are retained. A later approved scan can continue from that position;
the extension performs no navigation or gallery interactions while waiting. Completed,
failed and cancelled jobs close their scanner tab. Closing a paused tab yourself is
safe; the next approved run starts enumeration again and the app keeps its cached
images. Site pages can generate their own background/subresource requests, which this
bridge does not count individually. App image downloads and page allowances remain
separately bounded.

The app may review downloaded images in bounded batches while the rest of the gallery
is pending. It keeps unavailable images and incomplete enumeration explicit; these
states never establish that an unphotographed window has no nature view. Optional
facts-only refresh jobs do not open the gallery or replace saved images.

The version notes below describe earlier milestones.

Version 0.3.0 adds Zillow search and individual rental pages to the same paired
Chrome connection. Reload the installed extension once and approve Zillow site
access in Chrome if prompted; pairing does not need to be repeated. Zillow jobs
run only under an approved bounded plan, retain per-source daily limits and stop
on access warnings. Captures retain only the matching property's public rental
fields and its advertised full-resolution gallery, excluding account data and
nearby ads. Building-only search results are not treated as individual units.
An explicit one-page recovery check can validate search access before clearing a
prior Zillow pause; ordinary scans and startup never clear it. Browser-generated
subrequests are not counted individually by this extension; page visits and
app-initiated image requests are accounted separately.

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
