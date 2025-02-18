# gh-action-auto-merge-dependency-updates

A GitHub action that will automatically approve and merge a PR that only contains dependency updates, based on some rules.

If you run tests on PR's make sure you [configure those as required status checks](https://docs.github.com/en/github/administering-a-repository/enabling-required-status-checks) so that they need to go green before the merge can occur.

Note that the action does not check the lockfile is valid, so you should only set `allowed-actors` you trust, or validate that the lockfile is correct in another required action.

It currently supports npm and yarn.

By default this action will poll the API and wait for all status checks to pass which is not very efficient. It's recommended that you:

- Enable auto merge on your repo
- Enable the `use-auto-merge` option in the action
- Configure this action as a required status check
  - This is so that if a PR is updated and auto merge needs disabling, the PR cannot auto merge before that happens

## Config

- `use-auto-merge`: **\[Recommended\]** Enable GitHub auto merge on the PR and exit instead of waiting for the checks to complete and merging. Auto merge must be enabled on the repo, and you should make sure this is a required status check. _Default: `true`_
- `repo-token` (optional): a GitHub API token. _Default: The token provided to the workflow (`${{ github.token }}`)_
- `approve` (optional): Automatically approve the PR if it qualifies for auto merge. _Default: `true`_
- `merge` (optional): Merge the PR if it qualifies. _Default: `true`_
- `merge-method` (optional): Merge method. Supported: `merge`, `squash`, `rebase` _Default: `merge`_
- `required-labels`: (optional) Only merge pull requests that have one of these labels (comma-seperated). \_Default: "dependencies,auto-merge"

You should configure this action to run on the `pull_request_target` event. If you use `pull_request` you might need to provide a custom `repo-token` which has permission to merge. [The default token for dependabot PRs only has read-only access](https://github.blog/changelog/2021-02-19-github-actions-workflows-triggered-by-dependabot-prs-will-run-with-read-only-permissions/).

## Outputs

A `success` output is set to `true` if a commit is eligible for auto merge.

## Example Action

```yaml
name: Auto Merge Dependency Updates

on:
  - pull_request_target

jobs:
  auto-merge-dependency-updates:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    concurrency:
      group: 'auto-merge:${{ github.head_ref }}'
      cancel-in-progress: true
    steps:
      - uses: Mic92@auto-merge@master
```
