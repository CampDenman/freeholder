---
"freeholder": patch
---

Provider choices now carry neutral names, and no provider is picked for you. The site builder and managed agents can use any OpenAI-compatible gateway (`gateway`: set `AGENT_GATEWAY_URL`, `AGENT_GATEWAY_API_KEY` and `AGENT_GATEWAY_MODEL`), with Paradise Modern's hosted gateway listed as one optional provider (`paradise`). The voice and video settings no longer preselect or label any provider as "first-party": choose Daily or Paradise Comms when you set calls up. Nothing breaks for existing sites: `FREEHOLDER_AGENT=pm_brain`, `PARADISEMODERN_API_KEY`, `PARADISEMODERN_URL`, saved voice/video settings and managed connections saved as `pm_brain` keep working exactly as before (those connections now show as `paradise`). The old `pm_brain` name is deprecated but still accepted.
