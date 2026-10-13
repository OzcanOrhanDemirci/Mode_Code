// SPDX-License-Identifier: Apache-2.0
// The command line from the bundle the package ships (dist/cli.mjs), as separate processes (see ../process/suite.ts);
// run by scripts/test-package.mjs, the same tests against the copy npm installed from the tarball.
import { PACKAGE_CLI } from '../helpers/proc.js';
import { defineCliTests } from '../process/suite.js';

defineCliTests(PACKAGE_CLI ? 'package' : 'dist');
