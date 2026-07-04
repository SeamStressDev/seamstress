# Security Policy

## Reporting a vulnerability in SeamStress itself

If you find a security issue in SeamStress (the tool), please report it
privately rather than opening a public issue. Email **hello@seamstress.dev**
with:

- a description of the issue and where it lives in the code,
- steps to reproduce, if you have them,
- any thoughts on impact.

You'll get an acknowledgment, and we'll work the fix in the open once it's
safe to do so. There's no bounty program — this is an independent project —
but credit is given gladly to anyone who reports responsibly.

## Reporting findings in code you don't own

SeamStress is a static-analysis tool: it reads source code you provide and
flags possible business-logic and security seams. It does not access, probe,
or exploit any running system. But it *can* surface real issues in code you
don't own — most commonly a public open-source project you've cloned.

If that happens, please handle the finding as a **responsible security
disclosure, not a publication:**

- **Report privately to the maintainers first.** Use the project's
  `SECURITY.md`, a private security advisory, or a direct maintainer contact —
  not a public issue, a social post, or a blog.
- **Give maintainers time to respond and fix** before any public discussion.
  Coordinated disclosure is the norm for a reason.
- **Don't publish exploitable specifics.** Describe the class of issue if you
  must discuss it; don't hand out a working recipe.
- **A SeamStress finding is a starting point, not a proof.** Findings are
  *questions the code raises* and can be code-accurate yet describe an
  intentional, documented decision. Verify before you report, and frame it as
  a question to the maintainer, not an accusation.

Treating findings this way is how this tool is meant to be used — the goal is
safer software and constructive contribution, not gotchas.

## Acceptable use

SeamStress is intended for analyzing code you own or are authorized to review.
You are responsible for ensuring you have the right to analyze any code you run
it against. The tool performs static analysis only and grants no access to any
system. See "Responsible Use" in the README for more.
