# Omacopper

A quick-capture scratch list for Omarchy 4.x, after
[Copper](https://shadcn.com/copper) on the Mac: one hotkey, one panel, one
markdown file.

Select something anywhere, hit the key, and it lands in the editor. `Enter`
keeps it. Later, open the panel again, pick an entry, `Enter` puts it on the
clipboard for pasting into Claude, a terminal, a ticket. Check things off as you
go. Everything lives in a plain markdown file you can open in any editor or drop
into your Obsidian vault.

## Requirements

- Omarchy 4.x (Quickshell shell)
- `wl-clipboard` — present on a stock Omarchy

## Install

```bash
omarchy plugin add https://github.com/scoop/omacopper --enable
```

## Keybinding

The plugin cannot install a binding for you. Add to `~/.config/hypr/bindings.lua`:

```lua
o.bind("SUPER + CTRL + M", "Omacopper", "omarchy-shell shell toggle scoop.omacopper")
```

Optionally, a row in the Omarchy menu, in `~/.config/omarchy/extensions/omarchy-menu.jsonc`:

```jsonc
"omacopper": {"icon":"󰆐","label":"Omacopper","action":"omarchy-shell shell toggle scoop.omacopper"},
```

## Using it

The panel opens with the editor focused and prefilled from whatever text is
currently selected (the primary selection), if any.

| In the editor     | Does                                 |
| ----------------- | ------------------------------------ |
| `Enter`           | save the entry                       |
| `Shift` + `Enter` | newline                              |
| `Tab`, `↓`        | move to the list (`↓` when empty)    |
| `Esc`             | close, discarding what was not saved |

| In the list      | Does                                             |
| ---------------- | ------------------------------------------------ |
| `↑` `↓`, `k` `j` | move; `↑` past the top returns to the editor     |
| `Tab`            | edit the entry: `Enter` saves, `Esc` cancels     |
| `Space`          | toggle done                                      |
| `Enter`          | copy the entry to the clipboard and close        |
| `Delete`         | remove the entry, no confirmation                |
| any letter       | back to the editor, starting a new entry with it |
| `Esc`            | close                                            |

Newest day first, newest entry first. Done entries sink to the bottom of their
day and stay there until you delete them.

## The file

`~/.local/share/omacopper/entries.md`, by default:

```markdown
## 2026-09-18

- [x] ask about the invoice
- [ ] https://example.com/that-article

## 2026-09-19

- [ ] prompt that worked:
      summarise the thread, then list open questions
```

One `##` heading per day, one `- [ ]` item per entry, continuation lines
indented two spaces. Edit it by hand whenever you like; the panel re-reads it
every time it opens. Lines it does not recognise are left exactly where they
are. The file order is chronological; the panel's ordering is display only.

## Configure

To keep the file somewhere else — an Obsidian vault, say — add `storePath` to
this plugin's entry in `~/.config/omarchy/shell.json`:

```json
{ "id": "scoop.omacopper", "storePath": "~/vaults/Second Brain/Inbox.md" }
```

`~` expands to your home. The change takes effect on the next open.

## Removing

```bash
omarchy plugin remove scoop.omacopper
```

The markdown file, the keybinding and the menu row are yours and stay.

## Developing

Plugin folders may not contain symlinks, so work in a clone and sync it into
place:

```bash
rsync -a --delete --exclude .git --exclude node_modules ./ ~/.config/omarchy/plugins/scoop.omacopper/
omarchy-shell shell rescanPlugins
omarchy-shell shell toggle scoop.omacopper
```

Everything with logic in it is plain JavaScript under `src/`, loaded by both the
shell and the test runner:

```bash
bun test
bun run lint
```

If an error's line number stops moving when you edit `Panel.qml`, restart the
shell: `omarchy-restart-shell`. The QML engine caches a plugin's compiled
component for the life of the shell process.

## License

MIT
