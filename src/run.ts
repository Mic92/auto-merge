import * as core from '@actions/core';
import * as github from '@actions/github';
import { EmitterWebhookEvent } from '@octokit/webhooks';
import { Label } from '@octokit/webhooks-types';
import { getOctokitOptions, GitHub } from '@actions/github/lib/utils';
import { throttling } from '@octokit/plugin-throttling';
import { Result } from './result';
import { graphql } from '@octokit/graphql';

type MergeMethod = 'merge' | 'squash' | 'rebase';
const mergeMethods: ReadonlyArray<MergeMethod> = ['merge', 'squash', 'rebase'];
const isMergeMethod = (method: string): method is MergeMethod => {
  return mergeMethods.includes(method as MergeMethod);
};
const toMergeMethod = (method: string): MergeMethod => {
  if (isMergeMethod(method)) {
    return method;
  }
  throw new Error(`merge-method invalid: ${method}`);
};

const retryDelays = [1, 1, 1, 2, 3, 4, 5, 10, 20, 40, 60].map((a) => a * 1000);
const timeout = 6 * 60 * 60 * 1000;

export async function run(): Promise<Result> {
  // Add this line to define the new input for required labels
  const requiredLabels = core
    .getInput('required-labels')
    .split(',')
    .map((label: string) => label.trim());

  const hasRequiredLabels = (labels: Label[]): boolean => {
    if (requiredLabels.length === 0) {
      return true;
    }
    return labels.some((label) => requiredLabels.includes(label.name));
  };

  const startTime = Date.now();
  core.info('Starting');

  const context = github.context;
  core.debug(JSON.stringify(context, null, 2));

  if (
    !['pull_request', 'pull_request_target', 'pull_request_review'].includes(
      github.context.eventName,
    )
  ) {
    core.error(`Unsupported event name: ${github.context.eventName}`);
    return Result.UnknownEvent;
  }
  const payload: EmitterWebhookEvent<
    'pull_request' | 'pull_request_review'
  >['payload'] = github.context.payload as any;

  const token = core.getInput('repo-token', { required: true });

  const approve = core.getInput('approve') === 'true';

  const autoMerge = core.getInput('use-auto-merge') === 'true';

  const merge = core.getInput('merge') === 'true';
  const mergeMethod = toMergeMethod(
    core.getInput('merge-method', { required: true }),
  );

  const pr = payload.pull_request;

  // Check if the PR has the required labels
  if (!hasRequiredLabels(pr.labels)) {
    core.error(
      `PR does not have the required labels ${requiredLabels.join(', ')}`,
    );
    return Result.PRMergeSkipped;
  }

  const Octokit: typeof GitHub = GitHub.plugin(throttling as any);
  const octokit = new Octokit(
    getOctokitOptions(token, {
      throttle: {
        onRateLimit: (retryAfter: number) => {
          core.warning(`Hit rate limit. Retrying in ${retryAfter} seconds`);
          return true;
        },
        onSecondaryRateLimit: (retryAfter: number) => {
          core.warning(
            `Hit secondary rate limit. Retrying in ${retryAfter} seconds`,
          );
          return true;
        },
      },
    }),
  );

  const graphqlWithAuth = graphql.defaults({
    headers: {
      authorization: `token ${token}`,
    },
  });

  let maybeAuthenticatedUser:
    | Awaited<
        ReturnType<(typeof octokit)['rest']['users']['getAuthenticated']>
      >['data']
    | null = null;

  try {
    maybeAuthenticatedUser = (await octokit.rest.users.getAuthenticated()).data;
    core.debug(`Authenticated user: ${maybeAuthenticatedUser.id}`);
  } catch (e) {
    core.warning('Error fetching authenticated user');
    if (core.isDebug() && (e instanceof Error || typeof e === 'string')) {
      core.warning(e);
    }
  }
  const enableAutoMerge = async (): Promise<
    Result.AutoMergeEnabled | Result.PRMerged
  > => {
    core.info('Enabling auto merge');
    const { repository } = (await graphqlWithAuth(
      `
        query ($owner: String!, $name: String!) {
          repository(owner: $owner, name: $name) {
            autoMergeAllowed
          }
        }
      `,
      { owner: context.repo.owner, name: context.repo.repo },
    )) as any;

    if (!repository.autoMergeAllowed) {
      throw new Error('Auto merge is not enabled on the repo');
    }

    try {
      await graphqlWithAuth(
        `
          mutation ($id: ID!, $mergeMethod: PullRequestMergeMethod!, $expectedHeadOid: GitObjectID!) {
            enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: $mergeMethod, expectedHeadOid: $expectedHeadOid }) {
              clientMutationId
            }
          }
      `,
        {
          id: pr.node_id,
          mergeMethod: mergeMethod.toUpperCase(),
          expectedHeadOid: pr.head.sha,
        },
      );
      core.info('Auto merge enabled');
      return Result.AutoMergeEnabled;
    } catch (e) {
      // might be in a clean state
      core.warning('Auto merge failed to enable');
      if (core.isDebug() && (e instanceof Error || typeof e === 'string')) {
        core.warning(e);
      }

      core.info('Trying to merge');
      await octokit.rest.pulls.merge({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: pr.number,
        merge_method: mergeMethod,
        sha: pr.head.sha,
      });
      core.info('Merged');
      return Result.PRMerged;
    }
  };

  const mergeWhenPossible = async (): Promise<
    Result.PRNotOpen | Result.PRHeadChanged | Result.PRMerged
  > => {
    for (let i = 0; ; i++) {
      core.info(`Attempt: ${i}`);
      const livePR = await getPR();
      core.debug(JSON.stringify(livePR, null, 2));
      if (livePR.data.state !== 'open') {
        core.error('PR is not open');
        return Result.PRNotOpen;
      }
      const mergeable = livePR.data.mergeable;
      if (mergeable) {
        try {
          core.info('Attempting merge');
          await octokit.rest.pulls.merge({
            owner: context.repo.owner,
            repo: context.repo.repo,
            pull_number: pr.number,
            merge_method: mergeMethod,
            sha: pr.head.sha,
          });
          core.info('Merged');
          return Result.PRMerged;
        } catch (e) {
          if (e && typeof e === 'object' && 'status' in e && e.status === 409) {
            core.error('Failed to merge. PR head changed');
            return Result.PRHeadChanged;
          }
          core.error(`Merge failed: ${e}`);
        }
      } else {
        core.error('Not mergeable yet');
      }

      if (Date.now() - startTime >= timeout) {
        break;
      }

      const delay = retryDelays[Math.min(retryDelays.length - 1, i)];
      core.info(`Retry in ${delay} ms`);
      await new Promise<void>((resolve) => setTimeout(() => resolve(), delay));
    }
    core.error('Timed out');
    throw new Error('Timed out');
  };

  const getPR = () =>
    octokit.rest.pulls.get({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: pr.number,
    });

  const approvePR = async () => {
    if (maybeAuthenticatedUser) {
      const authenticatedUser = maybeAuthenticatedUser;

      const existingReviews = (
        await octokit.rest.pulls.listReviews({
          owner: context.repo.owner,
          repo: context.repo.repo,
          pull_number: pr.number,
        })
      ).data;

      const existingReview = existingReviews.find(
        ({ user, state }): boolean =>
          user?.id === authenticatedUser.id && state === 'PENDING',
      );

      if (existingReview) {
        core.info(`Found an existing pending review. Deleting it`);
        await octokit.rest.pulls.deletePendingReview({
          owner: context.repo.owner,
          repo: context.repo.repo,
          pull_number: pr.number,
          review_id: existingReview.id,
        });
      }
    }

    const review = await octokit.rest.pulls.createReview({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: pr.number,
      commit_id: pr.head.sha,
    });
    await octokit.rest.pulls.submitReview({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: pr.number,
      review_id: review.data.id,
      event: 'APPROVE',
    });
  };

  core.setOutput('success', 'true');

  if (approve) {
    core.info('Approving PR');
    await approvePR();
  }

  let result = Result.PRMergeSkipped;
  if (merge) {
    if (autoMerge) {
      result = await enableAutoMerge();
    } else {
      core.info('Merging when possible');
      result = await mergeWhenPossible();
    }
  }
  core.info('Finished!');
  return result;
}
