# Hugging Face Space deploy

A free way to host the whole app (web app, API, speech) in one container.

1. Create a Space at https://huggingface.co/new-space: SDK **Docker**, template **Blank**, hardware **CPU basic (free)**, visibility **Public**.
2. In the Space's **Files** tab, add a file named `Dockerfile` with the contents of [`Dockerfile`](Dockerfile) from this folder.
3. In the Space's **Settings → Variables and secrets**, add a secret `NEBIUS_API_KEY` with your Token Factory key.
4. Wait for the build (about 10 to 15 minutes the first time). The app is at `https://<user>-<space>.hf.space`.

To deploy new code from GitHub, use **Settings → Factory rebuild**. The free tier sleeps after 48 hours without visitors; the first visit after that takes about a minute.

Notes: the database lives in `/tmp`, so history resets when the Space restarts. For web push across restarts, also add `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` secrets (generate with `npx web-push generate-vapid-keys`).
