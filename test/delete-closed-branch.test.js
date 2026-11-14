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
} = {}) {
  return {
    eventName,
    repo: { owner: OWNER, repo: REPO },
    payload: {
      action,
      repository: { default_branch: 'main' },
      pull_request: {
        number: 7,
        head: {
          ref: headRef,
          repo: headRepoFullName === null ? null : { full_name: headRepoFullName },
        },
      },
    },
  };
}

function createFakeGithub({ stackedPulls = [], deleteRefError = null } = {}) {
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

async function runWith({ context = createContext(), github = createFakeGithub() } = {}) {
  await deleteClosedBranch({ github, context, core: createFakeCore() });
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
