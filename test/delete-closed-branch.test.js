const assert = require('node:assert/strict');
const { test } = require('node:test');

const { deleteClosedBranch } = require('../src/delete-closed-branch.js');

const OWNER = 'garaemon';
const REPO = 'example';

function createContext({
  eventName = 'pull_request',
  action = 'closed',
  headRef = 'feature',
  headRepoFullName = `${OWNER}/${REPO}`,
  merged = true,
} = {}) {
  return {
    eventName,
    repo: { owner: OWNER, repo: REPO },
    payload: {
      action,
      repository: { default_branch: 'main' },
      pull_request: {
        number: 7,
        merged,
        head: {
          ref: headRef,
          repo: headRepoFullName === null ? null : { full_name: headRepoFullName },
        },
      },
    },
  };
}

function createFakeGithub({
  stackedPulls = [],
  deleteRefError = null,
  currentPullState = 'closed',
} = {}) {
  const updatedPulls = [];
  const deletedRefs = [];
  const listPulls = () => {};
  return {
    updatedPulls,
    deletedRefs,
    paginate: async (method, params) => {
      assert.equal(method, listPulls);
      return stackedPulls.filter(
        (stackedPull) => params.state === 'open' && params.base === stackedPull.base,
      );
    },
    rest: {
      pulls: {
        list: listPulls,
        get: async () => ({ data: { state: currentPullState } }),
        update: async (params) => {
          updatedPulls.push(params);
        },
      },
      git: {
        deleteRef: async (params) => {
          if (deleteRefError) {
            throw deleteRefError;
          }
          deletedRefs.push(params.ref);
        },
      },
    },
  };
}

function createFakeCore() {
  return { info: () => {} };
}

async function runWith({
  context = createContext(),
  github = createFakeGithub(),
  unmergedDelaySeconds = 60,
  sleptMilliseconds = [],
} = {}) {
  const sleep = async (milliseconds) => {
    sleptMilliseconds.push(milliseconds);
  };
  await deleteClosedBranch({ github, context, core: createFakeCore(), unmergedDelaySeconds, sleep });
  return github;
}

test('should_delete_the_closed_branch', async () => {
  const github = await runWith();

  assert.deepEqual(github.deletedRefs, ['heads/feature']);
});

test('should_retarget_stacked_pulls_to_the_default_branch', async () => {
  const github = createFakeGithub({ stackedPulls: [{ number: 8, base: 'feature' }] });

  await runWith({ github });

  assert.deepEqual(github.updatedPulls, [
    { owner: OWNER, repo: REPO, pull_number: 8, base: 'main' },
  ]);
});

test('should_skip_pulls_from_forks', async () => {
  const github = await runWith({ context: createContext({ headRepoFullName: 'someone/example' }) });

  assert.deepEqual(github.deletedRefs, []);
});

test('should_skip_pulls_whose_fork_no_longer_exists', async () => {
  const github = await runWith({ context: createContext({ headRepoFullName: null }) });

  assert.deepEqual(github.deletedRefs, []);
});

test('should_skip_the_default_branch', async () => {
  const github = await runWith({ context: createContext({ headRef: 'main' }) });

  assert.deepEqual(github.deletedRefs, []);
});

test('should_skip_pull_requests_that_are_not_closed', async () => {
  const github = await runWith({ context: createContext({ action: 'opened' }) });

  assert.deepEqual(github.deletedRefs, []);
});

test('should_skip_events_other_than_pull_requests', async () => {
  const github = await runWith({ context: createContext({ eventName: 'push' }) });

  assert.deepEqual(github.deletedRefs, []);
});

test('should_succeed_when_the_branch_is_already_deleted', async () => {
  const alreadyDeletedError = Object.assign(new Error('Reference does not exist'), { status: 422 });
  const github = createFakeGithub({ deleteRefError: alreadyDeletedError });

  await assert.doesNotReject(runWith({ github }));
});

test('should_rethrow_other_deletion_errors', async () => {
  const forbiddenError = Object.assign(new Error('Forbidden'), { status: 403 });
  const github = createFakeGithub({ deleteRefError: forbiddenError });

  await assert.rejects(runWith({ github }), forbiddenError);
});

test('should_wait_before_deleting_an_unmerged_branch', async () => {
  const sleptMilliseconds = [];

  await runWith({ context: createContext({ merged: false }), sleptMilliseconds });

  assert.deepEqual(sleptMilliseconds, [60000]);
});

test('should_not_wait_for_a_merged_pull', async () => {
  const sleptMilliseconds = [];

  await runWith({ context: createContext({ merged: true }), sleptMilliseconds });

  assert.deepEqual(sleptMilliseconds, []);
});

test('should_not_wait_when_the_delay_is_zero', async () => {
  const sleptMilliseconds = [];

  await runWith({
    context: createContext({ merged: false }),
    unmergedDelaySeconds: 0,
    sleptMilliseconds,
  });

  assert.deepEqual(sleptMilliseconds, []);
});

test('should_delete_an_unmerged_branch_that_stays_closed', async () => {
  const github = await runWith({ context: createContext({ merged: false }) });

  assert.deepEqual(github.deletedRefs, ['heads/feature']);
});

test('should_keep_the_branch_when_the_pull_is_reopened', async () => {
  const github = createFakeGithub({ currentPullState: 'open' });

  await runWith({ context: createContext({ merged: false }), github });

  assert.deepEqual(github.deletedRefs, []);
});

test('should_keep_stacked_pulls_when_the_pull_is_reopened', async () => {
  const github = createFakeGithub({
    currentPullState: 'open',
    stackedPulls: [{ number: 8, base: 'feature' }],
  });

  await runWith({ context: createContext({ merged: false }), github });

  assert.deepEqual(github.updatedPulls, []);
});

test('should_accept_the_delay_as_a_string', async () => {
  const sleptMilliseconds = [];

  await runWith({
    context: createContext({ merged: false }),
    unmergedDelaySeconds: '5',
    sleptMilliseconds,
  });

  assert.deepEqual(sleptMilliseconds, [5000]);
});

test('should_reject_a_negative_delay', async () => {
  await assert.rejects(runWith({ unmergedDelaySeconds: -1 }), /unmerged-delay-seconds/);
});

test('should_reject_a_non_numeric_delay', async () => {
  await assert.rejects(runWith({ unmergedDelaySeconds: 'soon' }), /unmerged-delay-seconds/);
});
