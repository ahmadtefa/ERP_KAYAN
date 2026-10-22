# Reaching KAYAN from another desk, or from outside the office

This document is about the network between a person's browser and the API. It
is not about the accounting rules, the database, or the installer.

## 1. Three ways to reach the program

| Where the person is | How it should be served | Session survives a reload? |
| --- | --- | --- |
| The same machine (desktop install) | `http://127.0.0.1:3000` | Yes — loopback is a secure context |
| Another desk in the office (LAN) | `http://<server-ip>:3000` — works, but see below | **No** — memory only |
| LAN, with the optional proxy | `https://erp.office.lan` | Yes |
| Outside the office | HTTPS reverse proxy or a VPN | Yes |

`localhost`, `127.0.0.1` and `[::1]` are *secure contexts* even over plain
HTTP. Every other `http://` address is not, and browsers refuse WebCrypto
there. The program stores its session with WebCrypto, so on a LAN address it
falls back to keeping the session in memory: sign-in succeeds and everything
works until the page is reloaded. A notice appears at the top of the window
saying exactly that.

That is why "it works on the server and fails for everyone else" is almost
never an authentication problem.

## 2. What the server must be told

Only three settings matter:

```dotenv
HOST=0.0.0.0                  # accept connections from other machines
KAYAN_TRUST_PROXY="loopback"  # only when a proxy runs on this machine
KAYAN_TLS_TERMINATED=1        # only when that proxy terminates HTTPS
```

* `HOST=127.0.0.1` (the desktop default) is unreachable from another machine.
  Changing it is necessary but not sufficient: the operating system's firewall
  must also allow the port on the private network.
* `KAYAN_TRUST_PROXY` makes Express read `X-Forwarded-For` and
  `X-Forwarded-Proto`. Without it those headers are ignored, which is correct
  when no proxy exists: otherwise any client could claim to be HTTPS.
* Leave both unset on a plain LAN install. The server starts, logs one warning
  that the API is reachable over plain HTTP, and the settings screen states the
  session is memory-only.

A deliberate public deployment without TLS is refused at start-up unless
`KAYAN_ALLOW_PUBLIC_HTTP=1` is also set, and that flag is only for a machine
that really is behind TLS at a layer the application cannot see.

## 3. HTTPS with a reverse proxy (recommended for outside access)

Caddy is the shortest path because it obtains and renews certificates itself.
The API keeps listening on `127.0.0.1:3000`; only the proxy is public.

`/etc/caddy/Caddyfile`:

```caddyfile
erp.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000 {
        header_up X-Forwarded-Proto {scheme}
        header_up X-Forwarded-For {remote_host}
    }
}
```

Then, in the server's `kayan.env`:

```dotenv
HOST=127.0.0.1
KAYAN_TRUST_PROXY="loopback"
KAYAN_TLS_TERMINATED=1
```

With nginx, the equivalent location block is:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
}
```

Check from a machine that is **not** the server:

```bash
curl -sS https://erp.example.com/api/v1/health
curl -sS https://erp.example.com/api/v1/health/network
```

The second answer reports `secureContext: true` and
`sessionStorage: "durable"`. If it says `memory-only`, the proxy is not sending
`X-Forwarded-Proto`, or `KAYAN_TLS_TERMINATED` is missing — the program will
still work, and still sign people out on reload.

## 4. A VPN instead of a public address

If the office already has a VPN, keep everything private: `HOST=0.0.0.0` (or the
VPN interface's address), no port forwarding on the router, and point the
outside laptop at the server's VPN address. Traffic is encrypted by the tunnel,
so a plain `http://` over the VPN is acceptable — but it is still not a secure
context unless the address is loopback, so sessions remain memory-only until
the VPN also serves the page over HTTPS. Most VPN products offer a small
reverse-proxied HTTPS endpoint for exactly this; use it.

## 5. What the code cannot do for you

These are real, one-time actions on machines this repository does not control.
They are listed so nobody expects a build to perform them:

1. **DNS** — a name such as `erp.example.com` pointing at the public address.
2. **Router / firewall** — forwarding 443 to the proxy, and *not* forwarding
   3000 or 5432.
3. **Certificate** — issued by Caddy/Let's Encrypt or the company's CA.
4. **DNS inside the office** — a name such as `erp.office.lan` for the LAN
   install, so people do not type an address that changes with DHCP. A DHCP
   reservation for the server is worth the five minutes.
5. **Backups** — the proxy changes nothing about them; see
   `docs/BACKUP_RESTORE.md`.

## 6. Things never to do

* Do not open PostgreSQL (5432) to the office network or the internet. The API
  is the only door, and it enforces permissions. The database does not.
* Do not put passwords, JWTs or certificates in the repository, in a Flutter
  build flag, or in a screenshot.
* Do not switch off token verification, CORS, or permission checks to make a
  connection work. If a connection fails, the fault is in the connection.
* Do not lengthen `JWT_ACCESS_TTL` to paper over a networking fault. The client
  renews silently; a long token only widens the window in which a stolen one is
  useful.

## 7. Sessions and idle time

* Access token: 15 minutes (`JWT_ACCESS_TTL=900`). The client renews it before
  it expires, and on a 401 it renews once and replays the request.
* Refresh token: 14 days (`JWT_REFRESH_TTL=1209600`), rotated on every use. A
  refused refresh token ends the session with an explanation rather than an
  error.
* After a long idle period the first request renews the session and succeeds.
  If refresh fails because the network dropped, the session is *kept* — a
  dropped connection is not a verdict on the token. Only an explicit 401/403
  from `/auth/refresh` clears it.
* Signing out clears both tokens, including the in-memory copy.

## 8. When someone reports "unexpected error after sign-in"

1. `GET /api/v1/health` — is the API up, is the database reachable?
2. Look at the server log: every sign-in writes one line, either
   `Signed in "<user>" (company …, N role(s), M permission(s)) from <ip>` or
   `Sign-in refused for "<user>": <reason>`. The password is never logged.
3. Compare the address in the browser's location bar with that log line. If the
   log says the sign-in succeeded and the browser showed an error, the problem
   is between the answer and the screen, not in authentication.
4. `GET /api/v1/health/network` on that same address: `secureContext: false`
   plus `sessionStorage: "memory-only"` explains a session that disappears on
   reload, and is not an authentication failure at all.
5. If the message says the account details were not returned, the program and
   the server are likely different versions, or the company setup never
   finished. The server log carries the technical detail.
