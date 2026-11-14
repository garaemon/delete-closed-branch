const MILLISECONDS_PER_SECOND = 1000;

/**
 * Retargets the pull requests stacked on a closed pull request to the default
 * branch, then deletes the closed branch.
 *
 * Takes the `github`, `context`, and `core` objects that actions/github-script
 * provides. Logs and returns without changes when the event is not a closed
 * pull request from this repository. Rejects when the GitHub API fails, except
 * when the branch is already gone.
 *
 * For a pull request closed without a merge, waits `unmergedDelaySeconds`
 * first and does nothing if someone reopened the pull request meanwhile.
 * `unmergedDelaySeconds` is a non-negative number or numeric string, and
 * defaults to 0. `sleep` replaces the timer in tests.
 */
async function deleteClosedBranch({
  github,
  context,
  core,
  unmergedDelaySeconds = 0,
  sleep = sleepFor,
}) {
  const delaySeconds = parseDelaySeconds(unmergedDelaySeconds);
  const skipReason = findSkipReason(context);
  if (skipReason) {
    core.info(`Skip: ${skipReason}`);
    return;
  }

  const { owner, repo } = context.repo;
  const closedPull = context.payload.pull_request;
  if (!closedPull.merged && delaySeconds > 0) {
    const reopened = await waitForReopen({ github, core, owner, repo, closedPull, delaySeconds, sleep });
    if (reopened) {
      core.info(`Skip: #${closedPull.number} was reopened.`);
      return;
    }
  }

  const closedBranch = closedPull.head.ref;
  const defaultBranch = context.payload.repository.default_branch;
  // GitHub closes every open pull request whose base branch is deleted, so the
  // stacked pull requests move to the default branch before the deletion.
  await retargetStackedPulls({ github, core, owner, repo, closedBranch, defaultBranch });
  await deleteBranch({ github, core, owner, repo, closedBranch });
}

function parseDelaySeconds(unmergedDelaySeconds) {
  const delaySeconds = Number(unmergedDelaySeconds);
  if (!Number.isFinite(delaySeconds) || delaySeconds < 0) {
    throw new Error(`unmerged-delay-seconds must be a non-negative number, got "${unmergedDelaySeconds}".`);
  }
  return delaySeconds;
}

function sleepFor(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForReopen({ github, core, owner, repo, closedPull, delaySeconds, sleep }) {
  core.info(`Wait ${delaySeconds} seconds in case #${closedPull.number} gets reopened.`);
  await sleep(delaySeconds * MILLISECONDS_PER_SECOND);
  const { data: currentPull } = await github.rest.pulls.get({
    owner,
    repo,
    pull_number: closedPull.number,
  });
  return currentPull.state === 'open';
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
