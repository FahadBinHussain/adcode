---
slug: connectors
title: Bring your Claude and OpenAI tools with you
description: Connect MCP servers, Claude Desktop extensions, Claude Code plugins and OpenAPI actions to ADCode, and bring over what Claude, Cursor, Windsurf or VS Code already have.
section: The assistant
published: 2026-10-20
updated: 2026-10-26
order: 9
related: teach-the-assistant-your-project, helpers, whats-new-october-2026
---

ADCode calls anything that gives the assistant tools from outside the editor a connector: a local or remote MCP server, a Claude Desktop extension, a Claude Code plugin, or an OpenAPI description standing in for a ChatGPT plugin or GPT Action. Each is a card on the Connectors tab, with a badge saying which kind it is.

The support is format-level, not brand-level: ADCode reads the formats below, not every file a Claude or OpenAI product can export.

## The four badges

- **MCP.** A server that speaks the Model Context Protocol. ADCode starts a local command over stdio, or calls an HTTP or SSE address.
- **Extension.** A Claude Desktop extension: a `.mcpb` file (formerly `.dxt`) or its unpacked folder, containing a manifest and the server's own files.
- **Plugin.** A Claude Code plugin folder or zip. Its skills and MCP servers can be used here; its commands, agents and hooks come along as files only.
- **Actions.** An OpenAPI 3.x or Swagger 2.0 description. Each operation becomes a tool that sends one REST request. ChatGPT plugin manifests are read the same way.

## Five ways in

The dialog has four tabs and five routes.

**Catalogue** lists MCP servers that need no credential typed into ADCode. Playwright browser, Context7 docs, Chrome DevTools, Sequential thinking, Netlify and Figma Dev Mode are there. Some need Node.js, Chrome, the Figma desktop app or a Netlify sign-in first, and the entry says so. Add saves the server and offers to connect it.

**Import** scans connector files already on this computer: Claude Desktop, Claude Code (including the open project), Cursor, Windsurf and VS Code, plus Claude Desktop's Extensions folder. It reads them where they live and does not change them.

**From a file** (desktop) opens a picker. ADCode reads MCP server configs (JSON), OpenAPI descriptions (JSON), ChatGPT `ai-plugin.json` manifests, `.mcpb` and `.dxt` archives, and Claude Code plugin folders or zips. A plugin marketplace folder is read too, but only plugins stored inside it are offered; ADCode does not clone repositories. A manifest alone is refused with the reason: choose the folder or archive so its files come with it.

**Link or text** takes an HTTPS link (HTTP is allowed for localhost) or the document itself. A link to a ChatGPT plugin manifest fetches the OpenAPI description it points at.

**Custom** is for an MCP server you know by hand. Choose Add connector, then Custom connector. In the next desktop build, **Add custom connector** on the Connectors tab opens the same form directly. Give it a name and an MCP server URL, then press Continue: the ID comes from the name, and ADCode saves the server and tries to connect. If the connection fails, the server stays saved with the reason on its card. Choose SSE or a local command, and add credentials as `NAME=value` lines, under Advanced. OpenAPI APIs are not entered by hand; bring their description through a file, link or pasted text.

## What Add does, and what waits

Anything found appears under Waiting to be added as a dashed card, with its source, purpose and counts — skills, servers, operations or values. Warnings appear there too. Nothing is copied, installed or started until you press Add.

Add opens a short form for the values the source needs — an API token, a server address, an extension setting. Required fields block Add; optional ones can be blank. A value the file already carries is used without asking. Every value goes to the encrypted store — the OS store on the desktop, the private cloud workspace store on the web — never into ADCode's settings.

Extensions and plugins also bring files. On the desktop, Add copies them into `~/.adcode/extensions/<name>` or `~/.adcode/plugins/<name>`. Hooks are copied but never run. A plugin's commands and agents are copied but not offered. Its own MCP servers appear as separate connectors, and its skills appear on the Skills tab. Remove deletes the copied folder with the connector; for a plugin, the servers that came with it go too. MCP and OpenAPI connectors have no files to delete, and the config you imported from is never touched.

Adding saves the connector. The catalogue and custom connector forms offer to connect immediately; imported connectors wait for Connect on their card.

## After you connect

Each saved card has a health light: Connected, Connecting, Needs attention, or Off. A failure adds a plain sentence and Retry. Tools opens the tool list. Every tool starts off, so turn on only what the assistant may call; if the server changes a tool's definition, that tool turns off until you allow it again.

Every call asks first and shows the exact arguments. A deny rule stops it without asking; an ask rule does not add a second question. OpenAPI actions work the same way. An OpenAPI call is one request with no redirects and a 30-second limit; the result starts with the HTTP status and pretty-prints JSON.

## On the web

Import scans only your private cloud workspace. It cannot read apps or files on your computer. Link or text accepts a link, a pasted config or description, or a path inside that workspace; a path to a file on your computer is not opened. Values are kept encrypted in the private cloud workspace, and custom commands run there.

## Limits and safety

- Configs and API descriptions must be JSON. YAML is not read; convert it to JSON first.
- A stdio connector runs a program, so its runtime must be installed where it runs. The catalogue's Node-based servers need Node.js, and ADCode's memory-sharing MCP server asks for Node.js 22.13 or newer. A `.mcpb` that starts a Node or Python server needs that runtime too.
- Remote MCP addresses must be HTTPS; plain HTTP is accepted only for localhost. The address may not carry a username, password, query or fragment — put credentials in Values.
- Warnings are shown, not hidden. ADCode skips an operation it cannot build, such as a file upload, and says how many. It reads up to 200 operations per description and 500 tools per server.
- The connector importer is not a VS Code extension marketplace; a `.vsix` is not installed here.
- Local servers and installed extensions and plugins run with the assistant's permissions. Prefer sources you trust.

## Step by step

### Import Claude Desktop's existing config

1. Open Tools, choose Connectors, then Add connector.
2. Choose Import and press Scan this computer.
3. Cards whose source says Claude Desktop are the servers it found. Press Add on one.
4. Answer any value it asks for, then press Connect on its card and turn on the tools you want.

The config stays where it is; Claude Desktop is unchanged.

### Add Playwright from the catalogue

1. Choose Add connector, then Catalogue.
2. Find Playwright browser and press Add.
3. Approve the connection when asked.
4. Open Tools on the card and enable the browser tools you want.

Node.js must be installed. The first start downloads the browser, taking about a minute.

### Connect a custom HTTP MCP server

1. Choose Add connector, then Custom connector. In the next desktop build, Add custom connector on the Connectors tab opens the same form directly.
2. Give it a name and its MCP server URL, such as `https://example.com/mcp`. The connector ID comes from the name.
3. If the server needs a token, open Advanced and add `Authorization=Bearer …` under Headers or environment values.
4. Press Continue, approve the connection, and enable the tools you want.
5. For a local program instead, choose Local command under Advanced and enter the command and its JSON argument list.

### Remove one

Press Remove on the card and confirm. An extension or plugin's copied folder is deleted; a plugin's own servers go with it, and the connector's stored values are cleared. The config you imported from is not touched.

## Which route should I use?

- Connectors already set up in Claude Desktop, Claude Code, Cursor, Windsurf or VS Code: use Import.
- A common server that needs no credential, such as Playwright or Context7: use the Catalogue.
- An MCP config, OpenAPI description, `.mcpb`/`.dxt`, plugin folder or plugin zip: use From a file.
- A URL, or a document you can paste: use Link or text.
- A name and an HTTP/SSE address, or a local command: use Custom. In the next desktop build, Add custom connector is the shortcut.
- A ChatGPT `ai-plugin.json` manifest: use From a file, or Link or text.
- Working on the web: use Import for the cloud workspace, or Link or text with a path inside it.
