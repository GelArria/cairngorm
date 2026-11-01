# Security policy

## Reporting a vulnerability

Please report security problems privately, never in a public issue, pull request or
discussion: an open report gives everyone the details before a fix exists.

Use GitHub's private vulnerability reporting:
[open a private report](https://github.com/GelArria/Cairngorm/security/advisories/new)
(the repository's **Security** tab → **Report a vulnerability**). Only the maintainers can
read it, and the fix can be prepared in a private fork before anything is published.

A useful report says:

- what an attacker can do, and what they need first (a malicious repository or file, a
  compromised agent, local access, a crafted link…);
- the Cairngorm version and operating system;
- the steps to reproduce it, or a proof of concept;
- any fix or mitigation you have in mind.

## What to expect

Cairngorm is maintained by a small team, so responses are best effort. We aim to
acknowledge a report within a week, agree on its severity with you, and fix it in the next
release. Once a fix ships we publish an advisory and credit you, unless you prefer to stay
anonymous. Please give us a reasonable time to release the fix before disclosing it.

## Supported versions

Only the latest release receives security fixes. Development builds from `dev` are not
supported releases.

## Scope

[docs/security.md](docs/security.md) describes Cairngorm's permissions, what it trusts and
its known platform limits. Vulnerabilities in agent CLIs, model providers or other
third-party software should go to their own maintainers; tell us too when Cairngorm makes
them reachable or worse.
