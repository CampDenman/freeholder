---
"freeholder": patch
---

An instance that serves its own container images can now roll back. Rolling back an image-swap deployment required a pin matching `ghcr.io/campdenman/freeholder@sha256:<64>` exactly, so any instance running images from a mirror, a private registry or its own forge was refused its own digest and could not roll back at all — the deployments most likely to need one. The repository half of that pin is now `FREEHOLDER_IMAGE_REPOSITORY`, defaulting to the upstream registry so nothing changes for instances that use it. The safety property is unchanged and is the digest, not the registry: a bare repository, a moving tag like `:latest`, and a short, over-long, upper-case or non-hexadecimal digest are all still refused, as is a digest belonging to a repository other than the configured one.
