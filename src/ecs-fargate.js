/**
 * Measure time from runTask to task reaching RUNNING state (Fargate cold start).
 */

import { ECSClient, RunTaskCommand, DescribeTasksCommand } from '@aws-sdk/client-ecs';

const ecs = new ECSClient({});

const RUNNING = 'RUNNING';
const POLL_INTERVAL_MS = 1500;
const MAX_WAIT_MS = 300_000; // 5 min

/**
 * Run one Fargate task and return milliseconds until its last status is RUNNING.
 * @param {{
 *   cluster: string,
 *   taskDefinition: string,
 *   subnets?: string[],
 *   securityGroups?: string[],
 * }} options
 * @returns {Promise<number>} Time in ms from RunTask to RUNNING
 */
export async function measureFargateTaskStartTime(options) {
  const {
    cluster,
    taskDefinition,
    subnets = [],
    securityGroups = [],
  } = options;

  const launchParams = {
    cluster,
    taskDefinition,
    launchType: 'FARGATE',
    platformVersion: 'LATEST',
  };
  if (subnets.length) {
    launchParams.networkConfiguration = {
      awsvpcConfiguration: {
        subnets,
        assignPublicIp: 'ENABLED',
        ...(securityGroups.length ? { securityGroups } : {}),
      },
    };
  }

  const t0 = Date.now();
  const runResult = await ecs.send(new RunTaskCommand(launchParams));
  const taskArns = runResult.tasks?.map((t) => t.taskArn) ?? [];
  if (taskArns.length === 0) {
    const failures = runResult.failures ?? [];
    throw new Error('RunTask returned no tasks: ' + JSON.stringify(failures));
  }

  const taskArn = taskArns[0];
  const deadline = t0 + MAX_WAIT_MS;
  let lastStatus;

  while (Date.now() < deadline) {
    const desc = await ecs.send(new DescribeTasksCommand({
      cluster,
      tasks: [taskArn],
    }));
    const task = desc.tasks?.[0];
    if (!task) break;
    lastStatus = task.lastStatus;
    if (lastStatus === RUNNING) {
      return Date.now() - t0;
    }
    if (task.stopCode || task.stoppedReason) {
      throw new Error(`Task stopped before RUNNING: ${task.stoppedReason || task.stopCode}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(`Task did not reach RUNNING within ${MAX_WAIT_MS}ms; last status: ${lastStatus}`);
}
