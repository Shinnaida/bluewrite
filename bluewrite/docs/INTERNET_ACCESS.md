# Opening the phone app over the internet (not just station Wi-Fi)

The phone app talks to one thing: the BlueWrite API on the server PC's port
8099. On station Wi-Fi it reaches it at the LAN address
(e.g. `http://192.168.0.108:8099` — see LAN_SETUP.md). From anywhere else
(mobile data, home Wi-Fi, another station), that LAN address does not exist,
so the app needs a **public address** for the same API. This page publishes
one — encrypted, free, and without touching the router.

## The rule first

Never forward raw port 8099 on the router and never type a plain `http://`
address into the app over the internet. The phone signs in with bearer
tokens and files blotter photos; over plain HTTP all of that travels
readable. The path below wraps the same API in HTTPS, so the app's traffic
is encrypted in transit. (LAN_SETUP.md §10 and MOBILE_APP.md §5 say the
same thing for the LAN: trusted network only, plain HTTP never leaves it.)

## How it works

A tunnel agent on the server PC dials **out** to Cloudflare and exposes the
local API as a public `https://` address. Nothing dials in: no port
forwarding, no static public IP, no firewall holes, MySQL stays untouched.
The phone types that `https://` address once; after that it opens from
anywhere with internet exactly like it does on station Wi-Fi (last good
address is tried first, same sign-in, same PIN).

## One-time setup (server PC)

1. Install the tunnel agent once, as Administrator:
   `winget install -e --id Cloudflare.cloudflared`
   Then open a **new** terminal (so PATH picks it up).
2. Start the normal stack if it is not up: double-click `Start
   BlueWrite.bat` (or run `bluewrite\scripts\serve.cmd`) and confirm
   `netstat -ano | findstr :8099` shows `0.0.0.0:8099 LISTENING`.

## Publishing (each time the station wants internet access)

1. Run `bluewrite\scripts\expose-internet.cmd` on the server PC and leave
   its window open — closing it unpublishes the address.
2. It prints a line like:
   `https://random-words-here.trycloudflare.com`
3. On the phone (any internet — mobile data is fine): open the app → if it
   cannot find the server it offers **Enter address manually** → paste that
   `https://` address → Continue → sign in with the officer's portal
   account as usual. The address is tested by the app on submit.

## Stable address (optional, one time)

The free quick-tunnel address above changes every time the script restarts,
and each phone must then enter the new one. For an address that never
changes, create a named tunnel once (needs a free Cloudflare account and a
domain on Cloudflare — the station's own network setup, not an app
setting):

```
cloudflared tunnel login
cloudflared tunnel create bluewrite
cloudflared tunnel route dns bluewrite bluewrite.example.gov.ph
cloudflared tunnel run --url http://localhost:8099 bluewrite
```

Then the phones keep `https://bluewrite.example.gov.ph` permanently.

## Troubleshooting

| What you see | What it means |
|---|---|
| Script says the API is NOT up on 8099 | Start the stack first (`serve.cmd`), then re-run. |
| `cloudflared` is not recognized | Install it (one-time setup above) and open a new terminal. |
| Phone: "Can't reach the BlueWrite server" | The pasted address must be complete (`https://…`, no spaces); the tunnel window on the server PC must still be open; the phone needs internet. |
| It worked yesterday, not today | Quick-tunnel addresses change on restart — re-run the script and enter the new address (or set up the stable address above). Server moved to a new PC? Same thing: new address, enter it once. |
| Phone opens slowly on mobile data the first time | The first connect verifies the stored address, then scans — afterwards the good address is stored and reopening is fast. |
