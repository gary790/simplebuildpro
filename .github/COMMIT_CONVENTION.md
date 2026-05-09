# Commit Convention

This project follows [Conventional Commits](https://www.conventionalcommits.org/).

## Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

## Types

| Type       | Description                                           |
| ---------- | ----------------------------------------------------- |
| `feat`     | A new feature                                         |
| `fix`      | A bug fix                                             |
| `chore`    | Maintenance tasks, dependency updates                 |
| `refactor` | Code change that neither fixes a bug nor adds feature |
| `docs`     | Documentation only changes                            |
| `style`    | Formatting, missing semicolons, etc. (not CSS)        |
| `test`     | Adding or updating tests                              |
| `ci`       | CI/CD pipeline changes                                |
| `perf`     | Performance improvements                              |
| `revert`   | Reverts a previous commit                             |

## Scopes

| Scope       | Description                   |
| ----------- | ----------------------------- |
| `api`       | Backend API (apps/api)        |
| `web`       | Frontend web app (apps/web)   |
| `db`        | Database schema/migrations    |
| `shared`    | Shared packages               |
| `infra`     | Infrastructure, Docker, CI/CD |
| `deps`      | Dependency updates            |
| `phase-X.Y` | Phase milestone work          |

## Examples

```
feat(api): add rate limiting to AI chat endpoint
fix(web): resolve OAuth popup blocked on Safari
chore(deps): update hono to v4.7.1
refactor(db): normalize user connections schema
ci(infra): add staging deployment workflow
docs: update README with deployment instructions
```
