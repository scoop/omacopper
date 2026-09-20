# omacopper

Quick-capture scratchpad for Omarchy, modelled on Copper (shadcn.com/copper): one hotkey, one panel, one local file.

## Language

**Entry**:
One stored item with text, created-at and a Done state. A note is simply an Entry never marked Done.
_Avoid_: Note, task, todo, item

**Capture**:
Creating an Entry from the Panel, prefilled from the primary selection when non-empty.
_Avoid_: Clip, grab, save

**Edit**:
Replacing the text of an existing Entry from the Panel; its Done state and position are untouched.
_Avoid_: Update, modify, rename

**Panel**:
The single floating UI summoned by the hotkey; where Capture, browsing, Done toggling and Copy-back happen.
_Avoid_: Window, popup, overlay

**Done**:
The checkbox state of an Entry, set only by the user.
_Avoid_: Completed, checked, archived

**Copy-back**:
Placing an Entry's text on the system clipboard for pasting into another app.
_Avoid_: Copy, export, yank

**Day**:
The group of Entries created on one calendar date, the only creation-time granularity the Store keeps.
_Avoid_: Section, group, date

**Store**:
The single local markdown file holding all Entries. Human-editable; the app is not its only writer.
_Avoid_: Database, notes file, vault
