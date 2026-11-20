---
"freeholder": patch
---

A private installation can now build and sign its own images, not just verify them. `.forgejo/workflows/publish-image.yml` completes the self-attested lane: it builds at an exact 40-character revision, pushes to a private registry, signs the resulting immutable digest with a key only that installation holds, and then verifies that signature against the public half before finishing — so a mismatched keypair fails during publication rather than on a production host at update time. It is dispatch-only, because an image build is expensive on a shared runner fleet, and it refuses to publish a revision that has no successful CI run, with no override. The image carries the source revision as a label, which is what the updater's forward-only ancestry check compares. Nothing about the upstream GitHub promotion workflow changes; this is a parallel lane for installations that do not use it.
