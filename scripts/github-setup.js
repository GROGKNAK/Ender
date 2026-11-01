'use strict';
/*
 * Configures the GitHub repository. Everything here is on the free tier.
 *
 *   node scripts/github-setup.js            # configure
 *   node scripts/github-setup.js --protect  # also protect the main branch
 *   node scripts/github-setup.js --dry-run  # print what would be called
 *
 * Idempotent: safe to re-run. Each step reports on its own and a failure in
 * one does not stop the rest, because the useful failure mode is "most of it
 * worked and here is the bit that did not".
 *
 * Requires: gh CLI authenticated as an account with ADMIN on the repo.
 * Write access is not enough for Pages, security features or branch rules.
 */

const { execFileSync } = require('child_process');

const DRY = process.argv.includes('--dry-run');
const PROTECT = process.argv.includes('--protect');

const SLUG = (process.argv.find((a) => a.includes('/') && !a.startsWith('-'))
  || 'GROGKNAK/Ender');
const [OWNER, REPO] = SLUG.split('/');

const DESCRIPTION =
  'Line protection test builder for SEL 87L line differential and 21 distance elements';
const TOPICS = [
  'power-systems', 'protective-relaying', 'protection-relay', 'sel-relays',
  'line-differential', 'distance-protection', 'electron', 'relay-testing'
];

let ok = 0;
let bad = 0;

function gh(args, { input } = {}) {
  if (DRY) {
    console.log('  DRY  gh ' + args.join(' ') + (input ? '  <<< ' + input : ''));
    return '';
  }
  return execFileSync('gh', args, {
    input: input || undefined,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

function step(label, fn) {
  process.stdout.write('- ' + label.padEnd(44));
  try {
    fn();
    console.log('ok');
    ok += 1;
  } catch (err) {
    const msg = String((err && (err.stderr || err.message)) || err)
      .split('\n').map((l) => l.trim()).filter(Boolean)[0] || 'failed';
    console.log('FAILED  ' + msg.slice(0, 120));
    bad += 1;
  }
}

function api(method, path, body) {
  const args = ['api', '-X', method, path];
  if (body !== undefined) {
    args.push('--input', '-');
    return gh(args, { input: JSON.stringify(body) });
  }
  return gh(args);
}

const base = `repos/${OWNER}/${REPO}`;

console.log(`Configuring ${OWNER}/${REPO}${DRY ? '  (dry run)' : ''}\n`);

step('description, merge and branch hygiene', () => {
  api('PATCH', base, {
    description: DESCRIPTION,
    homepage: `https://${OWNER.toLowerCase()}.github.io/${REPO}/`,
    has_issues: true,
    has_wiki: false,
    has_projects: false,
    allow_squash_merge: true,
    allow_merge_commit: false,
    allow_rebase_merge: true,
    allow_auto_merge: true,
    delete_branch_on_merge: true
  });
});

step('topics', () => {
  api('PUT', `${base}/topics`, { names: TOPICS });
});

// Free on public repositories.
step('Dependabot alerts', () => {
  api('PUT', `${base}/vulnerability-alerts`);
});

step('Dependabot security updates', () => {
  api('PUT', `${base}/automated-security-fixes`);
});

step('secret scanning + push protection', () => {
  api('PATCH', base, {
    security_and_analysis: {
      secret_scanning: { status: 'enabled' },
      secret_scanning_push_protection: { status: 'enabled' }
    }
  });
});

/*
 * The default GITHUB_TOKEN is read-only; release.yml asks for contents:write
 * explicitly. A token that is write-by-default is a standing invitation for a
 * compromised action to push to the repo.
 */
step('restrict default workflow token', () => {
  api('PUT', `${base}/actions/permissions/workflow`, {
    default_workflow_permissions: 'read',
    can_approve_pull_request_reviews: false
  });
});

/*
 * Pages served from the Actions workflow rather than a branch, so the site is
 * built from source instead of committed. Free on public repositories; on a
 * private repo this needs a paid plan and will fail here.
 */
step('GitHub Pages (source: Actions)', () => {
  try {
    api('POST', `${base}/pages`, { build_type: 'workflow' });
  } catch (err) {
    // Already enabled: switch the source instead of failing.
    api('PUT', `${base}/pages`, { build_type: 'workflow' });
  }
});

if (PROTECT) {
  /*
   * Protected branches are free on public repositories. Left opt-in because on
   * a solo repo it mostly means you cannot push to main any more.
   */
  step('protect main', () => {
    api('PUT', `${base}/branches/main/protection`, {
      required_status_checks: {
        strict: true,
        contexts: ['test (ubuntu-latest)', 'test (windows-latest)']
      },
      enforce_admins: false,
      required_pull_request_reviews: null,
      restrictions: null,
      allow_force_pushes: false,
      allow_deletions: false
    });
  });
}

console.log(`\n${ok} ok, ${bad} failed`);
if (!DRY && bad) {
  console.log(
    '\nA 403 here means the authenticated account lacks admin on the repo.\n' +
    'Check with:  gh repo view ' + SLUG + ' --json viewerPermission'
  );
}
process.exit(bad ? 1 : 0);
