---
"freeholder": minor
---

You can now hand your bookkeeper a file their software will actually take.
Under Reports → Accounting exports, define an export, pick whether it is for
QuickBooks, for Xero, or a plain spreadsheet, and choose whether it goes out
every week, month or quarter — or only when you press the button. Whoever you
name gets an email with the figures and a link; the file itself is never
attached, because it lists every customer and what they paid, and an inbox is
not a safe place for that.

The list shows the one thing that matters about a scheduled file: whether the
mail provider accepted every recipient's copy. A later bounce changes that
answer back to failed. A failed delivery says so in red, keeps the file so you
can send it by hand, and waits for an explicit retry instead of mailing a bad
address every hour. An export that should have gone out and did not is flagged
at the top of the page rather than quietly not happening.

Every recipient gets a separate private link that expires after 30 days. The
raw token exists only inside the encrypted mail outbox and the email; Freeholder
stores its HMAC and allows the download only after a delivering provider has
accepted that recipient's message.

Two things it deliberately will not do. It will not add two currencies
together — one export covers one currency, and any invoices in another are left
out of the file and counted separately, so a reconciliation that comes up short
always tells you why. And it will not keep your books: there is no chart of
accounts here, so the account code, tax code and product code go in once, from
your bookkeeper, and get copied onto every row without Freeholder having an
opinion about them. Refunds are reported beside the total rather than turned
into credit notes for you.
