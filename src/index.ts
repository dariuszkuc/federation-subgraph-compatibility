import debug from 'debug';
import { create } from '@actions/artifact';
import { getBooleanInput, getInput } from '@actions/core';
import { context, getOctokit } from '@actions/github';
import {
  compatibilityTest,
  DockerConfig,
} from '@apollo/federation-subgraph-compatibility-tests';
import { readFileSync } from 'fs';
import { resolve } from 'path';

async function main(): Promise<void> {
  const debugMode: boolean = getBooleanInput('debug');
  if (debugMode) {
    console.log('setting debug setting');
    debug.enable('debug,pm2,docker,rover,test');
  }

  const runtimeConfig: DockerConfig = {
    kind: 'docker',
    schemaFile: getInput('schema'),
    composeFile: getInput('compose'),
    path: getInput('path') ?? '',
    port: getInput('port') ?? '4001',
    format: 'markdown',
  };
  await compatibilityTest(runtimeConfig);

  // upload artifact
  console.log("uploading compatibility results workflow artifact");
  const artifactClient = create();
  const artifactName = 'compatibility-results';
  const files = ['results.md'];
  const rootDirectory = resolve(__dirname, '..');
  const options = {
    continueOnError: false,
  };
  await artifactClient.uploadArtifact(
    artifactName,
    files,
    rootDirectory,
    options,
  );

  // comment on PR
  const { pull_request } = context.payload;
  if (pull_request) {
    const token: string = getInput('token');
    console.log("attempting to comment on the PR");
    if (token) {
      const octokit = getOctokit(token);
      // find latest comment
      const comments = await octokit.rest.issues.listComments({
        ...context.repo,
        issue_number: pull_request.number
      });
      let lastCommentId: number | null = null
      if (comments.status == 200 && comments.data) {
        const actionComment = comments.data.filter(element => element.body?.startsWith("## Apollo Federation Subgraph Compatibility Results"));
        if (actionComment.length > 0) {
          lastCommentId = actionComment[0].id;
        }
      }

      const compatibilityResults: string = readFileSync('results.md', 'utf-8');
      const commentBody = `## Apollo Federation Subgraph Compatibility Results\n
${compatibilityResults}\n
Learn more:
* [Apollo Federation Subgraph Specification](https://www.apollographql.com/docs/federation/subgraph-spec/)
* [Compatibility Tests](https://github.com/apollographql/apollo-federation-subgraph-compatibility/blob/main/COMPATIBILITY.md)`

      if (lastCommentId) {
        console.log("comment found!")
        await octokit.rest.issues.updateComment({
          ...context.repo,
          comment_id: lastCommentId,
          body: commentBody,
        });
      } else {
        console.log("new comment");
        await octokit.rest.issues.createComment({
          ...context.repo,
          issue_number: pull_request.number,
          body: commentBody,
        });
      }
      console.log("comment posted");
    } else {
      console.warn('unable to post comment - Github Token was not provided');
    }
  }
}

main().catch((error) => {
  console.error(error);
});
