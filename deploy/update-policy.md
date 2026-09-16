# Update policy

Defaults are for the owner who never opens this screen: **security updates
apply automatically**, in a night window in the business timezone, with drain
and snapshots. Feature updates wait for approval.

| Field | Default |
|---|---|
| channel | `security` |
| apply | `security` |
| window | Tue–Thu 03:00–05:00 in the business timezone |
| drain | on |
| keep_snapshots | 5 |

Outside the window the updater skips rather than forcing a cutover. Pause with
`pausedUntil`. `channel: off` is the runtime off path; `FREEHOLDER_UPDATE_CHECK=off`
is the deploy-time one.

`platform.getUpdatePolicy`, `platform.saveUpdatePolicy` and
`platform.evaluateUpdatePolicy` are the services. Admin UI is C10.11.
