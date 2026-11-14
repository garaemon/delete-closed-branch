# delete-closed-branch

A GitHub Action that cleans up after a pull request closes, merged or not.
The action runs these steps:

1. Retargets every open pull request based on the closed branch to the default
   branch. A stacked pull request therefore stays open and moves down the
   stack.
1. Deletes the closed branch.

The action skips pull requests from forks, because `GITHUB_TOKEN` cannot
write to another repository. The action also skips any event other than a
closed pull request.

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
    runs-on: ubuntu-slim
    steps:
      - uses: garaemon/delete-closed-branch@v1
```

The action needs both write permissions: `contents` to delete the branch, and
`pull-requests` to retarget the stacked pull requests. The action needs no
checkout.

This repository is public, so private repositories can use the action too.

## Versioning

Pin a tag, such as `v1`, instead of `main`. A change on `main` then reaches
the callers only when they move to a new tag.

This repository runs the action on itself from the pull request's head, so a
change gets exercised on its own pull request before the next tag.

## License

See [LICENSE](LICENSE).
