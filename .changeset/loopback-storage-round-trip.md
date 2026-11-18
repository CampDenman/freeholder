---
"freeholder": patch
---

Doctor's storage round trip works again against a storage service on the same machine. Freeholder refuses to send media over plain HTTP, which is right when the bytes would cross a network — but it was also refusing an address that cannot leave the machine, such as a storage container running beside the app, unless the instance was started in test mode. Running something in test mode to check that it works in production mode is not a check. Plain HTTP is now accepted for exactly `127.0.0.1`, `localhost` and `[::1]`, still with the warning that the traffic is unencrypted, and still refused for every other address and for any endpoint carrying credentials, a query or a fragment.
