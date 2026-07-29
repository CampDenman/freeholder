# DigitalOcean droplet (Tier 1)

One box you control: Caddy for TLS, the app, and Postgres — with media in
DigitalOcean Spaces, because §18 mandates that the archive never lives on
instance disk. A destroyed droplet is a twenty-minute rebuild, not a data-loss
event.

**Roughly $29/month:** a `s-2vcpu-4gb` droplet ($24) plus a Spaces bucket ($5).
It runs on a `s-1vcpu-2gb` ($12) if the database stays small, but Postgres and
the app are sharing that RAM.

## Before you start

- A domain you can point at an IP address.
- `doctl` authenticated: `doctl auth init`.
- An SSH key on your DigitalOcean account: `doctl compute ssh-key list`.

## 1. Create the Spaces bucket

Media must live in object storage. In the DigitalOcean console:
**Spaces Object Storage → Create** — pick the region you'll put the droplet in,
name the bucket, and leave file listing **restricted**.

Then create a key scoped to just that bucket:

```bash
doctl spaces keys create freeholder-media-rw \
  --grants 'bucket=YOUR-BUCKET;permission=readwrite'
```

Scoped, not full-access: if this key ever leaks, it reaches one bucket rather
than every Space on the account. Note the secret — DigitalOcean shows it once.

> The bucket must exist first. Scoping a key to a bucket that isn't there is
> rejected with `invalid grant`.

## 2. Create the droplet

```bash
doctl compute droplet create freeholder-prod \
  --region sfo3 \
  --size s-2vcpu-4gb \
  --image ubuntu-24-04-x64 \
  --ssh-keys "$(doctl compute ssh-key list --format ID --no-header | head -1)" \
  --user-data-file deploy/digitalocean-droplet/infra/cloud-init.yml \
  --wait
```

`cloud-init.yml` installs Docker, closes everything except SSH, HTTP and HTTPS,
and turns on unattended security updates. Give it a minute after `--wait`
returns; cloud-init keeps working after the API reports the droplet active.

## 3. Point the domain

Create an `A` record for your domain at the droplet's IPv4 address, at whatever
registrar or DNS host you use. **Do this before step 5** — Caddy asks Let's
Encrypt for a certificate on first boot, and that only works once the name
resolves to this machine.

## 4. Configure

```bash
scp deploy/digitalocean-droplet/infra/{compose.yml,Caddyfile,backup.sh} \
    root@DROPLET_IP:/opt/freeholder/
scp deploy/digitalocean-droplet/.env.example root@DROPLET_IP:/opt/freeholder/.env
ssh root@DROPLET_IP 'chmod 600 /opt/freeholder/.env && nano /opt/freeholder/.env'
```

Fill in every value the file asks for. `SESSION_SECRET` and `POSTGRES_PASSWORD`
each want their own random string:

```bash
node -e "console.log(crypto.randomBytes(32).toString('hex'))"
```

## 5. Start it

```bash
ssh root@DROPLET_IP
cd /opt/freeholder
export FREEHOLDER_DOMAIN=yourdomain.com
docker compose pull && docker compose up -d
docker compose logs -f app
```

Open `https://yourdomain.com`. A fresh instance sends you to `/setup`.

## 6. Turn on backups

Media is already in Spaces; this covers the database.

```bash
ssh root@DROPLET_IP
chmod +x /opt/freeholder/backup.sh
echo '15 3 * * * root . /opt/freeholder/.env && /opt/freeholder/backup.sh' \
  > /etc/cron.d/freeholder-backup
```

Then work through [`verify.md`](verify.md) — including the restore rehearsal.
A backup you have never restored is a hope, not a backup.

## Updating

```bash
ssh root@DROPLET_IP 'cd /opt/freeholder && docker compose pull && docker compose up -d'
```

Migrations ship inside the image, so a release can never be newer than the
schema it expects.

## Leaving

Everything is portable by construction: the database is a `pg_dump`, the media
is a bucket you own, and `freeholder.config.ts` describes the instance. Moving
to another provider is an export, a provision, an import and a DNS change —
see the migration notes in [`../README.md`](../README.md).
