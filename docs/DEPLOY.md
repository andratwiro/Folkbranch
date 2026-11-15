# Deploying

Folkbranch runs as one container. Every host below needs the same three things:

- a persistent volume mounted at `/data`
- `BETTER_AUTH_URL` set to the public address people open
- one instance only: SQLite and the photos live on that single volume

Without a volume the archive is lost on the next restart or deploy. On Railway the app notices a missing volume and refuses to start, so the previous deploy keeps running; on other hosts check the volume yourself before you enter anything.

`BETTER_AUTH_SECRET` signs sessions and encrypts the assistant's key. Set your own on the host where possible, so a copy of the volume alone cannot decrypt it. `SETUP_TOKEN` is optional: without it the app generates a code, writes it to the logs and to `setup-code` in the data folder. The first person claims the empty archive with that code.

Backups work the same everywhere: the server copies the database each day into `backups/` on the volume, and `node folkbranch.mjs backup` writes a consistent copy there too. Both stay on the same disk, so also download a full copy under **Settings → Data and backups**, or copy the backup folder off the host. See [self-hosting](SELF_HOSTING.md#backups).

The container starts as root only to give `/data` to the `node` user, then runs the app as `node`.

## Railway

Cost: Hobby plan starts at about $5 a month and includes that much usage; a small archive stays near it. Check Railway's price page.

The repository has `.railway/railway.ts`: one service built from the Dockerfile, a volume at `/data`, one replica and the health check. `railway config apply` creates all of it.

1. Create a service from the GitHub repository, or run `railway init --name folkbranch` in a clone.
2. Add a volume and mount it at `/data`. This is mandatory.
3. Set `BETTER_AUTH_URL` to the public address, after the domain exists.
4. Set `SETUP_TOKEN` if you want to choose the claim code yourself.
5. Deploy and open the link printed in the logs to create the owner.

```bash
railway login
railway init --name folkbranch
railway config apply
railway variable set --service folkbranch "BETTER_AUTH_SECRET=$(openssl rand -hex 32)"
railway domain --service folkbranch
railway up --service folkbranch
railway logs --service folkbranch
```

Update: push to the connected branch, or run `railway up` again. The volume and the archive stay.

Back up: `railway ssh --service folkbranch`, then `node folkbranch.mjs backup`. The copy lands in `/data/backups`, on the same volume.


## Render

Cost: Starter is about $7 a month; the 1 GB disk is about $0.25 a month. Check Render's price page.

`render.yaml` is a Blueprint with one web service built from the Dockerfile, a 1 GB disk at `/data`, and the health check.

1. Push the repository to GitHub.
2. In Render, choose **New → Blueprint** and pick the repository.
3. Render asks for `BETTER_AUTH_URL`; enter the public address after the first deploy creates it. You can change it later and redeploy.
4. Apply. Render generates `BETTER_AUTH_SECRET`.
5. Open the service URL and use the claim link from the logs.

A service with a disk cannot be scaled to more than one instance, which is what SQLite needs anyway.

Update: push to the branch, or press **Deploy** in the dashboard. Blueprint changes apply on the next sync.

Back up: open the service shell in the dashboard, run `node folkbranch.mjs backup`, then copy the file from `/data/backups` with the shell's download or `scp` from the SSH address Render shows.

## Fly.io

Cost: pay as you go, roughly a few dollars a month for one small machine and a 1 GB volume. Check Fly's price page.

`fly.toml` sets the internal port, a volume named `folkbranch_data` at `/data`, the health check, and one always-on machine. `auto_stop_machines` is `"off"` on purpose: stopping the machine does not lose data, but the app would be asleep and the archive is meant to be reachable.

1. Install `flyctl` and run `fly auth login`.
2. In a clone of the repository, run `fly launch --no-deploy` and keep the existing `fly.toml`.
3. Create the volume in the same region: `fly volumes create folkbranch_data --size 1 --region ams`.
4. Set the address and secret: `fly secrets set BETTER_AUTH_URL=https://YOUR-APP.fly.dev BETTER_AUTH_SECRET=$(openssl rand -hex 32)`.
5. Deploy: `fly deploy`.
6. Open the app URL and use the claim link from `fly logs`.

If the app name is taken, change `app` in `fly.toml` to your own.

Update: `fly deploy`. The volume and the archive stay.

Back up: `fly ssh console -C "node folkbranch.mjs backup"`, then `fly sftp get /data/backups/<file> ./<file>`. Fly also takes daily volume snapshots by default.

## Any VPS with Docker Compose

Cost: whatever the server costs, about $5 a month for a small one.

`docker-compose.yml` runs the published image with a named volume at `/data`. `./install.sh` writes `.env` and starts it, with Caddy for HTTPS when you pass `--domain`.

1. Install Docker and the Compose plugin.
2. Copy `docker-compose.yml` and `.env.example` to the server.
3. Copy `.env.example` to `.env`, set `BETTER_AUTH_URL=https://your.domain` and `BETTER_AUTH_SECRET`. Keep `BIND=127.0.0.1` behind a reverse proxy; set `BIND=0.0.0.0` only to expose the port directly.
4. Run `docker compose up -d`. With `--profile https` and `DOMAIN` set, Caddy fetches the certificate.
5. Open the app and use the claim link from `docker compose logs folkbranch`.

The volume `folkbranch-data` holds the archive. `docker compose down` keeps it; `docker compose down -v` deletes it.

Update: `docker compose pull && docker compose up -d`. The database migrates on start; take a backup first.

Back up:

```bash
docker compose exec folkbranch node folkbranch.mjs backup
docker compose cp folkbranch:/data/backups ./backups
```

## Coolify, Dokploy and other Compose hosts

Cost: the server they run on, about $5 to $10 a month, plus whatever the panel charges, if anything.

These panels deploy a `docker-compose.yml` from a Git repository and keep named volumes on the host.

1. Create a new resource from the repository.
2. Let the panel use `docker-compose.yml`. It already has the volume and the port.
3. Add `BETTER_AUTH_URL`, and optionally `BETTER_AUTH_SECRET`, as environment variables.
4. Deploy, then set the public domain in the panel so that HTTPS and the address match `BETTER_AUTH_URL`.
5. Open the app and use the claim link from the logs.

Keep the panel's volume for `folkbranch-data`. Removing the resource with its volumes deletes the archive.

Update: redeploy from the panel. The volume stays.

Back up: open a terminal in the container from the panel and run `node folkbranch.mjs backup`, then copy `/data/backups` out.
