import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui
import "src/store.js" as Store
import "src/config.js" as Config

// The Panel. Everything with logic lives in src/; this file is glue between
// the shell (summon/hide), the Store file, wl-paste/wl-copy and the widgets.
//
// Nothing here touches a file by pathname. The Store and shell.json are read
// and written by bin/store.py through a validated descriptor, the selection is
// read by bin/selection.sh with the cap at the producer, and every helper runs
// under bin/supervise.sh with a deadline and a byte ceiling (BoundedProcess).
Item {
  id: root

  property string omarchyPath: Quickshell.env("OMARCHY_PATH")
  property var shell: null
  property var manifest: null

  readonly property string home: Quickshell.env("HOME")
  readonly property string pluginId: (manifest && manifest.id) || "scoop.omacopper"
  readonly property string pluginDir: Qt.resolvedUrl(".").toString().replace("file://", "")

  // Ceilings. A Store bigger than this is not a scratch list any more.
  readonly property int storeMaxBytes: 1048576
  readonly property int configMaxBytes: 262144
  readonly property int selectionMaxBytes: 32768
  readonly property int entryMaxChars: 32768
  readonly property int rowsMax: 1000

  property bool opened: false
  property var blocks: []
  property string storePath: Config.defaultStorePath(home)
  // Set when the Store could not be read; saving is refused until it clears,
  // so a refused file is never replaced by an empty one.
  property string storeError: ""
  property bool storeLoaded: false
  // -1 while the editor owns the keyboard; otherwise the row under the cursor.
  property int selectedIndex: -1
  // Block index of the Entry loaded into the editor for an Edit, else -1.
  property int editingBlockIndex: -1

  // Shares the [menu] surface tokens — themes that style the menu style this.
  property color background: Color.menu.background
  property color foreground: Color.menu.text
  property color border: Color.menu.border
  property var borderSpec: Border.surfaceSpec("menu", "border", border, Math.max(1, Style.space(2)))
  property color scrim: Color.menu.scrim
  property color selectedBackground: Color.menu.selectedBackground
  property color selectedText: Color.menu.selectedText
  readonly property int cornerRadius: Style.cornerRadius
  property string fontFamily: Style.font.menuFamily
  property int contentMargin: Style.spacing.panelPadding
  property int contentSpacing: Style.spacing.md
  property int cardWidth: Math.min(Style.space(640), panel.width - Style.gapsOut * 2)
  property int cardHeight: Math.min(Style.space(560), panel.height - Style.gapsOut * 2)
  property int editorHeight: Math.round(Style.font.body * 1.5 * 3 + Style.spacing.inputPaddingY * 2)

  readonly property bool editorTooLong: editor.length > root.entryMaxChars

  function today() { return Qt.formatDate(new Date(), "yyyy-MM-dd") }

  function open(payloadJson) {
    root.opened = true
    root.selectedIndex = -1
    root.editingBlockIndex = -1
    root.storeError = ""
    root.storeLoaded = false
    root.blocks = []
    rowsModel.clear()
    editor.text = ""
    // shell.json first: it decides where the Store is. The selection can be
    // read meanwhile; it only fills the editor.
    if (!configProc.running) configProc.running = true
    if (!selectionProc.running) selectionProc.running = true
    Qt.callLater(function() { editor.forceActiveFocus() })
  }

  function close() { root.opened = false }

  function dismiss() {
    root.opened = false
    if (root.shell && typeof root.shell.hide === "function") root.shell.hide(root.pluginId)
  }

  function toggle() {
    if (root.opened) root.dismiss()
    else root.open("{}")
  }

  function loadStore(text) {
    root.blocks = Store.parseStore(text)
    root.storeLoaded = true
    root.rebuildRows(-1)
  }

  function saveStore() {
    if (root.storeError || !root.storeLoaded) return false
    var text = Store.serializeStore(root.blocks)
    if (text.length > root.storeMaxBytes) {
      root.storeError = "The file is too large to save"
      return false
    }
    writeProc.pending = text
    writeProc.kick()
    return true
  }

  // keepBlockIndex: the block the cursor should follow after a rebuild, or -1
  // to keep the cursor where it is (clamped).
  function rebuildRows(keepBlockIndex) {
    var rows = Store.displayRows(root.blocks)
    var now = root.today()
    rowsModel.clear()
    var count = Math.min(rows.length, root.rowsMax)
    for (var i = 0; i < count; i++) {
      if (rows[i].index === keepBlockIndex) root.selectedIndex = i
      rowsModel.append({
        blockIndex: rows[i].index,
        date: rows[i].date,
        dayLabel: Store.dayLabel(rows[i].date, now),
        text: rows[i].text,
        done: rows[i].done
      })
    }
    if (root.selectedIndex >= rowsModel.count) root.selectedIndex = rowsModel.count - 1
    if (rowsModel.count === 0 && root.opened) root.focusEditor()
  }

  function capture() {
    if (root.editorTooLong || root.storeError || !root.storeLoaded) return
    var next = Store.addEntry(root.blocks, root.today(), editor.text)
    if (next === root.blocks) return
    var previous = root.blocks
    root.blocks = next
    if (!root.saveStore()) { root.blocks = previous; return }
    editor.text = ""
    root.rebuildRows(-1)
  }

  function toggleDone(row) {
    if (row < 0 || row >= rowsModel.count) return
    var blockIndex = rowsModel.get(row).blockIndex
    root.blocks = Store.toggleDone(root.blocks, blockIndex)
    root.saveStore()
    root.rebuildRows(blockIndex)
  }

  function removeRow(row) {
    if (row < 0 || row >= rowsModel.count) return
    root.blocks = Store.removeEntry(root.blocks, rowsModel.get(row).blockIndex)
    root.saveStore()
    root.rebuildRows(-1)
  }

  function startEdit(row) {
    if (row < 0 || row >= rowsModel.count) return
    var item = rowsModel.get(row)
    root.editingBlockIndex = item.blockIndex
    editor.text = item.text
    editor.cursorPosition = editor.length
    root.focusEditor()
  }

  function commitEdit() {
    if (root.editorTooLong) return
    var blockIndex = root.editingBlockIndex
    var next = Store.updateEntry(root.blocks, blockIndex, editor.text)
    if (next !== root.blocks) {
      root.blocks = next
      root.saveStore()
    }
    root.endEdit(blockIndex)
  }

  function cancelEdit() {
    root.endEdit(root.editingBlockIndex)
  }

  // Leave the editor clean and put the cursor back on the Entry.
  function endEdit(blockIndex) {
    root.editingBlockIndex = -1
    editor.text = ""
    root.rebuildRows(blockIndex)
    // Deferred: this runs inside the editor's own key handler, and the
    // TextArea takes focus back when that handler returns.
    var row = Math.max(0, root.selectedIndex)
    Qt.callLater(function() { root.focusList(row) })
  }

  function copyBack(row) {
    if (row < 0 || row >= rowsModel.count) return
    copyProc.payload = rowsModel.get(row).text
    copyProc.stdinEnabled = true
    copyProc.running = true
    root.dismiss()
  }

  function focusEditor() {
    root.selectedIndex = -1
    editor.forceActiveFocus()
  }

  function focusList(index) {
    if (rowsModel.count === 0) return
    root.selectedIndex = Math.max(0, Math.min(index, rowsModel.count - 1))
    keyCatcher.forceActiveFocus()
    list.positionViewAtIndex(root.selectedIndex, ListView.Contain)
  }

  function moveCursor(delta) {
    var next = root.selectedIndex + delta
    if (next < 0) { root.focusEditor(); return }
    root.focusList(next)
  }

  ListModel { id: rowsModel }

  // ------------------------------------------------------------- helpers

  // shell.json names the Store. Read bounded like everything else; a refused
  // or oversized file means the default location, never a guess.
  BoundedProcess {
    id: configProc
    maxBytes: root.configMaxBytes + 1024
    deadlineSeconds: 10
    program: ["/usr/bin/python3", "-I", "-S", root.pluginDir + "bin/store.py", "read",
              root.home + "/.config/omarchy/shell.json", String(root.configMaxBytes)]
    onFinishedWith: function(text, tooLarge) {
      var json = lastExitCode === 0 && !tooLarge ? text : ""
      root.storePath = Config.storePathFrom(json, root.pluginId, root.home)
      if (root.opened) readProc.running = true
    }
  }

  BoundedProcess {
    id: readProc
    maxBytes: root.storeMaxBytes + 1024
    deadlineSeconds: 10
    program: ["/usr/bin/python3", "-I", "-S", root.pluginDir + "bin/store.py", "read",
              root.storePath, String(root.storeMaxBytes)]
    onFinishedWith: function(text, tooLarge) {
      if (lastExitCode === 0 && !tooLarge) root.loadStore(text)
      else if (lastExitCode === 3) root.loadStore("")
      else if (lastExitCode === 5 || tooLarge) root.storeError = "The file is too large to open"
      else root.storeError = "Refusing to open the file: not a regular file owned by you"
    }
  }

  // One write at a time. A save that arrives while one is in flight waits as
  // `pending` and only the newest state is written; the file is the whole
  // Store, so an intermediate version has nothing the final one lacks.
  BoundedProcess {
    id: writeProc
    maxBytes: 4096
    deadlineSeconds: 10
    property string pending: ""
    property string payload: ""
    program: ["/usr/bin/python3", "-I", "-S", root.pluginDir + "bin/store.py", "write",
              root.storePath, String(root.storeMaxBytes)]
    function kick() {
      if (running || pending === "") return
      payload = pending
      pending = ""
      // Closing stdin after a write clears the flag for good; every run
      // has to open it again before it starts.
      stdinEnabled = true
      running = true
    }
    onStarted: {
      write(payload)
      payload = ""
      stdinEnabled = false
    }
    onFinishedWith: function(text, tooLarge) {
      if (lastExitCode !== 0) root.storeError = "Could not save the file"
      else kick()
    }
  }

  BoundedProcess {
    id: selectionProc
    maxBytes: root.selectionMaxBytes + 1
    deadlineSeconds: 5
    program: ["/usr/bin/bash", root.pluginDir + "bin/selection.sh", String(root.selectionMaxBytes)]
    onFinishedWith: function(text, tooLarge) {
      if (tooLarge || text.length > root.selectionMaxBytes) return
      var selection = text.trim()
      if (root.opened && editor.text === "" && selection !== "") {
        editor.text = selection
        editor.cursorPosition = editor.length
      }
    }
  }

  // Copy-back. The text travels on stdin, not in argv, where every process on
  // the machine could read it from /proc. Not supervised: wl-copy forks a
  // child that serves the clipboard until something replaces it, and that is
  // the one child that must outlive its parent.
  Process {
    id: copyProc
    property string payload: ""
    command: ["/usr/bin/wl-copy"]
    clearEnvironment: true
    environment: ({
      PATH: "/usr/bin:/bin",
      WAYLAND_DISPLAY: Quickshell.env("WAYLAND_DISPLAY"),
      XDG_RUNTIME_DIR: Quickshell.env("XDG_RUNTIME_DIR")
    })
    stdinEnabled: true
    onStarted: {
      write(payload)
      payload = ""
      stdinEnabled = false
    }
  }

  // ------------------------------------------------------------- surface

  PanelWindow {
    id: panel
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "omacopper"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    Rectangle { anchors.fill: parent; color: root.scrim }
    MouseArea { anchors.fill: parent; onClicked: root.dismiss() }

    BorderSurface {
      id: card
      width: root.cardWidth
      height: root.cardHeight
      radius: root.cornerRadius
      anchors.centerIn: parent
      color: root.background
      borderSpec: root.borderSpec
      padding: root.contentMargin

      MouseArea { anchors.fill: parent; onClicked: {} }

      Column {
        anchors.fill: parent
        anchors.topMargin: card.contentTopInset
        anchors.rightMargin: card.contentRightInset
        anchors.bottomMargin: card.contentBottomInset
        anchors.leftMargin: card.contentLeftInset
        spacing: root.contentSpacing

        BorderSurface {
          width: parent.width
          height: root.editorHeight
          radius: root.cornerRadius
          color: Style.controlFill(editor.activeFocus, false, root.foreground, Color.accent)
          borderSpec: Border.controlSpec(editor.activeFocus ? "focus" : "normal", root.foreground, Color.accent)

          TextArea {
            id: editor
            anchors.fill: parent
            padding: Style.spacing.inputPaddingY
            leftPadding: Style.spacing.controlPaddingX
            rightPadding: Style.spacing.controlPaddingX
            textFormat: TextEdit.PlainText
            wrapMode: TextEdit.Wrap
            placeholderText: "Capture…"
            placeholderTextColor: Qt.darker(root.foreground, 1.6)
            color: root.foreground
            selectionColor: Style.selectionFillFor(root.foreground, Color.accent)
            selectedTextColor: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            background: null

            Keys.priority: Keys.BeforeItem
            Keys.onPressed: function(event) {
              var editing = root.editingBlockIndex >= 0
              if (event.key === Qt.Key_Escape) {
                if (editing) root.cancelEdit()
                else root.dismiss()
                event.accepted = true
              } else if ((event.key === Qt.Key_Return || event.key === Qt.Key_Enter) && !(event.modifiers & Qt.ShiftModifier)) {
                if (editing) root.commitEdit()
                else root.capture()
                event.accepted = true
              } else if (event.key === Qt.Key_Tab) {
                if (editing) root.commitEdit()
                else root.focusList(0)
                event.accepted = true
              } else if (event.key === Qt.Key_Down && editor.text === "") {
                root.focusList(0)
                event.accepted = true
              }
            }
          }
        }

        Item {
          id: keyCatcher
          width: parent.width
          height: parent.height - root.editorHeight - hint.height - root.contentSpacing * 2

          Keys.priority: Keys.BeforeItem
          Keys.onPressed: function(event) {
            if (event.key === Qt.Key_Escape) {
              root.dismiss()
            } else if (event.key === Qt.Key_Up || event.text === "k") {
              root.moveCursor(-1)
            } else if (event.key === Qt.Key_Down || event.text === "j") {
              root.moveCursor(1)
            } else if (event.key === Qt.Key_Home) {
              root.focusList(0)
            } else if (event.key === Qt.Key_End) {
              root.focusList(rowsModel.count - 1)
            } else if (event.key === Qt.Key_Space) {
              root.toggleDone(root.selectedIndex)
            } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
              root.copyBack(root.selectedIndex)
            } else if (event.key === Qt.Key_Delete) {
              root.removeRow(root.selectedIndex)
            } else if (event.key === Qt.Key_Tab) {
              root.startEdit(root.selectedIndex)
            } else if (event.key === Qt.Key_Backtab) {
              root.focusEditor()
            } else if (event.text && event.text.length === 1 && event.text.charCodeAt(0) >= 32 && event.text.charCodeAt(0) !== 127) {
              root.focusEditor()
              editor.insert(editor.length, event.text)
            } else {
              return
            }
            event.accepted = true
          }

          ListView {
            id: list
            anchors.fill: parent
            model: rowsModel
            clip: true
            spacing: Style.space(2)
            boundsBehavior: Flickable.StopAtBounds

            section.property: "dayLabel"
            section.criteria: ViewSection.FullString
            section.delegate: Text {
              required property string section
              textFormat: Text.PlainText
              width: ListView.view ? ListView.view.width : root.cardWidth
              topPadding: Style.space(10)
              bottomPadding: Style.space(4)
              leftPadding: Style.space(12)
              text: section
              color: root.foreground
              opacity: 0.6
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              font.capitalization: Font.AllUppercase
            }

            delegate: Rectangle {
              id: row
              required property int index
              required property string text
              required property bool done

              readonly property bool hasCursor: index === root.selectedIndex

              width: ListView.view.width
              height: body.implicitHeight + Style.space(16)
              radius: root.cornerRadius
              color: hasCursor ? root.selectedBackground : "transparent"

              MouseArea {
                anchors.fill: parent
                cursorShape: Qt.PointingHandCursor
                onClicked: root.focusList(row.index)
                onDoubleClicked: root.copyBack(row.index)
              }

              Row {
                anchors.fill: parent
                anchors.leftMargin: Style.space(12)
                anchors.rightMargin: Style.space(12)
                anchors.topMargin: Style.space(8)
                anchors.bottomMargin: Style.space(8)
                spacing: Style.space(10)

                Text {
                  id: box
                  textFormat: Text.PlainText
                  text: row.done ? "󰄵" : "󰄱"
                  color: row.hasCursor ? root.selectedText : root.foreground
                  opacity: row.done ? 0.5 : 1
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.title
                  MouseArea {
                    anchors.fill: parent
                    anchors.margins: -Style.space(6)
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root.toggleDone(row.index)
                  }
                }

                Text {
                  id: body
                  textFormat: Text.PlainText
                  width: parent.width - box.width - parent.spacing
                  text: row.text
                  color: row.hasCursor ? root.selectedText : root.foreground
                  opacity: row.done ? 0.5 : 1
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                  font.strikeout: row.done
                  wrapMode: Text.Wrap
                  maximumLineCount: 3
                  elide: Text.ElideRight
                }
              }
            }

            Column {
              anchors.centerIn: parent
              visible: rowsModel.count === 0
              spacing: Style.space(8)
              Text {
                textFormat: Text.PlainText
                text: root.storeError ? "󰀦" : "󰆐"
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                color: root.selectedText
                opacity: 0.8
                font.family: root.fontFamily
                font.pixelSize: Style.font.displayLarge
              }
              Text {
                textFormat: Text.PlainText
                text: root.storeError ? root.storeError : (root.storeLoaded ? "Nothing captured yet" : "")
                color: root.foreground
                opacity: 0.7
                font.family: root.fontFamily
                font.pixelSize: Style.font.title
              }
            }
          }
        }

        Text {
          id: hint
          textFormat: Text.PlainText
          width: parent.width
          text: root.storeError
            ? root.storeError + " · Esc close"
            : root.editorTooLong
              ? "Too long to save · at most " + root.entryMaxChars + " characters"
              : root.editingBlockIndex >= 0
                ? "Editing · Enter or Tab save · Shift+Enter newline · Esc discard"
                : root.selectedIndex < 0
                  ? "Enter save · Shift+Enter newline · Tab list · Esc close"
                  : "Tab edit · Space done · Enter copy · Del remove · Esc close"
          color: root.foreground
          opacity: 0.45
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          elide: Text.ElideRight
        }
      }
    }
  }
}
