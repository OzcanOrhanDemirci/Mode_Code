// SPDX-License-Identifier: Apache-2.0
// The command line from the bundle the package ships (dist/cli.mjs), as separate processes (see ../process/suite.ts).
import { defineCliTests } from '../process/suite.js';

defineCliTests('dist');
