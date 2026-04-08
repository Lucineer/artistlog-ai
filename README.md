# artistlog-ai 🖌️

You commit at 2am with the message `fixed it`. Three days later you can't remember what you fixed.

This remembers for you.

---

## Why This Exists
Artists don't write good changelogs. You work in bursts, forget context, and abandon half-finished changes for weeks. This tool was built for people who make things, not for people who write perfect documentation. It reconstructs your project's story from your Git commit history.

## Quick Start
This is a fork-first project. You deploy your own private instance.

1.  **Fork this repository.** This becomes your modifiable copy.
2.  Clone your fork and deploy it:
    ```bash
    gh repo fork Lucineer/artistlog-ai --clone
    cd artistlog-ai
    npx wrangler login
    echo "your-github-token" | npx wrangler secret put GITHUB_TOKEN
    echo "your-llm-api-key" | npx wrangler secret put DEEPSEEK_API_KEY
    npx wrangler deploy
    ```
3.  Modify the tracker modules in `./art/tracker` to match your creative workflow (e.g., portfolio versions, sketch iterations).

## What It Does
- **Commit-Aware Memory:** Analyzes your Git history to map how your project evolved. No extra logging is required.
- **Native Art Tracking:** Provides a structure for tracking portfolios, commissions, gallery versions, and exhibition timelines.
- **Your Infrastructure:** Bring your own LLM API key (default is DeepSeek). Runs entirely on Cloudflare's global network. There are no runtime dependencies.
- **Your Data:** All data—your commits, your project context—stays within your deployed Worker. Nothing is sent to external servers for training.

## What Makes It Different
1.  **It Only Remembers.** It will not critique, edit, or suggest changes to your work. Its sole function is to reconstruct and explain your own history.
2.  **Private by Design.** Every user runs a separate instance. There is no shared database or central service.
3.  **Built for Vague Commits.** It is designed to parse unclear, tired, or minimal commit messages—the kind artists actually write.

## A Real Limitation
The tool's memory is constrained by your LLM's context window (default ~128K tokens). Very long, complex project histories may need to be queried in specific date ranges instead of all at once.

---

**Live Example:** [https://artistlog-ai.casey-digennaro.workers.dev](https://artistlog-ai.casey-digennaro.workers.dev)

Open source under the MIT license.  
Attribution: Superinstance and Lucineer (DiGennaro et al.)

<div style="text-align:center;padding:16px;color:#64748b;font-size:.8rem"><a href="https://the-fleet.casey-digennaro.workers.dev" style="color:#64748b">The Fleet</a> &middot; <a href="https://cocapn.ai" style="color:#64748b">Cocapn</a></div>

---

<i>Built with [Cocapn](https://github.com/Lucineer/cocapn-ai) — the open-source agent runtime.</i>
<i>Part of the [Lucineer fleet](https://github.com/Lucineer)</i>

