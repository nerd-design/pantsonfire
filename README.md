Pants on Fire — experimental Chrome extension (Chrome 127+)
=====================================================
INSTALL
Unzip, open chrome://extensions, enable Developer mode, choose Load unpacked,
and select this folder. Pin Pants on Fire. Reload the extension after updates.
Click its toolbar icon on a normal website. No pasted URLs or API key.

HOW IT WORKS
Collects all supported image references currently in accessible HTML, including
hidden/lazy/srcset/CSS images. Deduplicates identical URLs.
Opens ONE inactive tab, sends public image URLs to Google Lens, reads visual
search candidates, follows target marketplace links, and compares image pixels.
The tab also visits marketplace product pages to find their actual photos.
No progress, partial verdicts, or popup is shown during the scan.
The temporary tab closes when the attempt ends. Closing that tab stops scanning.
Keep the original page open. Navigating it cancels the scan.
Clicking again while a scan is running does not start a second scan.

RESULTS
Pants on fire / Likely foreign-made: at least one closely matching photo
was verified on a targeted marketplace. Evidence links appear in the popup.
Jeans / Likely domestic: no photo match in successfully checked search results.
This does NOT establish manufacturing origin or complete marketplace coverage.
Unknown: inaccessible images, blocked searches, or other incomplete checks.
A found match can still be shown with an incomplete-coverage warning.
The popup opens only if the original page is still active. The toolbar badge
retains the final state; clicking again starts a new scan.

LIMITS
Targets: 1688, Made-in-China, Alibaba, AliExpress, Chinagoods, Yiwugo, DHgate.
This is an experimental browser workflow, not a supported Google API.
Consent, CAPTCHA and rate limits are not bypassed. There is no paid fallback.
Search results are limited to the rendered results after three scrolls.
The whole scan has a 15-minute limit; reaching it produces incomplete coverage.
Conservative resized-pixel comparison supports similar image framing.
It may miss crops, overlays, edits, or images not indexed by Google.
Images under 64px, over 12MB, data/blob/private URLs and unreadable photos
remain unverified. Cross-origin frames and closed shadow roots may be missed.
Large pages can take several minutes and often contain uncheckable icons.

PRIVACY / PERMISSIONS
Chrome requests website access to read Google and marketplace pages and fetch
photos from their various CDNs. Collection starts only on toolbar activation.
Public image URLs are sent to Google. Marketplace/CDN servers receive requests.
Do not activate this on sensitive or confidential pages.
Comparison fingerprints stay in worker memory. Results and evidence URLs are
kept in browser session storage, cleared on source-tab navigation or closure.
No account, API key, subscription, backend search server or analytics is used.
Google and marketplace providers have their own privacy policies.
