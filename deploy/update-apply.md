# Apply and roll back

The applier is snapshot → verify/pull → migrate → smoke → cutover → release
note. Any failure in migrate, smoke or cutover rolls back without being asked.

Rollback of a compatible schema is an image swap, not a restore. The snapshot
is still taken so a breaking release has a restore point. Image pull and
cutover for each Tier-1 recipe are C10.10; this instance ships a local adapter
that records the flow without swapping containers.

`platform.applyUpdate` is the mutation. `platform.listUpdateRuns` is the
history. Doctor does not apply.
