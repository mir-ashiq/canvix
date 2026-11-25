# AGENTS.md — canvix

## Git identity (mandatory)

All commits in this repository MUST be authored as:

- **Name:** `Ashiq Hussain Mir`
- **Email:** `imsrenpsycho@gmail.com`
- **GitHub account:** `mir-ashiq`

If a noreply address is ever required, the only correct form is
`128612922+mir-ashiq@users.noreply.github.com` (user-id prefix + hyphen).
A wrong noreply guess (`mirashiq@…`) once attributed commits to an
unrelated account and added a phantom contributor (corrected 25 Nov 2026).

Verify before committing:

```bash
git config user.name   # Ashiq Hussain Mir
git config user.email  # imsrenpsycho@gmail.com
```

## Gates (CI order — all green before push)

```bash
npm run typecheck
npm run lint
npm test
npm run build
```
