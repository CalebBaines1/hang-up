# Deploying Hang Up on Nebius AI Cloud

> Quickest path: paste [`deploy/nebius/cloud-init.yaml`](../deploy/nebius/cloud-init.yaml) into the VM form's custom cloud-init box and skip steps 3 to 6. The VM then powers itself off after 20 idle minutes; see "Sleep when idle" below.

This puts the whole app (web app, API and speech service) on one Nebius AI Cloud VM behind HTTPS, so you get a public demo URL like `https://1-2-3-4.sslip.io`. It takes about 30 minutes, most of which is the first build.

What you need: a Nebius AI Cloud account, your Token Factory API key, and an SSH key on your computer (`ls ~/.ssh/id_ed25519.pub`; if it's missing, run `ssh-keygen -t ed25519`).

## 1. Create the VM

In the [Nebius console](https://console.nebius.com), open **Compute → Virtual machines → Create virtual machine** and set:

- **Image:** Ubuntu 24.04 (or 22.04).
- **Platform:** a CPU-only platform with **8 vCPUs and 32 GB RAM**. The speech models run fine on CPU; more vCPUs means the caller's voice starts sooner. A GPU is optional (see the end of this guide).
- **Boot disk:** 50 GB.
- **Network:** turn on **Public IP** (a static address is best, so the URL doesn't change).
- **Access:** a username (e.g. `caleb`) and paste the contents of `~/.ssh/id_ed25519.pub`.

Create it, then copy the **Public IPv4** address from the VM's page. Below, `1.2.3.4` stands for that address.

If your project has a security group or firewall on the network, allow inbound TCP **22, 80 and 443**.

## 2. Pick your URL

No domain needed: [sslip.io](https://sslip.io) maps a hostname to an IP. For IP `1.2.3.4` your URL is:

```
1-2-3-4.sslip.io
```

(If you own a domain, point an A record at the IP and use that name instead.)

## 3. Install Docker on the VM

```bash
ssh caleb@1.2.3.4
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit
```

Log back in so the group change applies: `ssh caleb@1.2.3.4`.

## 4. Get the code

While the repo is private, create a read-only token: GitHub → Settings → Developer settings → **Fine-grained tokens** → access to `hang-up` only, permission **Contents: Read-only**. Then:

```bash
git clone https://<YOUR_TOKEN>@github.com/CalebBaines1/hang-up.git
cd hang-up
```

(Once the repo is public, a plain `git clone https://github.com/CalebBaines1/hang-up.git` works.)

## 5. Configure

```bash
cp .env.example .env
nano .env
```

Set these two lines and save (Ctrl+O, Enter, Ctrl+X):

```
DOMAIN=1-2-3-4.sslip.io
NEBIUS_API_KEY=<your Token Factory key>
```

Everything else can stay as it is. The `.env` file stays on the VM and is never committed.

## 6. Start it

```bash
docker compose up -d --build
```

The first build downloads about 1 GB of speech models and takes 10 to 15 minutes. Watch progress with `docker compose logs -f` (Ctrl+C stops watching, not the app).

When the logs settle, check it:

```bash
curl https://1-2-3-4.sslip.io/api/health
```

You should see `"ok":true,"speech":true`.

## 7. Try it on your phone

Open `https://1-2-3-4.sslip.io` on your phone.

- **iPhone:** Safari → Share → **Add to Home Screen**, then open Hang Up from the home screen. That's needed for "ring me when the app is closed" notifications on iOS.
- **Android:** Chrome → menu → **Install app**.

Go through setup, tap **Ring me now**, answer, and try to get scammed.

## Day-to-day

| Task | Command (in `~/hang-up` on the VM) |
| --- | --- |
| Deploy the latest code | `git pull && docker compose up -d --build` |
| See logs | `docker compose logs -f api` |
| Restart | `docker compose restart` |
| Stop | `docker compose down` (data is kept in Docker volumes) |

The VM keeps running (and billing) until you stop it in the console. Stop it after the judging period if you don't need it.

## Troubleshooting

- **The page doesn't load / certificate error:** check that ports 80 and 443 are open and that `DOMAIN` matches the IP. `docker compose logs caddy` shows certificate errors.
- **`"speech":false`:** the speech service is still starting or ran out of memory. `docker compose logs speech`. The app still works using the browser's voice in the meantime.
- **The caller doesn't hear you:** the browser needs microphone permission, and the page must be on `https://`.

## Sleep when idle, wake on visit

`deploy/nebius/idle-shutdown.sh` runs every minute from cron (the cloud-init sets this up). After 20 minutes with no app requests and no live call, it powers the VM off, so compute stops billing; only the disk and static IP keep billing (about $0.01/hour). An open app polls the API, so the VM stays up while anyone has Hang Up open.

To start it again on demand, host the web app on Vercel in front of the VM:

1. **Nebius service account:** Administration → IAM → Service accounts → create `hang-up-waker`, add it to a group that can manage Compute (e.g. editors), then create an **authorized key** and download its credentials (service account ID, key ID, private key).
2. **Vercel project:** import the GitHub repo, set the root directory to `apps/web`, and add these environment variables:
   - `VITE_API_URL` = `https://<ip-with-dashes>.sslip.io`
   - `NEBIUS_INSTANCE_ID` = the VM's ID (on its page in the console)
   - `NEBIUS_SA_ID`, `NEBIUS_KEY_ID`, `NEBIUS_PRIVATE_KEY` = from the authorized key
3. Deploy. When someone opens the Vercel URL and the VM is off, the app shows "Waking up the call line", calls `apps/web/api/wake.ts` to start the VM, and continues once the API answers (about a minute).

Scheduled surprise calls and family calls only ring while the VM is up.

## Optional: GPU

Calls work well on CPU. A GPU VM makes the voices start faster, but the speech image needs the CUDA build of sherpa-onnx and the NVIDIA container toolkit. Ask and this can be added as a `docker-compose.gpu.yml`.
