# AGENTS.md — TEa.G3

## Git identity (mandatory)

Every commit must be attributed to the person who actually authored it and to
that person's own GitHub account.

- Never impersonate the upstream author or another contributor.
- Use the contributor's configured GitHub identity.
- Prefer that contributor's GitHub-provided noreply address when they do not
  want to publish a personal email address.
- Do not rewrite historical commits to change their authorship.
- Preserve upstream copyright and license notices when modifying or
  redistributing third-party code.

Verify before committing:

```bash
git config user.name
git config user.email
```

## Quality gates (CI order — all green before merge)

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

For browser acceptance, also run the relevant Playwright suites and verify
the deployed preview against a real database before merging.
