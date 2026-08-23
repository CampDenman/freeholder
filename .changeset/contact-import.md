---
"freeholder": minor
---

Bring your contact list in from a spreadsheet, and take it back out again if it
goes wrong.

Upload a CSV and Freeholder reads it properly — a company name with a comma in
it, an address that runs onto two lines, a file Excel saved: all of them survive
intact rather than shifting every column along by one. It guesses what each
column means and shows you the first value from each, so you can correct the
guesses before anything happens.

Then it tells you exactly what the file would do: how many new people, how many
existing records it would fill in, how many are already right, and which lines
it cannot use and why — with the line number, so you can open the file and fix
them. Nothing is written until you say so.

People already in your contacts are recognised by their email address and
updated rather than duplicated, so importing the same list twice does not give
you two of everybody.

And it can be undone. Anything the import changed goes back to what it was, and
anyone it brought in is removed — except the people who have since ordered,
booked or been quoted, who are kept, because undoing an import should not undo
your work.
