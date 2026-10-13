# Free AI, activity and the updated Agents page

Prepared for ADCode 2.3 on 10 October 2026. These desktop features require the updated app; the public installer is only updated when a release is published.

## Start with included AI

Open **Account**, sign in, and verify your email. New installations select the administrator’s included default model automatically. Older installations with an unconnected default provider also switch. Your existing connected provider stays selected.

In **Connect a model**, use **Free · no API key** to see included models and ready local models. Select a card, then **Use this model**. **Bring your own key** keeps your personal provider connections in a separate tab.

Included models are free to the user within an account allowance. Tagflow Code 27B is the configured starting model, with a **256k token context window** shared by the conversation, tools and reply. Included requests pass through ADCode’s server to the selected provider, including the prompt, relevant project context and tool results. Provider credentials stay on the server. Included models currently support text and tool calls, not image attachments.

## Read usage and activity

Choose **Usage** in the chat header, **Usage by model** in the context menu, or **AI: Show Usage** in the command palette.

- **Your free AI today** puts tokens left first, with a bar showing the amount remaining. The current live allowance is **2,000,000 tokens per user per day**, shared across devices, with the reset time shown in your local timezone (midnight UTC). The administrator can change the allowance. Requests show **Unlimited**, alongside today's request count and tokens held for active replies. ADCode has no daily or per-minute request cap; provider limits and the daily token allowance still apply. **How this allowance works** explains tokens, tool requests and the service budget paid by ADCode.
- Chats and agents wait at recoverable temporary or daily limits and resume automatically after the displayed reset time. Keep ADCode running; **Stop** cancels the wait, and closing the app ends automatic resumption. A request larger than the entire daily allowance needs a smaller conversation or a higher allowance. All free models share the same daily account allowance; your own connected model uses its provider account.
- **Today, 7 days, 30 days, All time** change the local totals and model breakdown. A model without a known price says **No price**. `≈` identifies estimated counts. Included AI has no charge to you; provider dashboards show the exact bill for your own keys.
- **Activity** always shows the past 365 days. Each square is a local calendar day with AI requests from chat or agents on this computer. Stronger green means more requests. Hover, click or focus a square to inspect its date, requests and tokens.
- **Current streak** counts consecutive active days through today, or yesterday while today is still empty. **Longest streak** is the longest run within the displayed year. **Active days** counts days with at least one request.
- Use the arrow keys to inspect the calendar; **Home** and **End** jump to the first and last day. Narrow windows scroll the calendar horizontally and open at the newest days. Live updates keep your selected day and reading position.

This is AI usage activity, not a count of commits or time spent typing. It uses existing local usage records. Clearing usage removes this computer’s history, activity and streaks; it does not reset the account allowance or erase your provider’s billing records.

## Work with starter agents

On the first visit to **Agents**, Reviewer, Tester, UI polish, Bug fixer and Docs writer appear immediately. They follow the currently connected model. Reviewer has read-only tools; the others keep their configured tool access.

Each card separates the model from tool permissions and keeps Run, Edit, Duplicate and Delete in consistent positions. **Edit → Use the currently connected model** follows changes in Connect a model. Turn it off to select a fixed connection and model for that specialist. Existing agents with a fixed model retain it.

Team tasks run independent roles in parallel. A reviewer or another dependent role waits for its teammates' handoffs. **Settings → AI → Agents working at once** controls the shared limit for Agents board runs and Team roles, from one to six (three by default); an individual Team plan and its provider can impose a lower limit. A normal chat uses the main assistant until you start a Team.

## Watch and review work in chat

The main assistant's file edits stream into an inline code window with a **Typing** indicator and the file name. Its activity label changes to **Writing** as the first draft arrives. Growing code follows the latest work while you are at the bottom; scrolling up keeps your reading position. The live window stays inside the transcript and settles when the turn finishes.

Markdown tables render as real tables with column headers, rows and cells. Wide tables scroll horizontally inside the message, and their contents retain inline code and file links.

An automatically applied turn shows an **Edited files** card with line counts, **Review** and conflict-aware **Undo**. Reopening a saved chat reloads its retained edit cards in conversation order, including whether edits were already undone. New checkpoints record their conversation. Older checkpoints are restored only when one nearby saved assistant message identifies their conversation unambiguously; missing or expired checkpoints are not invented.

The cards adapt to smaller windows. **Reduce motion** and the operating system’s motion preference disable decorative transitions and animations while status changes remain visible.

## Manage models and allowances

Open **Admin → Free models** on the website. Configure the models offered without a user API key, their display names, upstream model IDs, context and reply limits, prices, availability, and the default. Add new models here as providers release them.

Tagflow, OpenAI, Gemini, Groq and OpenRouter are supported server connections. Each provider must have its encrypted Cloudflare secret configured before its models can be offered. Credentials are never entered into model cards or shipped in the installer.

Set default per-account daily tokens and estimated spending. The **Unlimited requests per day** and **Unlimited requests per minute** controls remove ADCode request caps. Turn either off to set a finite cap. Use **Individual allowance** to override or block one account. Limits apply together: zero requests, tokens or requests per minute blocks usage; a zero spending limit permits only requests whose configured cost is zero. Saving a limit does not erase consumed usage. For your free Tagflow allocation, input and output prices can remain zero and can be changed later in admin.

**Admin → BYOK models** controls recommendations, hidden models and additions for people using their own credentials. See [the setup and accounting guide](../TAGFLOW-SETUP.md) for server secret names, supported endpoints and reservation rules.

## Meet the team

The website’s **About us** section introduces ADCode’s mission and founder, Sinan Faizal Bayan, using the supplied portrait. **Talk to the team** opens the [30-minute Calendly booking page](https://calendly.com/bluethenics01/30min) from the navigation, homepage, About section and footer. It does not book a meeting automatically.
