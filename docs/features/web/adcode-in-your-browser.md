---
slug: adcode-in-your-browser
title: ADCode in your browser
description: Chat with included AI and review GitHub changes in a browser, with an optional private Linux workspace for commands and live previews. A preview rollout.
section: The workbench
published: 2026-10-20
order: 3
related: whats-new-october-2026, free-ai-without-the-meter, workbench-cloud-workspace
---

# ADCode in your browser

ADCode has a browser workspace at web.bluethenics.com. It comes in two parts, and the difference matters. The first is chat and GitHub work that opens without reserving a computer. The second is an optional cloud workspace: a private Linux machine for commands, running projects and previews. You can use the first without the second.

This is a preview, not the full IDE in a tab: browser chat has no code editor, debugger or language server.

## Availability

The browser workspace is a preview rollout. Production builds currently ship a static notice instead of the app, so web.bluethenics.com may show "The web version is paused". If you see that notice, the browser workspace is not open to you yet. The desktop app has the same assistant and no cloud time limit. This page describes the preview build; it is not a promise of general availability.

## What works without a cloud workspace

Sign in with Google, GitHub or email. You land in a chat, not a loading screen for a machine. Ask a question, paste an error, or talk through an idea. ADCode's included AI answers without needing an API key, and your conversations are saved to your account, with tabs for the ones you have open and a searchable list for the rest.

Opening this chat does not reserve, start or charge a sandbox. There is no queue for coding capacity and no cloud-time meter running in the background. That also means chat and your saved history stay available when the cloud workspace is full, when the shared monthly budget is exhausted, or when you have not opened a workspace at all.

What you cannot do here is run the project. Browser chat has no code editor, terminal, debugger, language servers or local models. It reads code as text and talks to GitHub; it does not execute your repository.

## GitHub mode: read, propose, review

GitHub mode is for working on a repository without cloning it to a machine. Choose Connect GitHub in the project panel. ADCode shows a short code; enter it on GitHub's sign-in page and authorize the connection. You can connect a public or private repository your account can read.

Pick a repository and a branch. ADCode reads the files at a fixed commit, so the conversation stays on the version you chose even if someone pushes. Ask about the code, select specific files, or let the assistant find the relevant ones. Then ask for a change.

The assistant prepares the edits but does not apply them. They appear under Proposed changes with a diff for each file. Nothing is written to GitHub until you choose Create pull request. That action creates a new branch and a pull request; your selected branch, including main, is untouched until you merge on GitHub. If the branch moves while the pull request is being prepared, ADCode stops and asks you to refresh rather than overwrite it. Repositories you can only read cannot receive a pull request, and changes to GitHub workflow files have to be made on GitHub itself.

In this mode the assistant cannot run tests, commands or a build. It can read code and reason about it, but it cannot know whether your checks pass. Treat any claim that tests passed as unverified, and run them yourself or in the cloud workspace. GitHub is the storage and collaboration layer here, not the computer.

## The optional cloud workspace

When you need execution, choose Open cloud workspace. It is a separate view with its own projects and credentials. Browser proposals are not copied into it automatically, so create the pull request first or bring the branch in deliberately.

The cloud workspace gives you a private Linux sandbox: a terminal, the ability to install dependencies and run commands, and a place to run the project. Live previews open at a private address under web.bluethenics.com that only your browser can reach; anyone else gets a not-found page. The assistant can also drive a headless Chromium browser inside the sandbox, so it can look at the running app and click through it. You can download any project as a .tar.gz without node_modules, connect GitHub to push and to import private repositories, and delete the whole workspace when you are done.

There is no personal running-time quota in this release. There is still shared capacity and a shared monthly cloud budget. A limited number of sandboxes run at once; when they are all busy, the page says it is waiting for a free sandbox and retries. When the shared monthly budget is used up, running sessions can be paused even while an agent is working. ADCode saves your home folder before stopping and keeps the previous save if the new one fails; the workspace can resume after capacity or the budget returns.

By default, a workspace sleeps after five minutes with no tab open, or after fifteen minutes with an open tab nobody has touched, unless an agent is still working. Its home folder is archived while it runs and restored when it wakes, so projects come back as you left them. A workspace nobody opens for 90 days is deleted.

## Limits worth knowing

- Up to 50 active conversations, with 200 messages and 512 KiB per conversation. When the list is full, delete a conversation or continue an existing one.
- The 10 most recently deleted conversations can be restored. Deleting frees a slot immediately.
- GitHub context excludes credential files, binaries and symlinks. Only regular text files can be proposed as changes.
- GitHub tokens are encrypted on the server and never sent to the browser or the model.
- In the cloud workspace, the Tools page's Import option scans only that workspace, not apps or configuration on your computer.
- There are no local models and no Ollama option in the browser. Pick from the included AI models offered in the chat.
- Browser chat is not the full IDE. For an editor, debugger, language servers and a local terminal, use the desktop app.

## Try it

1. Open web.bluethenics.com. If you see the paused notice, use the desktop app instead; the remaining steps describe the preview build.
2. Sign in with Google, GitHub or email.
3. Start a conversation and ask about your code or an idea. Find it later in the chat list; it does not need a workspace.
4. Choose Connect GitHub, enter on GitHub the code ADCode shows you, then pick a repository and branch.
5. Ask about the code, then request a change. Open Proposed changes and read the diffs.
6. Choose Create pull request when the change is right. Review and merge it on GitHub, where your normal checks live.
7. Only if you need to run something, choose Open cloud workspace, run the project, open its preview, and download a .tar.gz copy when you are finished.

## What to use instead

Use the desktop app when you want the full IDE: a code editor, debugger, language servers, a local terminal, your own machine and local models including Ollama. It also has no cloud time limit, and it keeps working if the browser entry is paused or the shared cloud budget is full. Use browser chat when you want to ask about a repository or prepare a reviewed change without installing anything, and the cloud workspace when you need a Linux machine for a short run.

The browser is a second way into ADCode, not a smaller version of the desktop. Review before you merge, download work you want to keep, and treat the preview notice as the source of truth about whether the entry is open.
