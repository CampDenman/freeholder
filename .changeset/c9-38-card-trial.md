---
"freeholder": minor
"@freeholder/sdk": minor
---

A card-required trial stays paused, with no access, until the customer saves a payment method. The trial window starts at that moment. A setup fee is invoiced on its own and, once paid with a consented saved card, opens the trial rather than a paid period of the recurring price. A zero fee opens the provider's card-setup checkout, and the customer starts the trial from the saved card. A manual adapter, or a provider that cannot save a card without a charge, keeps the plan unavailable.

This is beta functionality. The adapter double proves the signup, the setup-fee invoice, and the card-setup handoff. Live recurring settlement remains C11.05.
