---
"@freeholder/cli": patch
---
You can now ask an AI agent to plan a DigitalOcean launch with one line: `npx @freeholder/cli@next launch --provider digitalocean --domain example.com --dry-run` shows every step and what it will cost each month, using DigitalOcean's own list price, and creates nothing. When you run the launch through `npx`, the next steps it prints are commands you can paste as they are. The agent instructions no longer assume Replit: they cover DigitalOcean and Replit, and say plainly that you run the real launch, open the claim link and issue your agent's key yourself. Every package release now proves the published command works before it ships.
