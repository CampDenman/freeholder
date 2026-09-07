# create-freeholder

Create an independently owned Freeholder source installation:

```sh
npx create-freeholder my-business
```

The CLI asks for the deployment target, business preset, country defaults and
payment choice. After scaffolding it checks `.env`, offers to install
dependencies and run migrations, and prints the setup URL — including whether
that URL answered. For automation, pass every answer explicitly:

```sh
npx create-freeholder my-business --non-interactive \
  --target railway --preset shop --country CA --payments later \
  --install --migrate
```

`--non-interactive` skips install and migrate unless you pass those flags, so a
packed-tarball gate can scaffold without a database. Missing `DATABASE_URL`
refuses `--migrate` and names the recovery: copy `.env.example` to `.env` and
fill the blanks.

The package carries an integrity-manifested source template. Generation is
staged and moved into place only after every file is verified and target
configuration succeeds. Existing non-empty directories are never overwritten.
The resulting `GETTING_STARTED.md` describes installation, setup, Doctor and
the selected deployment recipe without hiding any infrastructure step.
