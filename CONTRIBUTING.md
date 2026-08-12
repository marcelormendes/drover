# Contributing to Drover

Thanks for helping improve Drover. Contributions should keep Herdr as the runtime authority and preserve the security boundary described in the README.

## Before opening a pull request

1. Fork the repository and create a focused branch from the latest `main`.
2. Install the supported toolchain and dependencies:

   ```sh
   npm install --global npm@11.7.0
   npm ci
   ```

3. Make the smallest coherent change and add or update tests for changed behavior.
4. Run the local verification gate:

   ```sh
   npm run verify
   ```

5. Open a pull request using the repository template and describe both automated and manual validation.

## Pull request requirements

- Changes reach `main` through pull requests; direct and force pushes are blocked.
- The `Verify` CI check must pass on the latest commit.
- At least one approving review from the code owner is required.
- New commits dismiss stale approvals, and all review conversations must be resolved.
- Workflow runs from external forks require maintainer approval before they execute. A maintainer will inspect workflow changes before approving a run.

Keep pull requests reviewable. Separate unrelated refactors or dependency updates, do not commit generated packages, and never include credentials or private Herdr session data.

## Review expectations

Reviews prioritize correctness at the Herdr engine boundary, renderer sandboxing and IPC validation, cross-platform behavior, regression coverage, and a consistent desktop experience. Maintainers may ask for a smaller scope or additional live-engine verification when DOM-only tests cannot exercise the behavior.
