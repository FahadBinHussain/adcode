---
slug: the-new-vibe-window
title: "The new Vibe window, explained"
description: "A tour of the 2.4 Vibe frame: icon rail, sidebar card, chat tabs, new type and quieter borders, plus what changed, what did not, and the limits."
section: The workbench
published: 2026-10-20
order: 2
related: whats-new-october-2026, workbench-vibe-sidebar
---

# The new Vibe window, explained

2.4 gives Vibe a new frame, first built for ADCode's browser workspace: a narrow icon rail, a card for the project and conversations, a tab per open chat, and the work in a second card. The desktop app now wears it; the IDE window does not.

This is a frame change, not a new assistant. The same models, chats, agents and files are underneath. The aim is to make a chat-first window easier to scan: where you are, what you are working on, what is running and what needs you.

## The frame at a glance

The far left is an icon rail. Six places have a button: Chat, Agents and Tools switch the page in the middle; Changes, Preview and Automations open over that page as floating windows and close when you select them again. The ADCode mark above them returns to Chat. At the foot of the rail sit notifications, settings, More, feedback, your account and, on the desktop, the live-session button.

The Changes button carries a badge with the number of uncommitted files. It turns blue when something needs you, such as a conflict or AI edits waiting to be applied. That is the point of the rail: the state you check most often is visible without opening anything.

## The sidebar card

Beside the rail is one card for context. At the top are the ADCode name, search and the menu button. The project card shows the folder, its branch and how many files have changed; select it to switch project, open or clone a folder, or see the project overview. Under Chats are earlier conversations, grouped by day and searchable. New conversation and Ctrl+Shift+N start a fresh one.

At the bottom of the card are Docs, All features and Keyboard shortcuts, then the Open IDE card. Drag the card's right edge to resize it; Ctrl+B hides or shows it. In a narrow window it becomes a drawer.

## Tabs along the top

Every open conversation gets a tab across the top of the window. The tab mirrors the chat list rather than keeping a separate copy, so a rename or a status change appears in both. A spinner means the chat is working; a dot means it finished, or stopped, while you were looking elsewhere. Closing a tab closes the view, not the conversation: the chat stays under Chats and can be opened again.

To the left of the strip are the sidebar toggle, Changes and Preview; to the right are the workspace picker and Run. The strip holds up to eight chats, in the order you opened them. It is not a second history and it does not reorder.

## Type, borders and motion

The frame uses three typefaces. Manrope is the interface face: labels, conversation text and controls. Space Grotesk is the display face, used for the wordmark and a few titles. Geist Mono is for code, shortcuts and small counts such as the Changes badge. Prose stays readable; code-like values stay distinct.

Borders are quieter than the old chrome. Panels sit on a darker canvas with hairline edges and small gaps, so the sidebar and conversation read as two surfaces rather than a wall of boxes. There is still a clear edge around the work; it just does not compete with the text.

Motion is short: most transitions run between 140 and 200 milliseconds. With reduced motion, either from your system or ADCode's setting, transitions are removed and the working indicator slows rather than spinning at full speed.

## The menus moved, the commands did not

The Vibe window no longer has a title-bar row of menu words. The button beside the ADCode name opens File, Edit, View, Help and the rest in a card. These are the same menus the IDE uses, with the same commands and recent projects.

This frees the row of words and, on Windows, the space the window controls need. The cost is one click: the menus are no longer permanently visible in Vibe.

## A practical tour

1. Start at the ADCode mark; it returns to Chat.
2. Use Chat, Agents and Tools to change the middle. Agents is the board of running and saved agents; Tools is tools, connectors, skills and memory.
3. Changes shows uncommitted files, diffs and Commit & Push. Preview shows the running app; Automations schedules a message. Select the same button again to close.
4. The project card shows folder, branch and change count. Select it for recent projects, Open, Clone and overview.
5. Start a chat with Ctrl+Shift+N, then open another while it works. Tabs and Chats show which are busy.
6. Drag the sidebar edge, or press Ctrl+B to hide it. In a narrow window, open the drawer with the same key.
7. Choose Open IDE at the bottom when you need the editor, terminal and debugger.

## What problem each change solves

- **The rail** makes everyday places visible and shows whether Changes needs you, without opening a panel.
- **The sidebar card** keeps project and history together; switching projects is two clicks, with branch and change count in view.
- **Tabs** make background work legible: you can see which chat is running and return to it. A tab is a view, not a second copy.
- **The menu button** frees the title-bar row and, on Windows, the space the window controls need. The commands are unchanged; the route is one click longer.
- **Type and quieter borders** create hierarchy: Manrope for prose, Space Grotesk for display, Geist Mono for code and counts; hairlines and spacing replace heavy boxes.
- **Motion** confirms a press without making you wait; reduced motion removes it.
- **The unchanged IDE** keeps the dense editor layout for editing, terminals and debugging.

## What did not change

- The IDE window keeps its title bar, menu row, status bar, editor, terminal, debugger and file explorer. The frame is only on Vibe.
- The menus themselves: same commands, shortcuts and recent projects. Only where they appear in Vibe changed.
- Your chats, projects and edits. Conversations are still stored per project on your machine; tabs and the sidebar read the same list.
- The AI: the same included models, own keys, local models, Helpers, Teams, rules and connectors.
- Changes, Preview, Automations and the project overview still open as floating panels, and each remembers where you left it.
- The shortcuts you already use: Ctrl+B for the sidebar, Ctrl+Shift+N for a new chat, and Ctrl+I for the assistant in the IDE window. The frame adds no new ones.
- Themes: Light, Dark and Midnight still apply.

## Limits

- The frame is Vibe-only. The IDE window does not get the rail, card or tabs.
- Only Chat, Agents and Tools are pages. Changes, Preview and Automations are panels, so selecting them does not change the page underneath.
- The rail is icon-first. Names appear as tooltips on hover and to screen readers; on a touch screen you have to know the icon.
- The tab strip holds eight chats and does not reorder. When it is full, the oldest tab that is not active makes way. Closing a tab does not delete the chat.
- The sidebar becomes a drawer in a narrow window, and panels open full-size there. Some controls move into a compact actions area.
- The Vibe menu bar is no longer permanently visible; File, Edit, View and Help take one extra click.
- Reduced motion removes transitions, but the working indicator still turns slowly so you can see that a chat is busy.
- The same frame is used by the browser workspace, which is in preview and whose production is paused. Screenshots of the web version may not match the desktop build.
