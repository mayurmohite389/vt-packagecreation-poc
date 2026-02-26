/**
 * Prints the test parameter matrix for PoC evaluation.
 * Use this to plan runs: duration x clip count x (graphic, start plate, end plate).
 */

import { TEST_PARAMS } from '../src/config.js';

console.log('Test parameter matrix for package engine PoC:\n');
console.log('Package duration (min):', TEST_PARAMS.durations.join(', '));
console.log('Number of clips:', TEST_PARAMS.clipCounts.join(', '));
console.log('Graphic:', TEST_PARAMS.graphic);
console.log('Start plate video:', TEST_PARAMS.startPlate);
console.log('End plate video:', TEST_PARAMS.endPlate);
console.log('\nSuggested runs:');
console.log('  For each (duration, clipCount), prepare S3 inputs and run:');
console.log('  node src/index.js process --bucket BUCKET --input-keys KEY1,KEY2,... [--no-fade] [--gpu]');
console.log('  Then run with GPU variant on a GPU-capable Fargate task to compare TAT.');
