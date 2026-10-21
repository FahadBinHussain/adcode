---
slug: free-ai-without-the-meter
title: Free AI, without the meter
description: Included AI with a verified ADCode account: no API key, no personal usage quota, and no meter to watch. What still has limits, and what to do when a request fails.
section: The assistant
published: 2026-10-20
order: 4
related: whats-new-october-2026, connectors, teach-the-assistant-your-project
---

# Free AI, without the meter

ADCode includes AI with a verified ADCode account. You do not need an API key, a card, or a separate subscription. In version 2.4 there is also no personal meter to watch: included models have no ADCode request, token, daily or weekly quota.

That is a change from 2.3's daily token allowance, which is gone rather than enlarged. This page explains what you get now, what "free" still does not cover, and what happens when a request fails.

## Start with an included model

Sign in from Account with Google, GitHub or email, and verify your email address. Verification ties included AI to you rather than to a machine.

On a new installation, an included model is already selected, so you can type a message without opening a settings screen. If you used ADCode before and had no model connected, it selects one for you as well. Your own connected providers are left alone.

The model menu lists every included model, alongside models from any provider you connected yourself. Each entry says what the model can read at once and what it costs per million tokens; included models cost you nothing. Switching takes effect on your next message and keeps the conversation, including its summary and completed tool results.

Included AI accepts text and tool calls, so it can read and search your project, edit files, run commands and check its work. It does not accept image attachments. If a tool returns an image, the assistant works from the tool's text findings instead.

## The daily allowance, and why it is gone

Version 2.3 gave each account 1,000,000 included tokens per day, shared across devices, with unlimited request counts. The allowance reset daily. When it ran low, a long task could stop and wait for the reset, and a request larger than the remaining balance could fail even though the next day would have had room.

That design made a free tool feel like a budget to manage. You could see the meter, so you planned around it: stop before the reset, postpone a large job, or wonder whether a failure was your code or your balance. Version 2.4 removes the personal allowance so included AI works like the rest of the editor. There is no daily refill to wait for and no quota screen to check before starting.

"Unlimited" in the composer means ADCode sets no personal usage limit. It does not mean infinite capacity. The service still has real providers, real costs, and busy periods. What changed is that ADCode no longer adds a personal quota on top.

## What free does not mean

Free refers to payment and to ADCode's metering. It does not promise that every model, every request size or every moment will work.

- **Provider availability.** A provider can be slow, rate-limit requests, or be unavailable for a while. The chat names the provider and explains the wait.
- **Context limits.** The conversation, tool results and reply share the model's context window. ADCode compacts a long conversation as it fills, but a single request can still be too large, and a reply can still reach its output limit.
- **Shared service capacity.** Included AI is a shared service. At a busy time you may be asked to wait or try again. Free does not reserve a private machine for each request.
- **Account access.** Included AI needs a verified account. An account can be blocked or have included AI switched off.

None of these is a hidden personal quota. They are the limits of the provider and the service doing the work.

## Where your request goes

Included AI does not put a provider key on your computer. When you send a message, the prompt, the relevant project context and the tool results pass through ADCode's server to the selected provider. The server stores usage counts, not your prompts or replies.

Only the context needed for the request is sent.

## Check Usage without watching a quota

Select Usage in the chat's header, or run AI: Show Usage from the command palette. Choose Today, 7 days, 30 days or All time to see this computer's history: tokens in and out, requests, and an estimated cost for models you pay for. The included AI card says that included AI is unlimited and that there is no ADCode allowance. The composer's Today meter shows how many included requests you made across your devices.

The activity calendar always shows the past year. Each square is a local calendar day with at least one AI request from chat or an agent on this computer. It shows your current streak, longest streak and active days. Hover, select or focus a square to see its date, requests and tokens; the arrow keys move between days, and Home and End jump to the oldest and newest day.

Clear usage removes this computer's history, activity and streaks. It does not change your account's access to included AI. Your own provider's billing page remains the exact record for models you pay for.

## If a request fails

A dropped connection does not end the turn. ADCode retries inside the same turn for about two minutes, with a short pause between attempts and a status line that says what is happening. Stop cancels the wait. Completed tool steps are not repeated when the request resumes, so the assistant carries on from where it was instead of re-reading files or re-running commands. If the connection stays down, the message names the network error.

If the problem is the model rather than the network, the failure card offers a way forward. Choose Switch model, either from the card or from the model chip beside the send button. After a rate limit, an unavailable model or a rejected key, choosing a model that can answer resumes the request by itself. You do not retype the prompt, and the conversation, its compacted summary and its completed tool results travel with it.

The card explains the failure in plain words. Depending on the cause it offers Try again, Switch model, Start fresh with this request, View AI usage or Report problem. Open Details to read the provider's exact message.

## Use your own key or a local model

Included AI is one option, not a lock-in. Open Connect a model and choose Bring your own key to add a provider account. ADCode checks the key before saving it, and the operating system's credential store holds it. Requests then go from your computer to that provider under your account, at that provider's prices. A provider you connect may support image attachments or a larger context window.

For work that should not leave the machine, connect a local model through Ollama. It needs no key and sends nothing to a provider. Its speed and abilities depend on the model and your hardware. Local models work with a smaller set of tools and are not offered helpers.

You can switch between included AI, your own provider and a local model at any time. The conversation stays, so trying another route after a failure does not cost you the work already done.
