---
"@freeholder/cli": patch
---
`freeholder launch --destroy` now tells you when it could not delete the site's storage key, and which one to remove in the DigitalOcean console, instead of reporting it deleted. It also reminds you that DigitalOcean keeps billing for Spaces until you cancel it there. The domain and site name you pass are now read in a way that stays fast on any input. The CLI's README states what a launch costs and asks you to keep the generated settings file, which holds the key protecting your connected accounts, somewhere safe.
