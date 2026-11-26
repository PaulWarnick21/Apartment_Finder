# Phone access

Use Chrome on iPhone to open the same Sorting Desk as the Windows PC. Tailscale provides
the private connection. Photos, stages and notes remain in the PC's existing database.
The ChatGPT/Codex mobile connection is separate and can continue to be used for chat.

## One-time setup

1. Install Tailscale on Windows and from the iPhone App Store. Sign in to both with the
   same personal account. On iPhone, allow the VPN configuration and connect Tailscale.
   Select the free Personal plan, not a paid plan or trial. As checked on November 15,
   2026, Tailscale advertises Personal as $0, free forever for noncommercial use.
2. Check `tailscale status --json` on Windows. Use this PC's `Self.DNSName` (without its
   trailing dot) and the owner's `User[Self.UserID].LoginName` for the two settings below.
   Put them in the gitignored `.env`, preserving the existing settings:

   ```dotenv
   AF_REMOTE_ORIGIN=https://your-pc.your-network.ts.net
   AF_REMOTE_USER=you@example.com
   ```

   Both are required. The origin must be the exact HTTPS address; do not use a wildcard,
   path, IP address or arbitrary public domain. Keep the PC and phone as personal devices,
   since tagged Tailscale devices do not supply a user identity.
3. Build the app with `npm run build`. If it is already running, finish any active work
   and use the normal Stop/Open Apartment Finder launchers to restart it. Do not stop a
   running scan to install this change. Local access remains at `http://127.0.0.1:4317`.
4. In an Administrator PowerShell window run:

   ```powershell
   & 'C:\Program Files\Tailscale\tailscale.exe' serve --bg http://127.0.0.1:4317
   ```

   Follow Tailscale's HTTPS setup link if prompted. Use **Serve**, which is private to
   your network. Do not run **Funnel**, which publishes to the internet. Check
   `tailscale serve status` and confirm the HTTPS address proxies only to port 4317.
5. With Tailscale connected on iPhone, open the exact HTTPS address in Chrome and bookmark
   it. Turn Wi-Fi off temporarily to test through cellular. Verify the desk loads, open
   an existing gallery, and confirm a note you intentionally save appears on the desktop.
   Avoid submitting a rating as a connection test: rating submissions request AI review.

## Everyday use

- Keep the PC powered, awake and online, and leave Apartment Finder running. Closing its
  desktop browser tab is fine. Tailscale must be connected on both devices.
- Open the bookmark in Chrome on iPhone. You do not need Safari or a separate apartment app.
- Normal Chrome on the PC is needed for approved scans using its extension. Reading saved
  apartments and saving notes do not require the PC browser to be open.
- Scanning retains bounded-plan approvals, budgets and source pauses. Phone setup does
  not enable work. Discovery and availability schedules are off after the November 26
  pause. Keep them off until a new explicit authorization.
- Initiate any new ChatGPT account connection on the desktop. Existing connected credentials
  remain on Windows and continue to support the app's approved operations.

## Troubleshooting and disabling access

If the private URL does not open, check that both Tailscale apps are connected, Windows is
awake, the local app opens on the PC, and `tailscale serve status` still lists the proxy.
An access-denied response can mean the phone uses a different Tailscale account or the
configured address/login does not match. Changing `.env` requires an app restart.
If another VPN app disconnects Tailscale, reconnect Tailscale before opening the bookmark.

To disable this Serve listener without changing unrelated listeners:

```powershell
& 'C:\Program Files\Tailscale\tailscale.exe' serve --https=443 off
```

Removing both remote settings from `.env` and restarting the app also returns the app to
local-only mode. Never remove just one setting; incomplete configuration fails at startup.
No router port forwarding, purchased domain, public hosting or paid subscription is needed
for this setup. Keep the app listening on loopback; do not bind it to all network interfaces.

References: [Personal pricing](https://tailscale.com/pricing),
[iPhone installation](https://tailscale.com/docs/install/ios),
[Tailscale Serve and verified identity](https://tailscale.com/docs/features/tailscale-serve).
