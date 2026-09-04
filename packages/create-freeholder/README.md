# create-freeholder

Create an independently owned Freeholder source installation:

```sh
npx create-freeholder my-business
```

The CLI asks for the deployment target, business preset, country defaults and
payment choice. For automation, pass every answer explicitly:

```sh
npx create-freeholder my-business --non-interactive \
  --target railway --preset shop --country CA --payments later
```

The package carries an integrity-manifested source template. Generation is
staged and moved into place only after every file is verified and target
configuration succeeds. Existing non-empty directories are never overwritten.
The resulting `GETTING_STARTED.md` describes installation, setup, Doctor and
the selected deployment recipe without hiding any infrastructure step.
