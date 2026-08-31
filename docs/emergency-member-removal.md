# Emergency member removal

Use the `Emergency member removal` GitHub Actions workflow only when a member
must be removed faster than the normal creator-request review path allows. It
is an admin/maintainer incident tool, not an alternate membership workflow.

The workflow does not push to `main`. It creates a single-purpose branch,
removes the selected `members/<id>.json`, regenerates `ring.json`, runs the
publish validator, records the operator and reason, and opens a pull request.
The ordinary required checks and image publishing path continue from there.

## Required GitHub configuration

Before the first use:

1. Protect `main` with a ruleset or branch protection rule that requires pull
   requests, blocks force pushes and deletion, applies to administrators, and
   requires the repository's CI and ring validation checks.
2. Create an Environment named `emergency-member-removal` under **Settings →
   Environments**.
3. Add the administrators or incident reviewers who may approve an emergency
   run as required reviewers. Disable administrator bypass if the repository's
   ownership model permits it.
4. In that Environment, create a variable named
   `EMERGENCY_REMOVAL_ENABLED` with the exact value `enabled`. Keep this as an
   environment variable, not a repository-wide variable. Its absence makes
   the workflow fail closed.
5. Ensure the existing `RING_BUILD_PAT` Actions secret is limited to this
   repository and has **Contents: Read and write** and **Pull requests: Read
   and write**. The PAT is necessary so the pushed branch and opened PR trigger
   the normal pull-request workflows.

GitHub already limits manual workflow dispatch to users with repository write
access. The protected Environment supplies the additional approval gate; the
typed `REMOVE <member-id>` confirmation prevents an accidental click-through.

## Runbook

1. Open **Actions → Emergency member removal → Run workflow** on `main`.
2. Enter the exact member id, an incident reason, and the requested typed
   confirmation.
3. Have an authorized reviewer approve the protected Environment deployment.
4. Review and merge the generated PR after its checks pass.
5. Confirm that the new `main`/`latest` GHCR image was published and that the
   external deployment pulled that digest. A merged removal does not itself
   prove that a running host restarted on the new image.

If the member file is already absent on `main`, the workflow stops without a
commit or PR. It never edits member-health state, and the member-health checker
never removes a member or regenerates `ring.json`.
