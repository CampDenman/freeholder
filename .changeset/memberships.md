---
"freeholder": minor
---

You can now sell memberships. Create a plan — what it gives people, how often
it bills, whether it starts with a free trial, whether there is a one-off
joining fee — and put a contact on it from the memberships screen.

A plan has no price of its own. It points at one of your products, and that
product's price is what gets billed, so changing what a membership costs is one
edit rather than two places that can disagree.

Every period raises an ordinary invoice, the same kind everything else in
Freeholder raises, which you send as usual. Automatic card renewals are not
here yet: they need a way to charge a saved card without the customer present,
which the payment providers side of Freeholder does not do yet, and a plan that
quietly never billed anybody would be worse than saying so. Choosing an
automatic mode is refused, with that reason.

A month means a month. Somebody who joins on the 31st of January renews on the
28th of February and stays on the 31st thereafter, rather than sliding a day
later every year.

Cancelling keeps access until the end of the period already paid for, and then
stops — access never outlasts the money, and never disappears early. You can
override that per plan if you would rather cut people off immediately.

Pausing does not burn the rest of the month: somebody who pauses on day three
and comes back in August still has twenty-seven days waiting for them.

Every subscription keeps its own history — started, trial began, became paying,
invoiced, paused, resumed, cancelled, ended — so "why did this customer stop
paying in March" has an answer. A period that could not be billed is recorded
with the reason instead of being skipped silently, and the period does not
move, so nobody gets a month they were never billed for.

Customers can cancel their own membership from the portal without emailing you.
