---
"freeholder": minor
---

An optional assistant that answers website chats for you.

Turn it on in Admin → Assistant and it replies to visitors on your site in your
business's name, in the same conversation you would have answered yourself — so
everything it says lands in your inbox, on that person's history, and you can
take over at any point.

It is off until you switch it on, and it is off in a way that costs nothing:
with no assistant, your chat works exactly as it did before.

You stay in charge of three things:

- **Who answers.** Pick your model provider and model. Your API key is never
  stored in Freeholder — you tell it the name of the environment variable your
  host keeps the key in, and the screen tells you whether it found it.
- **What it may do.** The assistant can only talk unless you allow more. Today
  it can hand a conversation to a person, and record a quote request against
  the visitor's own contact record. Both are off until you allow them, and it
  cannot reach anything that is not on that list.
- **What it may spend.** Set a limit per day, week or month, plus a cap on
  answers per conversation and per hour. Every limit is checked *before* an
  answer, not added up afterwards, so it stops rather than overshoots.

The Assistant screen also shows the last fifty attempts, refusals included, with
what each one cost — so if it goes quiet you can see why rather than guess.
