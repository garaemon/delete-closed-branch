/**
 * Retargets the pull requests stacked on a closed pull request to the default
 * branch, then deletes the closed branch.
 *
 * Takes the `github`, `context`, and `core` objects that actions/github-script
 * provides. Logs and returns without changes when the event is not a closed
 * pull request from this repository. Rejects when the GitHub API fails, except
 * when the branch is already gone.
 */
async function deleteClosedBranch({ github, context, core }) {
  const skipReason = findSkipReason(context);
  if (skipReason) {
    core.info(`Skip: ${skipReason}`);
    return;
  }

  const { owner, repo } = context.repo;
  const closedBranch = context.payload.pull_request.head.ref;
  const defaultBranch = context.payload.repository.default_branch;
  // GitHub closes every open pull request whose base branch is deleted, so the
  // stacked pull requests move to the default branch before the deletion.
  await retargetStackedPulls({ github, core, owner, repo, closedBranch, defaultBranch });
  await deleteBranch({ github, core, owner, repo, closedBranch });
}

function findSkipReason(context) {
  const { owner, repo } = context.repo;
  if (context.eventName !== 'pull_request' || context.payload.action !== 'closed') {
    return `${context.eventName} ${context.payload.action} is not a closed pull request.`;
  }

  const closedPull = context.payload.pull_request;
  // A fork's branch lives in another repository, which GITHUB_TOKEN cannot
  // write to. head.repo is null when the fork no longer exists.
  if (closedPull.head.repo?.full_name !== `${owner}/${repo}`) {
    return `#${closedPull.number} comes from a fork.`;
  }

  if (closedPull.head.ref === context.payload.repository.default_branch) {
    return `${closedPull.head.ref} is the default branch.`;
  }
  return null;
}

async function retargetStackedPulls({ github, core, owner, repo, closedBranch, defaultBranch }) {
  const stackedPulls = await github.paginate(github.rest.pulls.list, {
    owner,
    repo,
    state: 'open',
    base: closedBranch,
    per_page: 100,
  });
  for (const stackedPull of stackedPulls) {
    core.info(`Retarget #${stackedPull.number} from ${closedBranch} to ${defaultBranch}.`);
    await github.rest.pulls.update({
      owner,
      repo,
      pull_number: stackedPull.number,
      base: defaultBranch,
    });
  }
}

async function deleteBranch({ github, core, owner, repo, closedBranch }) {
  try {
    await github.rest.git.deleteRef({ owner, repo, ref: `heads/${closedBranch}` });
    core.info(`Deleted ${closedBranch}.`);
  } catch (error) {
    // 422 means that someone already deleted the branch, for example with the
    // "Delete branch" button on the pull request.
    if (error.status !== 422) {
      throw error;
    }
    core.info(`Skip: ${closedBranch} no longer exists.`);
  }
}

module.exports = { deleteClosedBranch };
