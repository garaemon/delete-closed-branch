# delete-closed-branch

A reusable GitHub Actions workflow that cleans up after a pull request
closes, merged or not. The workflow runs these steps:

1. Retargets every open pull request based on the closed branch to the default
   branch. A stacked pull request therefore stays open and moves down the
   stack.
1. Deletes the closed branch.

The workflow skips pull requests from forks, because `GITHUB_TOKEN` cannot
write to another repository.

## Usage

Add `.github/workflows/delete-closed-branch.yml` to your repository:

```yaml
name: Delete closed branch

on:
  pull_request:
    types: [closed]

permissions:
  contents: write
  pull-requests: write

jobs:
  delete-branch:
    uses: garaemon/delete-closed-branch/.github/workflows/delete-closed-branch-reusable.yml@v1
```

The caller must grant both write permissions. A called workflow cannot raise
the permissions of the caller's `GITHUB_TOKEN`.

This repository is public, so private repositories can call the workflow too.

## Versioning

Pin a tag, such as `v1`, instead of `main`. A change on `main` then reaches
the callers only when they move to a new tag.

This repository runs the workflow on itself through a local path, so a change
gets exercised on its own pull request before the next tag.

## License

See [LICENSE](LICENSE).
